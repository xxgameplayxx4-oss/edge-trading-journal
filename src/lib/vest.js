// Vest exports, which are shaped nothing like Tradovate's.
//
// A Tradovate performance CSV is already a list of round trips, so its columns
// drop straight into a journal row. Vest exports an *order log*: one row per
// order, several rows per position, and a position only becomes a trade once
// something closed it. So these rows have to be folded back into positions
// before any of it means anything.
//
// The payout export is not trades at all — it is money leaving the account —
// and it is kept well away from every statistic.

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

// Tolerant column lookup, so a renamed header does not silently read as empty.
function field(record, ...names) {
  const map = {}
  for (const k of Object.keys(record)) map[norm(k)] = record[k]
  for (const n of names) {
    const v = map[norm(n)]
    if (v !== undefined && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = parseFloat(String(v).replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

const when = (v) => {
  if (!v) return null
  const d = new Date(String(v).trim())
  return isNaN(d.getTime()) ? null : d
}

// The trades table splits this on the space to get its date column, so the
// shape matters as much as the value.
function stamp(d) {
  if (!d) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function holdTime(a, b) {
  if (!a || !b) return ''
  const secs = Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return [h && `${h}hr`, (h || m) && `${m}min`, `${s}sec`].filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Which export is this?
// ---------------------------------------------------------------------------
export function detectVestFormat(headers) {
  const set = new Set((headers || []).map(norm))
  const has = (...names) => names.every((n) => set.has(norm(n)))

  if (has('position_id', 'executed_quantity', 'realized_pnl')) return 'vest-trades'
  if (has('requested_amount', 'trader_amount', 'platform_amount')) return 'vest-payouts'
  return null
}

// ---------------------------------------------------------------------------
// Payouts — withdrawals, deliberately not trades
// ---------------------------------------------------------------------------
export function parseVestPayouts(records) {
  const payouts = []

  for (const r of records) {
    const requested = num(field(r, 'requested_amount'))
    if (requested === null) continue

    const created = when(field(r, 'created_at'))
    const executed = when(field(r, 'executed_at'))

    payouts.push({
      id: field(r, 'id'),
      requested,
      trader: num(field(r, 'trader_amount')) ?? 0,
      platform: num(field(r, 'platform_amount')) ?? 0,
      status: field(r, 'status') || 'unknown',
      failureReason: field(r, 'failure_reason'),
      requestedAt: stamp(created),
      paidAt: stamp(executed),
      sortKey: (executed || created || new Date(0)).getTime(),
    })
  }

  payouts.sort((a, b) => b.sortKey - a.sortKey)
  return payouts
}

export function payoutTotals(payouts) {
  const sum = (list, key) => list.reduce((acc, p) => acc + (p[key] ?? 0), 0)
  const settled = payouts.filter((p) => /execut|complete|paid|success/i.test(p.status))
  const failed = payouts.filter((p) => /fail|reject|cancel/i.test(p.status))
  const pending = payouts.filter((p) => !settled.includes(p) && !failed.includes(p))

  return {
    count: payouts.length,
    requested: sum(payouts, 'requested'),
    toTrader: sum(payouts, 'trader'),
    toPlatform: sum(payouts, 'platform'),
    paid: sum(settled, 'trader'),
    pending: sum(pending, 'trader'),
    settledCount: settled.length,
    pendingCount: pending.length,
    failedCount: failed.length,
  }
}

// ---------------------------------------------------------------------------
// Trades — fold the order log back into round trips
// ---------------------------------------------------------------------------

function readRow(r) {
  const sideRaw = field(r, 'side')
  return {
    position: field(r, 'position_id'),
    symbol: field(r, 'symbol') || '—',
    rowType: field(r, 'row_type').toLowerCase(),
    intent: field(r, 'position_order_type').toLowerCase(), // open | append | reduce | close
    orderType: field(r, 'order_type').toLowerCase(),
    dir: /^(b|buy|long|bid)/i.test(sideRaw) ? 1 : /^(s|sell|short|ask)/i.test(sideRaw) ? -1 : 0,
    filled: num(field(r, 'executed_quantity')) ?? 0,
    price: num(field(r, 'execution_price')) ?? num(field(r, 'price')),
    trigger: num(field(r, 'trigger_price')),
    at: when(field(r, 'executed_at')) || when(field(r, 'updated_at')) || when(field(r, 'created_at')),
    created: when(field(r, 'created_at')) || when(field(r, 'executed_at')),
    fee: num(field(r, 'fee')) ?? 0,
    realized: num(field(r, 'realized_pnl')) ?? 0,
    leverage: num(field(r, 'leverage')),
    closeReason: field(r, 'close_reason'),
    status: field(r, 'status').toLowerCase(),
  }
}

// `tpsl` rows are the bracket you set, not a fill: quantity 0, cancelled when
// the other side of the OCO wins. They are where the stop and the target live,
// which is the whole reason this importer can produce an R-multiple without a
// chart screenshot.
function levelsFor(rows, entry, dir) {
  const byAge = [...rows].sort((a, b) => (a.created?.getTime() ?? 0) - (b.created?.getTime() ?? 0))

  // The first bracket of each kind is the one that was set with the position,
  // which is the level the risk was actually taken against. Later ones are the
  // stop being moved, and a moved stop is not the risk that was accepted.
  const firstTrigger = (match, preferBracket) => {
    const candidates = byAge.filter((r) => match.test(r.orderType) && r.trigger !== null)
    const bracket = candidates.filter((r) => r.rowType === 'tpsl')
    const pool = preferBracket && bracket.length ? bracket : candidates
    return pool.length ? pool[0].trigger : null
  }

  const rawStop = firstTrigger(/stop_loss|stoploss|\bstop\b/, true)
  const rawTarget = firstTrigger(/take_profit|takeprofit|\btp\b/, true)

  // A stop sits on the losing side of the entry and a target on the winning
  // side. Anything else is a trailing stop that has been dragged into profit,
  // and treating that as the risk taken would invent an R-multiple out of it.
  const stopValid = rawStop !== null && entry !== null && (dir === 1 ? rawStop < entry : rawStop > entry)
  const targetValid = rawTarget !== null && entry !== null && (dir === 1 ? rawTarget > entry : rawTarget < entry)

  return {
    stopLoss: stopValid ? rawStop : null,
    takeProfit: targetValid ? rawTarget : null,
    trailingStop: rawStop !== null && !stopValid ? rawStop : null,
  }
}

// One journal entry per position, not per fill: scaling in and scaling out are
// one trade, and a row per fill would make the win rate meaningless.
function foldPosition(rows, idx) {
  const fills = rows
    .filter((r) => r.filled > 0 && r.dir !== 0 && r.price !== null)
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))

  if (!fills.length) return null

  // Vest labels every order with what it was for, so the direction is stated
  // rather than inferred. Older exports may not, hence the fallback.
  const opener = fills.find((f) => f.intent === 'open') || fills[0]
  const dir = opener.dir

  const isClose = (f) => (f.intent ? /reduce|close/.test(f.intent) : f.dir !== dir)
  const opens = fills.filter((f) => !isClose(f))
  const closes = fills.filter(isClose)
  if (!closes.length) return null // still open — not a completed trade

  const vwap = (list) => {
    const q = list.reduce((a, f) => a + f.filled, 0)
    return q ? list.reduce((a, f) => a + f.price * f.filled, 0) / q : null
  }

  const entry = vwap(opens)
  const exit = vwap(closes)
  const closedQty = Math.min(
    closes.reduce((a, f) => a + f.filled, 0),
    opens.reduce((a, f) => a + f.filled, 0)
  )

  const fees = fills.reduce((a, f) => a + f.fee, 0)
  const realized = fills.reduce((a, f) => a + f.realized, 0)

  // Vest's realized_pnl is the gross move and `fee` is charged on top of it, so
  // the net is one minus the other. When an export carries no realized figure
  // the prices still know what happened.
  const derived = entry !== null && exit !== null ? (exit - entry) * dir * closedQty : null
  const gross = realized !== 0 ? realized : (derived ?? 0)

  const entryTime = opens[0]?.at ?? null
  const exitTime = closes[closes.length - 1]?.at ?? null
  const last = closes[closes.length - 1]

  return {
    symbol: opener.symbol,
    side: dir === 1 ? 'Long' : 'Short',
    qty: Number(closedQty.toFixed(6)),
    // The app's convention throughout is buyPrice = entry, sellPrice = exit,
    // whichever way the trade was taken; the table and riskMetrics both read it
    // that way, so a short must not swap them.
    buyPrice: entry,
    sellPrice: exit,
    entryPrice: entry,
    exitPrice: exit,
    ...levelsFor(rows, entry, dir),
    pnl: gross - fees,
    grossPnl: gross,
    fees,
    leverage: opener.leverage,
    exits: closes.length,
    closeReason: (last?.closeReason || '').replace(/_/g, ' '),
    boughtTimestamp: stamp(entryTime),
    soldTimestamp: stamp(exitTime),
    duration: holdTime(entryTime, exitTime),
    venue: 'Vest',
    positionId: opener.position || `vest-${idx}`,
    source: 'vest-csv',
  }
}

export function parseVestTrades(records) {
  const rows = records.map(readRow)

  // position_id is the venue's own grouping and is what a journal entry should
  // follow. Without it, everything on one symbol is treated as one position,
  // which is right far more often than treating every fill as its own trade.
  const groups = new Map()
  for (const r of rows) {
    const key = r.position || `symbol:${r.symbol}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  const trades = []
  let open = 0
  let i = 0
  for (const group of groups.values()) {
    const trade = foldPosition(group, i++)
    if (trade) trades.push(trade)
    else open++
  }

  trades.sort((a, b) => new Date(b.soldTimestamp) - new Date(a.soldTimestamp))

  const filled = rows.filter((r) => r.filled > 0).length
  return { trades, open, fills: filled, brackets: rows.length - filled }
}

// What to tell the user after an import, including what was left out. A silent
// skip in a P&L importer is how a journal ends up quietly wrong.
export function describeVestImport({ trades, open, fills, brackets }) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const parts = [`${plural(trades.length, 'trade')} from ${plural(fills, 'fill')}`]
  const withR = trades.filter((t) => t.stopLoss !== null).length
  if (withR) parts.push(`${withR} with a stop on record`)
  if (open) parts.push(`${plural(open, 'position')} still open`)
  if (brackets) parts.push(`${plural(brackets, 'bracket order')} read for levels`)
  return parts.join(' · ')
}
