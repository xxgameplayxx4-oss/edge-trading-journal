// Money and dates, shared by anything that reads a trade.
//
// A trade reaches the app from two places and they do not agree on types. The
// Vest importer hands over real numbers and a 'MM/DD/YYYY HH:MM:SS' stamp; a
// Tradovate CSV row is whatever the venue wrote, so P&L can arrive as the
// string '$(45.00)' and the timestamp in another format entirely. Every reader
// goes through here so that difference is handled in one place.

export function formatPnL(pnl) {
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

export const money = (v) =>
  `$${(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const signedMoney = (v) => `${v >= 0 ? '+' : '-'}${money(Math.abs(v))}`

// The day a trade belongs to, at local midnight, or null when the stamp cannot
// be read. Returning null rather than a guess is deliberate: a trade silently
// filed under the wrong day is worse than one the calendar openly cannot place.
export function tradeDate(trade) {
  const raw = trade?.boughtTimestamp || trade?.soldTimestamp || trade?.date || ''
  const text = String(raw).trim()
  if (!text) return null

  // MM/DD/YYYY — what the Vest importer writes, and what Tradovate exports use.
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text)
  if (slash) {
    const [, m, d, y] = slash
    return midnight(+y, +m - 1, +d)
  }

  // YYYY-MM-DD, with or without a time. Parsed by hand rather than by Date,
  // because a bare 'YYYY-MM-DD' is read as UTC and shifts a day west of GMT.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
  if (iso) {
    const [, y, m, d] = iso
    return midnight(+y, +m - 1, +d)
  }

  const parsed = new Date(text)
  if (!isNaN(parsed.getTime())) return midnight(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
  return null
}

function midnight(y, m, d) {
  const date = new Date(y, m, d)
  return isNaN(date.getTime()) ? null : date
}

export const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
