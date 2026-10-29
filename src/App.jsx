import { useState, useEffect, useCallback, useRef } from 'react'
import AgentOffice from './components/AgentOffice'
import TradeCalendar from './components/TradeCalendar'
import Spendings from './components/Spendings'
import EquityCurve from './components/EquityCurve'
import { formatPnL, money, grossOf, feesOf, hasFeeData } from './lib/pnl'
import { detectVestFormat, parseVestTrades, parseVestPayouts, payoutTotals, describeVestImport } from './lib/vest'

const API_URL = '/api/journal'

// Each upload carries an identity so the rows it brought in can be taken
// back out later without disturbing anything another file imported.
const newUploadId = () => `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

// Splitting on commas shifts every later column the moment one field contains
// one — Vest's failure_reason is free text, so that is a matter of when, not if.
function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let i = 0

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // exports ship a BOM

  while (i < text.length) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { quoted = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }

  const filled = rows.filter(r => r.some(cell => cell.trim() !== ''))
  if (filled.length === 0) return { headers: [], records: [] }

  const headers = filled[0].map(h => h.trim())
  const records = filled.slice(1).map(r => {
    const obj = {}
    headers.forEach((h, n) => { obj[h] = (r[n] ?? '').trim() })
    return obj
  })
  return { headers, records }
}

const toNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

// The function builds a `data:image/jpeg;base64,` URL for the model, so anything
// else here is a mime mismatch it rejects. Re-encoding also shrinks a full-size
// screenshot enough to stay under the serverless payload limit.
const MAX_IMAGE_DIM = 1600

function backdropFor(ctx, canvas) {
  try {
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let lum = 0, opaque = 0, clear = 0
    // Every 40th pixel is plenty to tell a dark card from a light one.
    for (let i = 0; i < d.length; i += 160) {
      if (d[i + 3] > 250) { lum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; opaque++ }
      else clear++
    }
    if (!clear || !opaque) return '#ffffff'
    return lum / opaque < 110 ? '#0b0b0e' : '#ffffff'
  } catch {
    return '#ffffff'
  }
}

function fileToJpegBase64(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      // JPEG has no alpha, so anything transparent needs a backdrop painted under
      // it. Match it to the card: a dark P&L card keeps its light text readable.
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = backdropFor(ctx, canvas)
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.globalCompositeOperation = 'source-over'
      resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1])
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('that file could not be decoded as an image'))
    }
    img.src = url
  })
}

// The model answers with its own field names; reshape the row so the table,
// the stats and the equity curve all read it exactly like a CSV import.
const clockToSeconds = (v) => {
  const m = String(v ?? '').match(/(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i)
  if (!m) return null
  let h = +m[1]
  const ampm = m[4] && m[4].toUpperCase()
  if (ampm === 'PM' && h !== 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0
  return h * 3600 + +m[2] * 60 + +m[3]
}

const holdTime = (open, close) => {
  const a = clockToSeconds(open)
  const b = clockToSeconds(close)
  if (a === null || b === null) return ''
  const secs = b >= a ? b - a : b + 86400 - a
  const h = Math.floor(secs / 3600)
  const min = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return [h && `${h}hr`, (h || min) && `${min}min`, `${s}sec`].filter(Boolean).join(' ')
}

// A P&L card marks a loss with red text and no minus sign, so the number on its
// own is ambiguous — a vision model reads digits, not colour. Direction and the
// two prices are not ambiguous, so they decide the sign whenever both are there.
function signedPnl(raw, side, entry, exit) {
  const magnitude = Math.abs(toNum(raw.pnl) ?? 0)
  const direction = /short|sell/i.test(side) ? -1 : /long|buy/i.test(side) ? 1 : 0
  if (!direction || entry === null || exit === null || entry === exit) return toNum(raw.pnl) ?? 0
  const profitable = direction === 1 ? exit > entry : exit < entry
  return profitable ? magnitude : -magnitude
}

// A chart screenshot and a P&L card are two halves of one trade: the chart holds
// the plan (entry, stop, target), the card holds what actually filled. The model
// labels which it read, but the shape of the data decides when it does not.
const isChartPlan = (raw) =>
  String(raw.kind || '').toLowerCase() === 'chart' ||
  (toNum(raw.pnl) === null && (toNum(raw.stopLoss) !== null || toNum(raw.takeProfit) !== null))

// TradingView writes CME:MNQ, the broker writes MNQZ5 — compare the root only.
const rootSymbol = (s) => String(s || '').toUpperCase().split(':').pop().replace(/[^A-Z]/g, '').slice(0, 3)

const sideOf = (s) => (/short|sell/i.test(s || '') ? 'Short' : /long|buy/i.test(s || '') ? 'Long' : '')

function planMatches(trade, plan) {
  if (rootSymbol(trade.symbol) !== rootSymbol(plan.symbol)) return false
  const a = toNum(trade.buyPrice ?? trade.entryPrice)
  const b = toNum(plan.buyPrice)
  if (a === null || b === null) return false
  const sa = sideOf(trade.side)
  if (sa && plan.side && sa !== plan.side) return false
  // The fill rarely lands exactly on a level drawn beforehand, so compare loosely.
  return Math.abs(a - b) <= Math.max(Math.abs(b) * 0.0005, 1)
}

// The card is the record of what happened, so it wins every field it has. The
// chart only supplies what it alone witnessed: where the stop and target were.
const mergePlan = (trade, plan) => ({
  ...trade,
  side: trade.side || plan.side,
  stopLoss: trade.stopLoss ?? plan.stopLoss,
  takeProfit: trade.takeProfit ?? plan.takeProfit,
  timeframe: trade.timeframe || plan.timeframe,
  tradeDate: trade.tradeDate || plan.tradeDate,
  chartSource: plan.source
})

const price = (v) => (toNum(v) === null ? '-' : toNum(v).toLocaleString())

function normalizeChartPlan(raw, filename) {
  const entry = toNum(raw.entryPrice ?? raw.buyPrice)
  const tp = toNum(raw.takeProfit)
  // The tool's own geometry names the direction when the model did not: the
  // target box sits above the entry on a long, below it on a short.
  const side = sideOf(raw.direction || raw.type || raw.side) ||
    (tp !== null && entry !== null ? (tp > entry ? 'Long' : 'Short') : '')
  return {
    symbol: raw.symbol || raw.contract || '—',
    side,
    buyPrice: entry,
    sellPrice: null,
    stopLoss: toNum(raw.stopLoss),
    takeProfit: tp,
    timeframe: raw.timeframe || '',
    tradeDate: raw.tradeDate || '',
    source: filename || 'chart'
  }
}

// R is measured in points, which needs no contract multiplier: the move the
// trade actually made over the move it was risking to make it.
function riskMetrics(t) {
  const entry = toNum(t.buyPrice ?? t.entryPrice)
  const exit = toNum(t.sellPrice ?? t.exitPrice)
  const sl = toNum(t.stopLoss)
  const tp = toNum(t.takeProfit)
  const risk = entry !== null && sl !== null ? Math.abs(entry - sl) : null
  return {
    risk,
    rMultiple: risk && exit !== null && exit !== 0
      ? (formatPnL(t.pnl) >= 0 ? 1 : -1) * Math.abs(exit - entry) / risk
      : null,
    plannedRR: risk && tp !== null ? Math.abs(tp - entry) / risk : null
  }
}

function normalizeExtractedTrade(raw, filename) {
  const side = raw.type || raw.side || ''
  const entry = toNum(raw.entryPrice ?? raw.buyPrice)
  const exit = toNum(raw.exitPrice ?? raw.sellPrice)
  const open = raw.openTime || raw.boughtTimestamp || ''
  const close = raw.closeTime || raw.soldTimestamp || ''
  return {
    symbol: raw.symbol || raw.contract || '—',
    side,
    qty: toNum(raw.qty) ?? 1,
    buyPrice: entry ?? 0,
    sellPrice: exit ?? 0,
    stopLoss: toNum(raw.stopLoss),
    takeProfit: toNum(raw.takeProfit),
    pnl: signedPnl(raw, side, entry, exit),
    boughtTimestamp: open || new Date().toLocaleString(),
    soldTimestamp: close,
    duration: raw.duration || holdTime(open, close),
    source: filename || 'screenshot'
  }
}

// The worst fall from a previous high -- not the lowest point the book ever
// reached, which is what this used to report and which can be a profit. The
// peak starts at zero so a book that is underwater from its first trade still
// reports that fall as a drawdown rather than waiting for a high it never made.
// The input is oldest-first to match the name; the figure itself happens to be
// the same either way, since reversing a curve maps its peak/trough pairs onto
// each other.
function worstDrawdown(chronological) {
  let peak = 0
  let equity = 0
  let worst = 0
  for (const pnl of chronological) {
    equity += pnl
    if (equity > peak) peak = equity
    if (equity - peak < worst) worst = equity - peak
  }
  return worst
}

function calculateStats(trades) {
  if (!trades.length) return null
  const pnls = trades.map(t => formatPnL(t.pnl))
  const wins = pnls.filter(p => p > 0)
  const losses = pnls.filter(p => p < 0)
  const totalPnL = pnls.reduce((a, b) => a + b, 0)
  // Gross is what the market gave; net is what survived the fees.
  const grossPnL = trades.reduce((a, t) => a + grossOf(t), 0)
  const totalFees = trades.reduce((a, t) => a + feesOf(t), 0)
  const winRate = (wins.length / trades.length * 100).toFixed(1)
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0
  const profitFactor = losses.length ? Math.abs(wins.reduce((a, b) => a + b, 0) / losses.reduce((a, b) => a + b, 0)).toFixed(2) : '∞'
  // Kept as numbers so money() formats them rather than re-parsing a string.
  const expectancy = totalPnL / trades.length
  const maxDrawdown = worstDrawdown([...pnls].reverse())
  return {
    totalPnL, grossPnL, totalFees, hasFees: hasFeeData(trades),
    winRate, avgWin, avgLoss, profitFactor, expectancy, maxDrawdown,
    totalTrades: trades.length,
  }
}

function generateEquityCurve(trades) {
  let equity = 0
  return trades.map((t, i) => {
    equity += formatPnL(t.pnl)
    return { date: t.boughtTimestamp?.split(' ')[0] || '', equity, tradeNum: i + 1 }
  })
}

// A payout is money leaving the account, not a trade. It has a P&L-shaped
// number on it, which is exactly why it needs saying out loud that none of
// this reaches the win rate, the expectancy or the equity curve.
function Payouts({ rows, onClear }) {
  const t = payoutTotals(rows)
  // The split is not a constant: these exports carry 95/5 rows alongside 80/20
  // ones, so a single blended percentage would misdescribe every row it covers.
  // Only state one rate when every payout actually shares it.
  const rates = [...new Set(
    rows.filter((r) => r.requested > 0).map((r) => Math.round((r.trader / r.requested) * 100))
  )]
  const uniformSplit = rates.length === 1 ? rates[0] : null
  const tone = (s) =>
    /execut|complete|paid|success/i.test(s) ? 'pnl-green' : /fail|reject|cancel/i.test(s) ? 'pnl-red' : ''

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong>Payouts</strong>
        <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={onClear}>Clear payouts</button>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 16 }}>
        Withdrawals, not trades — excluded from every statistic on the Analytics tab.
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-label">Paid out</div>
          <div className="stat-value mono green">{money(t.paid)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Processing</div>
          <div className="stat-value mono">{money(t.pending)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Your share</div>
          <div className="stat-value mono">{money(t.toTrader)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Platform fee</div>
          <div className="stat-value mono red">{money(t.toPlatform)}</div>
          {t.requested > 0 && (
            <div className="stat-note">
              {uniformSplit !== null
                ? `${uniformSplit} / ${100 - uniformSplit} split`
                : `${((t.toTrader / t.requested) * 100).toFixed(0)} / ${((t.toPlatform / t.requested) * 100).toFixed(0)} blended, rate varies`}
            </div>
          )}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Requested</th><th>Yours</th><th>Platform</th><th>Status</th><th>Asked</th><th>Paid</th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="mono">{money(p.requested)}</td>
                <td className="mono">{money(p.trader)}</td>
                <td className="mono" style={{ color: 'var(--muted)' }}>{money(p.platform)}</td>
                <td className={`mono ${tone(p.status)}`}>{p.failureReason ? `${p.status} — ${p.failureReason}` : p.status}</td>
                <td className="mono">{p.requestedAt.split(' ')[0]}</td>
                <td className="mono">{p.paidAt ? p.paidAt.split(' ')[0] : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Toast({ message, type, onClose }) {
  return (
    <div className={`toast ${type}`} onClick={onClose}>
      {message}
    </div>
  )
}

export default function App() {
  const [trades, setTrades] = useState([])
  const [uploads, setUploads] = useState([])
  const [plans, setPlans] = useState([])
  // Withdrawals, kept in their own list so they can never reach calculateStats.
  const [payouts, setPayouts] = useState([])
  // Costs of trading rather than results of it — same reasoning, same quarantine.
  const [spendings, setSpendings] = useState([])
  const [activeTab, setActiveTab] = useState('journal')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [isParsing, setIsParsing] = useState(false)

  // An import decides who it pairs with before it touches state. StrictMode
  // runs an updater twice, so that lookup cannot live inside one.
  const tradesRef = useRef(trades)
  const plansRef = useRef(plans)
  useEffect(() => { tradesRef.current = trades }, [trades])
  useEffect(() => { plansRef.current = plans }, [plans])

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(API_URL)
      // Under a plain `vite dev` there is no function behind /api, so the SPA
      // catch-all answers with index.html and .json() throws on the '<'. An
      // empty journal is the honest reading of that, not an error.
      // Dev and production part ways here on purpose: in production a non-JSON
      // reply means the function failed and the user must hear about it, while
      // in dev it is the normal state. Say so once instead of going silent,
      // because `netlify dev` with a broken function lands here too and that
      // one is worth noticing.
      if (!(res.headers.get('content-type') || '').includes('application/json')) {
        if (import.meta.env.DEV) {
          console.info(`${API_URL} has no backend in this dev server — starting empty.`)
          return
        }
        throw new Error(`${API_URL} did not return JSON (HTTP ${res.status})`)
      }
      const data = await res.json()
      setTrades(data.trades || [])
      setUploads(data.uploads || [])
      setPlans(data.plans || [])
      setPayouts(data.payouts || [])
      setSpendings(data.spendings || [])
    } catch (e) {
      console.error('Load failed:', e)
      showToast('Failed to load data', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const saveData = useCallback(async () => {
    setIsSaving(true)
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades, uploads, plans, payouts, spendings })
      })
      // A 404 from the dev server still resolves, so without this the app
      // cheerfully reports a save that never happened.
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showToast('Data saved to cloud')
    } catch (e) {
      console.error('Save failed:', e)
      showToast('Failed to save', 'error')
    } finally {
      setIsSaving(false)
    }
    // Everything in the body belongs in the deps: without that, a save fired
    // right after an import persists the previous set.
  }, [trades, uploads, plans, payouts, spendings])

  useEffect(() => { loadData() }, [loadData])

  // Held back until the first load resolves: the empty state this component
  // mounts with would otherwise race the load and save nothing over the
  // stored journal. After that every change is saved, an emptied list
  // included -- without that last part, deleting your only spending row
  // never reached the store and the row came back on the next reload.
  useEffect(() => {
    if (isLoading) return
    const timer = setTimeout(saveData, 1000)
    return () => clearTimeout(timer)
  }, [isLoading, trades, uploads, plans, payouts, spendings, saveData])

  const handleFile = async (file) => {
    if (file.type.startsWith('image/')) {
      setIsParsing(true)
      try {
        const imageBase64 = await fileToJpegBase64(file)
        const res = await fetch('/api/parse-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64, mediaType: 'image/jpeg' })
        })
        // Anything other than JSON means the request never reached the handler:
        // a gateway timeout, or the SPA redirect answering with index.html.
        if (!(res.headers.get('content-type') || '').includes('application/json')) {
          throw new Error(
            res.status === 504 || res.status === 502
              ? `the vision API timed out at the gateway (HTTP ${res.status})`
              : `/api/parse-image did not respond (HTTP ${res.status}). Is the Netlify function deployed?`
          )
        }
        const payload = await res.json().catch(() => null)
        // Without this check an error body lands in the table as a trade row.
        if (!res.ok || !payload || payload.error) {
          throw new Error(payload?.error || `the parser returned ${res.status}`)
        }
        const uploadId = newUploadId()
        setUploads(prev => [{ id: uploadId, filename: file.name, date: new Date().toISOString(), count: 1 }, ...prev].slice(0, 50))

        if (isChartPlan(payload)) {
          const plan = normalizeChartPlan(payload, file.name)
          const idx = tradesRef.current.findIndex(t => planMatches(t, plan))
          if (idx === -1) {
            setPlans(prev => [plan, ...prev].slice(0, 50))
            showToast(`Saved the ${plan.symbol} setup — waiting on its P&L card`)
          } else {
            setTrades(prev => prev.map((t, i) => (i === idx ? mergePlan(t, plan) : t)))
            showToast(`Added SL/TP to ${plan.symbol} from ${file.name}`)
          }
          return
        }

        const trade = normalizeExtractedTrade(payload, file.name)
        const planIdx = plansRef.current.findIndex(p => planMatches(trade, p))
        const row = planIdx === -1 ? trade : mergePlan(trade, plansRef.current[planIdx])
        if (planIdx !== -1) setPlans(prev => prev.filter((_, i) => i !== planIdx))
        setTrades(prev => [{ ...row, uploadId }, ...prev])
        showToast(planIdx === -1
          ? `Extracted ${row.symbol} from ${file.name}`
          : `Paired ${row.symbol} with its chart`)
      } catch (err) {
        console.error('Image import failed:', err)
        showToast(`Couldn't read that screenshot — ${err.message}`, 'error')
      } finally {
        setIsParsing(false)
      }
      return
    }

    if (!/\.csv$/i.test(file.name)) { showToast('Please upload a CSV or image file', 'error'); return }
    const reader = new FileReader()
    reader.onload = (e) => {
      const { headers, records } = parseCSV(e.target.result)

      if (!headers.length) { showToast(`${file.name} is empty`, 'error'); return }
      // A header with no rows under it is a real thing to export, and reporting
      // "imported 0 trades" for it reads like the import failed.
      if (!records.length) {
        showToast(`${file.name} has column headers but no rows — nothing to import`, 'error')
        return
      }

      const uploadId = newUploadId()
      const note = (count, kind) => {
        setUploads(prev => [{ id: uploadId, filename: file.name, date: new Date().toISOString(), count, kind }, ...prev].slice(0, 50))
      }

      const vest = detectVestFormat(headers)

      if (vest === 'vest-payouts') {
        const rows = parseVestPayouts(records)
        setPayouts(prev => {
          const seen = new Set(prev.map(p => p.id))
          const fresh = rows.filter(p => !seen.has(p.id)).map(p => ({ ...p, uploadId }))
          return [...fresh, ...prev].sort((a, b) => b.sortKey - a.sortKey)
        })
        note(rows.length, 'payouts')
        showToast(`${rows.length} payouts from ${file.name} — withdrawals, so they stay out of your stats`)
        return
      }

      if (vest === 'vest-trades') {
        const result = parseVestTrades(records)
        // Vest's order export and its trade export overlap: the same position
        // arrives in both files, and a second copy of it inflates every figure
        // on the Analytics tab. position_id is the venue own identity for a
        // trade, so it decides what is already here. The importer index-based
        // fallback id is not an identity -- it collides between files -- so a
        // row carrying one is always kept rather than wrongly dropped.
        const identity = (t) => (t.positionId && !String(t.positionId).startsWith('vest-') ? t.positionId : null)
        const known = new Set(tradesRef.current.map(identity).filter(Boolean))
        const fresh = result.trades.filter((t) => { const k = identity(t); return !k || !known.has(k) })
        const already = result.trades.length - fresh.length
        note(fresh.length, 'vest')
        if (!fresh.length) {
          showToast(already
            ? `Every trade in ${file.name} is already in the journal — nothing imported`
            : `No closed trades in ${file.name} — ${describeVestImport(result)}`, 'error')
          return
        }
        setTrades(prev => [...fresh.map(t => ({ ...t, uploadId })), ...prev])
        showToast(already
          ? `Vest: imported ${fresh.length}, skipped ${already} already in the journal`
          : `Vest: ${describeVestImport(result)}`)
        return
      }

      note(records.length, 'trades')
      setTrades(prev => [...records.map(r => ({ ...r, uploadId })), ...prev])
      showToast(`Imported ${records.length} trades from ${file.name}`)
    }
    reader.readAsText(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleDragOver = (e) => { e.preventDefault(); setDragActive(true) }
  const handleDragLeave = (e) => { e.preventDefault(); setDragActive(false) }

  const handleFileSelect = (e) => { const file = e.target.files[0]; if (file) handleFile(file) }

  const deleteTrade = (index) => {
    setTrades(prev => prev.filter((_, i) => i !== index))
  }

  // An upload goes out together with what it brought in, so removing a file
  // that was imported twice actually takes its rows back out of the stats.
  // Uploads recorded before they carried an id have nothing tying rows to
  // them: the confirm says so plainly instead of implying the stats will
  // change.
  const deleteUpload = (upload, index) => {
    const ownedTrades = upload.id ? trades.filter(t => t.uploadId === upload.id).length : 0
    const ownedPayouts = upload.id ? payouts.filter(p => p.uploadId === upload.id).length : 0
    const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's')
    const owned = [ownedTrades && plural(ownedTrades, 'trade'), ownedPayouts && plural(ownedPayouts, 'payout')].filter(Boolean)
    const question = upload.id
      ? (owned.length
          ? `Remove ${upload.filename} and the ${owned.join(' and ')} it imported?`
          : `Remove ${upload.filename}? Nothing in the journal came from it.`)
      : `Remove ${upload.filename} from this list? It was imported before uploads were tracked one by one, so its rows cannot be told apart from the rest and will stay in your stats.`
    if (!confirm(question)) return
    if (upload.id) {
      setTrades(prev => prev.filter(t => t.uploadId !== upload.id))
      setPayouts(prev => prev.filter(p => p.uploadId !== upload.id))
    }
    setUploads(prev => prev.filter((_, i) => i !== index))
    showToast(owned.length ? `Removed ${upload.filename} and its ${owned.join(' and ')}` : `Removed ${upload.filename}`)
  }

  // Spending is typed in by hand and cannot be re-imported from anywhere, so
  // it is not swept up with the things a CSV can put back. It goes one row at
  // a time on its own tab, and nothing else removes it.
  const clearAll = () => {
    if (confirm('Delete all trades, uploads, pending setups and payouts?\n\nYour spending records are kept — delete those on the Spendings tab.')) {
      setTrades([])
      setUploads([])
      setPlans([])
      setPayouts([])
      showToast('Cleared — spending records kept')
    }
  }

  const stats = calculateStats(trades)
  // One flag for the whole table, so its header and body can never disagree
  // about how many columns there are.
  const showGross = hasFeeData(trades)
  const equityData = generateEquityCurve([...trades].reverse())

  return (
    <div className="container">
      <header>
        <h1>Edge — Futures Trading Journal</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className={`status-dot ${trades.length ? 'connected' : ''}`}></span>
          <span className="mono" style={{ fontSize: '0.75rem' }}>
            {trades.length} trades · {uploads.length} uploads
          </span>
          <button className="btn btn-danger" onClick={clearAll}>Clear All</button>
        </div>
      </header>

      <div className="tab-nav">
        <button className={`tab ${activeTab === 'journal' ? 'active' : ''}`} onClick={() => setActiveTab('journal')}>Journal</button>
        <button className={`tab ${activeTab === 'calendar' ? 'active' : ''}`} onClick={() => setActiveTab('calendar')}>Calendar</button>
        <button className={`tab ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>Analytics</button>
        <button className={`tab ${activeTab === 'payouts' ? 'active' : ''}`} onClick={() => setActiveTab('payouts')}>Payouts</button>
        <button className={`tab ${activeTab === 'spendings' ? 'active' : ''}`} onClick={() => setActiveTab('spendings')}>Spendings</button>
        <button className={`tab ${activeTab === 'office' ? 'active' : ''}`} onClick={() => setActiveTab('office')}>Agent Office</button>
        <button className={`tab ${activeTab === 'uploads' ? 'active' : ''}`} onClick={() => setActiveTab('uploads')}>Uploads</button>
      </div>

      {activeTab === 'office' && (
        <div className="card" style={{ marginTop: 24 }}>
          <AgentOffice />
        </div>
      )}

      {activeTab === 'journal' && (
        <>
          <div className={`card upload-area ${dragActive ? 'drag' : ''}`} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
            <input type="file" accept=".csv,image/*" onChange={handleFileSelect} id="fileInput" />
            <label htmlFor="fileInput" style={{ cursor: 'pointer' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>📁</div>
              <div>Drag & drop CSV or Trade Screenshots (P&L / Chart) here</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 8 }}>Tradovate CSV · Vest order &amp; payout CSV · chart images with auto SL/TP extraction</div>
            </label>
          </div>

          {plans.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <strong>Chart setups waiting on a P&L card</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{plans.length} pending</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Symbol</th><th>Side</th><th>Entry</th><th>SL</th><th>TP</th><th>Planned</th><th>TF</th><th>Date</th><th>From</th><th></th></tr>
                  </thead>
                  <tbody>
                    {plans.map((p, i) => {
                      const { plannedRR } = riskMetrics(p)
                      return (
                        <tr key={i}>
                          <td className="mono">{p.symbol}</td>
                          <td className="mono">{p.side || '-'}</td>
                          <td className="mono">{price(p.buyPrice)}</td>
                          <td className="mono">{price(p.stopLoss)}</td>
                          <td className="mono">{price(p.takeProfit)}</td>
                          <td className="mono">{plannedRR === null ? '-' : `${plannedRR.toFixed(2)}R`}</td>
                          <td className="mono">{p.timeframe || '-'}</td>
                          <td className="mono">{p.tradeDate || '-'}</td>
                          <td className="mono" style={{ color: 'var(--muted)' }}>{p.source}</td>
                          <td><button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={() => setPlans(prev => prev.filter((_, n) => n !== i))}>Discard</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 24 }}>
            {trades.length === 0 ? (
              <div className="empty">No trades yet. Upload a CSV to get started.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th><th>Symbol</th><th>Qty</th><th>Entry</th><th>Exit</th><th>SL</th><th>TP</th><th>R</th>
                      {showGross && <><th>Gross</th><th>Fee</th></>}
                      <th>{showGross ? 'Net' : 'P&L'}</th><th>Date</th><th>Duration</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => {
                      const { rMultiple } = riskMetrics(t)
                      return (
                        <tr key={i}>
                          <td className="mono">{i + 1}</td>
                          <td className="mono">{t.symbol}</td>
                          <td className="mono">{t.qty}</td>
                          <td className="mono">{parseFloat(t.buyPrice || t.entryPrice || 0).toLocaleString()}</td>
                          <td className="mono">{parseFloat(t.sellPrice || t.exitPrice || 0).toLocaleString()}</td>
                          <td className="mono">{price(t.stopLoss)}</td>
                          <td className="mono">{price(t.takeProfit)}</td>
                          <td className={`mono ${rMultiple === null ? '' : rMultiple >= 0 ? 'pnl-green' : 'pnl-red'}`}>
                            {rMultiple === null ? '-' : `${rMultiple >= 0 ? '+' : ''}${rMultiple.toFixed(2)}R`}
                          </td>
                          {showGross && (
                            <>
                              <td className={`mono ${grossOf(t) >= 0 ? 'pnl-green' : 'pnl-red'}`}>
                                {grossOf(t) >= 0 ? '+' : ''}{grossOf(t).toFixed(2)}
                              </td>
                              <td className="mono muted-cell">-{feesOf(t).toFixed(2)}</td>
                            </>
                          )}
                          <td className={`mono ${formatPnL(t.pnl) >= 0 ? 'pnl-green' : 'pnl-red'}`}>
                            {formatPnL(t.pnl) >= 0 ? '+' : ''}{formatPnL(t.pnl).toFixed(2)}
                          </td>
                          <td className="mono">{t.boughtTimestamp?.split(' ')[0] || ''}</td>
                          <td className="mono">{t.duration}</td>
                          <td><button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={() => deleteTrade(i)}>Delete</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </>
      )}

      {activeTab === 'calendar' && (
        <TradeCalendar trades={trades} />
      )}

      {activeTab === 'payouts' && (
        payouts.length > 0
          ? <Payouts rows={payouts} onClear={() => setPayouts([])} />
          : <div className="card"><div className="empty">No payouts imported. Drop a Vest payout CSV on the Journal tab.</div></div>
      )}

      {activeTab === 'spendings' && (
        <Spendings
          rows={spendings}
          netPnl={stats ? stats.totalPnL : 0}
          onAdd={(row) => setSpendings(prev => [...prev, row])}
          onDelete={(id) => setSpendings(prev => prev.filter(r => r.id !== id))}
        />
      )}

      {activeTab === 'analytics' && (
        <div className="card">
          {stats ? (
            <>
              <div className="stats-grid">
                {stats.hasFees && (
                  <>
                    <div className="stat">
                      <div className="stat-label">Gross P&L</div>
                      <div className={`stat-value mono ${stats.grossPnL >= 0 ? 'green' : 'red'}`}>
                        {money(stats.grossPnL)}
                      </div>
                      <div className="stat-note">before fees</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">Fees</div>
                      <div className="stat-value mono red">-{money(stats.totalFees)}</div>
                      <div className="stat-note">
                        {stats.grossPnL !== 0
                          ? `${((stats.totalFees / Math.abs(stats.grossPnL)) * 100).toFixed(1)}% of gross`
                          : 'of a flat book'}
                      </div>
                    </div>
                  </>
                )}
                <div className="stat">
                  <div className="stat-label">Net P&L</div>
                  <div className={`stat-value mono ${stats.totalPnL >= 0 ? 'green' : 'red'}`}>
                    {money(stats.totalPnL)}
                  </div>
                  {stats.hasFees && <div className="stat-note">after fees</div>}
                </div>
                <div className="stat">
                  <div className="stat-label">Win Rate</div>
                  <div className="stat-value mono">{stats.winRate}%</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Profit Factor</div>
                  <div className="stat-value mono">{stats.profitFactor}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Expectancy</div>
                  <div className={`stat-value mono ${stats.expectancy >= 0 ? 'green' : 'red'}`}>
                    {money(stats.expectancy)}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">Avg Win</div>
                  <div className="stat-value mono green">{money(stats.avgWin)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Avg Loss</div>
                  <div className="stat-value mono red">{money(stats.avgLoss)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Max Drawdown</div>
                  <div className={`stat-value mono ${stats.maxDrawdown < 0 ? 'red' : ''}`}>{money(stats.maxDrawdown)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Total Trades</div>
                  <div className="stat-value mono">{stats.totalTrades}</div>
                </div>
              </div>

              <EquityCurve data={equityData} />
            </>
          ) : (
            <div className="empty">Upload trades to see analytics</div>
          )}
        </div>
      )}

      {activeTab === 'uploads' && (
        <div className="card">
          {uploads.length === 0 ? (
            <div className="empty">No uploads yet</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Filename</th><th>Date</th><th>Rows</th><th></th></tr>
                </thead>
                <tbody>
                  {uploads.map((u, i) => (
                    <tr key={u.id || i}>
                      <td>{u.filename}</td>
                      <td className="mono">{new Date(u.date).toLocaleString()}</td>
                      <td className="mono">{u.count}</td>
                      <td><button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={() => deleteUpload(u, i)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {isParsing && <div style={{ position: 'fixed', bottom: 24, left: 24, background: 'var(--card)', border: '1px solid var(--accent)', padding: '12px 20px', borderRadius: 8, zIndex: 100 }}>🤖 Analyzing screenshot & extracting SL/TP...</div>}
      {isSaving && <div style={{ position: 'fixed', bottom: 24, left: 24, fontSize: '0.75rem', color: 'var(--muted)' }}>Saving…</div>}
    </div>
  )
}