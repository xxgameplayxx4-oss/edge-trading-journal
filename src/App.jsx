import { useState, useEffect, useCallback } from 'react'
import DockerOffice from './components/DockerOffice'

const API_URL = '/api/journal'

function parseCSV(text) {
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim())
    const obj = {}
    headers.forEach((h, i) => { obj[h] = values[i] })
    return obj
  })
}

function formatPnL(pnl) {
  if (typeof pnl === 'number') return Number.isFinite(pnl) ? pnl : 0
  if (pnl === null || pnl === undefined) return 0
  const raw = String(pnl).trim()
  if (!raw) return 0
  // Accounting style: $(45.00) means a loss, same as -45.00
  const isNegative = raw.includes('(') || raw.startsWith('-')
  const num = parseFloat(raw.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(num)) return 0
  return isNegative ? -num : num
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
      // Screenshots often carry transparency, which JPEG would flatten to black.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
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
function normalizeExtractedTrade(raw, filename) {
  return {
    symbol: raw.symbol || raw.contract || '—',
    side: raw.type || raw.side || '',
    qty: toNum(raw.qty) ?? 1,
    buyPrice: toNum(raw.entryPrice ?? raw.buyPrice) ?? 0,
    sellPrice: toNum(raw.exitPrice ?? raw.sellPrice) ?? 0,
    stopLoss: toNum(raw.stopLoss),
    takeProfit: toNum(raw.takeProfit),
    pnl: toNum(raw.pnl) ?? 0,
    boughtTimestamp: raw.openTime || raw.boughtTimestamp || new Date().toLocaleString(),
    soldTimestamp: raw.closeTime || raw.soldTimestamp || '',
    duration: raw.duration || '',
    source: filename || 'screenshot'
  }
}

function calculateStats(trades) {
  if (!trades.length) return null
  const pnls = trades.map(t => formatPnL(t.pnl))
  const wins = pnls.filter(p => p > 0)
  const losses = pnls.filter(p => p < 0)
  const totalPnL = pnls.reduce((a, b) => a + b, 0)
  const winRate = (wins.length / trades.length * 100).toFixed(1)
  const avgWin = wins.length ? (wins.reduce((a, b) => a + b, 0) / wins.length).toFixed(2) : 0
  const avgLoss = losses.length ? (losses.reduce((a, b) => a + b, 0) / losses.length).toFixed(2) : 0
  const profitFactor = losses.length ? Math.abs(wins.reduce((a, b) => a + b, 0) / losses.reduce((a, b) => a + b, 0)).toFixed(2) : '∞'
  const expectancy = (totalPnL / trades.length).toFixed(2)
  const maxDrawdown = Math.min(...pnls.map((_, i) => pnls.slice(0, i+1).reduce((a, b) => a + b, 0))).toFixed(2)
  return { totalPnL, winRate, avgWin, avgLoss, profitFactor, expectancy, maxDrawdown, totalTrades: trades.length }
}

function generateEquityCurve(trades) {
  let equity = 0
  return trades.map((t, i) => {
    equity += formatPnL(t.pnl)
    return { date: t.boughtTimestamp?.split(' ')[0] || '', equity, tradeNum: i + 1 }
  })
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
  const [activeTab, setActiveTab] = useState('journal')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [isParsing, setIsParsing] = useState(false)

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(API_URL)
      const data = await res.json()
      setTrades(data.trades || [])
      setUploads(data.uploads || [])
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
      await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades, uploads })
      })
      showToast('Data saved to cloud')
    } catch (e) {
      console.error('Save failed:', e)
      showToast('Failed to save', 'error')
    } finally {
      setIsSaving(false)
    }
  }, [trades, uploads])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (trades.length || uploads.length) {
      const timer = setTimeout(saveData, 1000)
      return () => clearTimeout(timer)
    }
  }, [trades, uploads, saveData])

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
        const payload = await res.json().catch(() => null)
        // Without this check an error body lands in the table as a trade row.
        if (!res.ok || !payload || payload.error) {
          throw new Error(payload?.error || `the parser returned ${res.status}`)
        }
        const trade = normalizeExtractedTrade(payload, file.name)
        setUploads(prev => [{ filename: file.name, date: new Date().toISOString(), count: 1 }, ...prev].slice(0, 50))
        setTrades(prev => [trade, ...prev])
        showToast(`Extracted ${trade.symbol} from ${file.name}`)
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
      const newTrades = parseCSV(e.target.result)
      const uploadRecord = { filename: file.name, date: new Date().toISOString(), count: newTrades.length }
      setUploads(prev => [uploadRecord, ...prev].slice(0, 50))
      setTrades(prev => [...newTrades, ...prev])
      showToast(`Imported ${newTrades.length} trades from ${file.name}`)
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

  const clearAll = () => {
    if (confirm('Delete all trades and uploads?')) {
      setTrades([])
      setUploads([])
      showToast('All data cleared')
    }
  }

  const stats = calculateStats(trades)
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
        <button className={`tab ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>Analytics</button>
        <button className={`tab ${activeTab === 'office' ? 'active' : ''}`} onClick={() => setActiveTab('office')}>Agent Office</button>
        <button className={`tab ${activeTab === 'uploads' ? 'active' : ''}`} onClick={() => setActiveTab('uploads')}>Uploads</button>
      </div>

      {activeTab === 'office' && (
        <div className="card" style={{ marginTop: 24 }}>
          <DockerOffice />
        </div>
      )}

      {activeTab === 'journal' && (
        <>
          <div className={`card upload-area ${dragActive ? 'drag' : ''}`} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
            <input type="file" accept=".csv,image/*" onChange={handleFileSelect} id="fileInput" />
            <label htmlFor="fileInput" style={{ cursor: 'pointer' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>📁</div>
              <div>Drag & drop CSV or Trade Screenshots (P&L / Chart) here</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 8 }}>Supports Tradovate CSV & chart images with auto SL/TP extraction</div>
            </label>
          </div>

          <div className="card" style={{ marginTop: 24 }}>
            {trades.length === 0 ? (
              <div className="empty">No trades yet. Upload a CSV to get started.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th><th>Symbol</th><th>Qty</th><th>Entry</th><th>Exit</th><th>SL</th><th>TP</th><th>P&L</th><th>Date</th><th>Duration</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => (
                      <tr key={i}>
                        <td className="mono">{i + 1}</td>
                        <td className="mono">{t.symbol}</td>
                        <td className="mono">{t.qty}</td>
                        <td className="mono">{parseFloat(t.buyPrice || t.entryPrice || 0).toLocaleString()}</td>
                        <td className="mono">{parseFloat(t.sellPrice || t.exitPrice || 0).toLocaleString()}</td>
                        <td className="mono">{t.stopLoss || '-'}</td>
                        <td className="mono">{t.takeProfit || '-'}</td>
                        <td className={`mono ${formatPnL(t.pnl) >= 0 ? 'pnl-green' : 'pnl-red'}`}>
                          {formatPnL(t.pnl) >= 0 ? '+' : ''}{formatPnL(t.pnl).toFixed(2)}
                        </td>
                        <td className="mono">{t.boughtTimestamp?.split(' ')[0] || ''}</td>
                        <td className="mono">{t.duration}</td>
                        <td><button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={() => deleteTrade(i)}>Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'analytics' && (
        <div className="card">
          {stats ? (
            <>
              <div className="stats-grid">
                <div className="stat">
                  <div className="stat-label">Net P&L</div>
                  <div className={`stat-value mono ${stats.totalPnL >= 0 ? 'green' : 'red'}`}>
                    ${parseFloat(stats.totalPnL).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
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
                    ${parseFloat(stats.expectancy).toFixed(2)}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">Avg Win</div>
                  <div className="stat-value mono green">${parseFloat(stats.avgWin).toFixed(2)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Avg Loss</div>
                  <div className="stat-value mono red">${parseFloat(stats.avgLoss).toFixed(2)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Max Drawdown</div>
                  <div className="stat-value mono red">${parseFloat(stats.maxDrawdown).toFixed(2)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Total Trades</div>
                  <div className="stat-value mono">{stats.totalTrades}</div>
                </div>
              </div>

              <div className="chart-wrap">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                  {equityData.length > 1 && (
                    <>
                      <defs>
                        <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--green)" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {(() => {
                        const minEq = Math.min(...equityData.map(d => d.equity))
                        const maxEq = Math.max(...equityData.map(d => d.equity))
                        const range = maxEq - minEq || 1
                        const points = equityData.map((d, i) => {
                          const x = (i / (equityData.length - 1)) * 100
                          const y = 100 - ((d.equity - minEq) / range * 80 + 10)
                          return `${x} ${y}`
                        }).join(' ')
                        return (
                          <>
                            <path d={`M${points}`} fill="url(#equityGrad)" />
                            <path d={`M${points}`} stroke="var(--green)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </>
                        )
                      })()}
                    </>
                  )}
                </svg>
              </div>
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
                  <tr><th>Filename</th><th>Date</th><th>Trades</th></tr>
                </thead>
                <tbody>
                  {uploads.map((u, i) => (
                    <tr key={i}>
                      <td>{u.filename}</td>
                      <td className="mono">{new Date(u.date).toLocaleString()}</td>
                      <td className="mono">{u.count}</td>
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