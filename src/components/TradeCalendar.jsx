import { useMemo, useState } from 'react'
import { formatPnL, money, signedMoney, tradeDate, dayKey, grossOf, feesOf, hasFeeData } from '../lib/pnl'

// A month of trading, won and lost. This reads trades only — payouts are
// withdrawals and have their own tab, so nothing here ever sees them.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const price = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n.toLocaleString() : '-'
}

export default function TradeCalendar({ trades }) {
  const [cursor, setCursor] = useState(null)
  const [selected, setSelected] = useState(null)

  const { byDay, undated, latest } = useMemo(() => {
    const byDay = new Map()
    let undated = 0
    let latest = null

    for (const t of trades) {
      const date = tradeDate(t)
      if (!date) { undated++; continue }
      const key = dayKey(date)
      if (!byDay.has(key)) byDay.set(key, { date, trades: [], net: 0, wins: 0 })
      const entry = byDay.get(key)
      const pnl = formatPnL(t.pnl)
      entry.trades.push(t)
      entry.net += pnl
      if (pnl > 0) entry.wins++
      if (!latest || date > latest) latest = date
    }
    return { byDay, undated, latest }
  }, [trades])

  // Open on the most recent month that actually has trades. Deriving the view
  // instead of seeding state means it is still right when trades arrive from
  // the backend a moment after the first render.
  const anchor = latest || new Date()
  const view = cursor || { year: anchor.getFullYear(), month: anchor.getMonth() }

  const shift = (by) => {
    const m = view.month + by
    setCursor({ year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 })
    setSelected(null)
  }

  const inMonth = [...byDay.values()].filter(
    (d) => d.date.getFullYear() === view.year && d.date.getMonth() === view.month
  )

  const monthTrades = inMonth.flatMap((d) => d.trades)
  const monthNet = inMonth.reduce((s, d) => s + d.net, 0)
  const monthWins = monthTrades.filter((t) => formatPnL(t.pnl) > 0).length
  const monthGross = monthTrades.reduce((s, t) => s + grossOf(t), 0)
  const monthFees = monthTrades.reduce((s, t) => s + feesOf(t), 0)
  const showGross = hasFeeData(monthTrades)
  const ranked = [...inMonth].sort((a, b) => b.net - a.net)
  const bestDay = ranked[0]
  const worstDay = ranked.length > 1 ? ranked[ranked.length - 1] : null

  // Monday-first, so getDay()'s Sunday-as-0 has to be rotated.
  const lead = (new Date(view.year, view.month, 1).getDay() + 6) % 7
  const length = new Date(view.year, view.month + 1, 0).getDate()
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, i) => i + 1),
  ]
  while (cells.length % 7) cells.push(null)

  const today = dayKey(new Date())
  const open = selected ? byDay.get(selected) : null

  return (
    <div className="cal">
      <div className="cal-bar">
        <button className="btn btn-secondary cal-nav" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <strong className="cal-title">{MONTHS[view.month]} {view.year}</strong>
        <button className="btn btn-secondary cal-nav" onClick={() => shift(1)} aria-label="Next month">›</button>
        {cursor && (
          <button className="btn btn-secondary cal-today" onClick={() => { setCursor(null); setSelected(null) }}>
            Latest
          </button>
        )}
      </div>

      <div className="stats-grid cal-stats">
        {showGross && (
          <div className="stat">
            <div className="stat-label">Month Gross</div>
            <div className={`stat-value ${monthGross >= 0 ? 'green' : 'red'}`}>{signedMoney(monthGross)}</div>
            <div className="cal-stat-note">-{money(monthFees)} in fees</div>
          </div>
        )}
        <div className="stat">
          <div className="stat-label">Month {showGross ? 'Net' : 'P&L'}</div>
          <div className={`stat-value ${monthNet >= 0 ? 'green' : 'red'}`}>{signedMoney(monthNet)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Trades</div>
          <div className="stat-value">{monthTrades.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Win Rate</div>
          <div className="stat-value">
            {monthTrades.length ? `${((monthWins / monthTrades.length) * 100).toFixed(1)}%` : '-'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Best Day</div>
          <div className={`stat-value ${bestDay && bestDay.net < 0 ? 'red' : 'green'}`}>
            {bestDay ? signedMoney(bestDay.net) : '-'}
          </div>
          {bestDay && (
            <div className="cal-stat-note">{MONTHS[view.month].slice(0, 3)} {bestDay.date.getDate()}</div>
          )}
        </div>
        <div className="stat">
          <div className="stat-label">Worst Day</div>
          {/* Shown whatever its sign: a month where even the worst day was green
              is worth seeing, and a dash there reads as missing data. */}
          <div className={`stat-value ${worstDay && worstDay.net >= 0 ? 'green' : 'red'}`}>
            {worstDay ? signedMoney(worstDay.net) : '-'}
          </div>
          {worstDay && (
            <div className="cal-stat-note">{MONTHS[view.month].slice(0, 3)} {worstDay.date.getDate()}</div>
          )}
        </div>
      </div>

      <div className="cal-grid cal-dow-row">
        {WEEKDAYS.map((d) => <div key={d} className="cal-dow">{d}</div>)}
      </div>

      <div className="cal-grid">
        {cells.map((day, i) => {
          if (day === null) return <div key={`pad-${i}`} className="cal-cell cal-pad" />

          const date = new Date(view.year, view.month, day)
          const key = dayKey(date)
          const entry = byDay.get(key)
          const weekend = i % 7 >= 5
          const tone = entry ? (entry.net >= 0 ? 'cal-up' : 'cal-down') : ''

          return (
            <button
              key={key}
              type="button"
              className={`cal-cell ${tone} ${weekend && !entry ? 'cal-weekend' : ''} ${selected === key ? 'cal-selected' : ''} ${key === today ? 'cal-is-today' : ''}`}
              disabled={!entry}
              onClick={() => setSelected(selected === key ? null : key)}
            >
              <span className="cal-num">{day}</span>
              {entry && (
                <>
                  <span className={`cal-pnl mono ${entry.net >= 0 ? 'pnl-green' : 'pnl-red'}`}>
                    {signedMoney(entry.net)}
                  </span>
                  <span className="cal-count">
                    {entry.trades.length} trade{entry.trades.length === 1 ? '' : 's'} · {entry.wins}W
                  </span>
                </>
              )}
            </button>
          )
        })}
      </div>

      {!inMonth.length && (
        <div className="empty cal-none">No trades in {MONTHS[view.month]} {view.year}.</div>
      )}

      {undated > 0 && (
        <div className="cal-undated">
          {undated} trade{undated === 1 ? '' : 's'} {undated === 1 ? 'has' : 'have'} no readable date and
          {' '}{undated === 1 ? 'is' : 'are'} not shown on the calendar — {signedMoney(
            trades.filter((t) => !tradeDate(t)).reduce((s, t) => s + formatPnL(t.pnl), 0)
          )} of P&amp;L. They still count on the Analytics tab.
        </div>
      )}

      {open && (
        <div className="cal-day-detail">
          <div className="cal-detail-head">
            <strong>
              {WEEKDAYS[(open.date.getDay() + 6) % 7]} {MONTHS[open.date.getMonth()]} {open.date.getDate()}
            </strong>
            <span className={`mono ${open.net >= 0 ? 'pnl-green' : 'pnl-red'}`}>
              {signedMoney(open.net)} · {open.trades.length} trade{open.trades.length === 1 ? '' : 's'} · {open.wins}W/{open.trades.length - open.wins}L
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th>
                  <th>P&amp;L</th><th>Held</th><th>Closed by</th>
                </tr>
              </thead>
              <tbody>
                {open.trades.map((t, i) => {
                  const pnl = formatPnL(t.pnl)
                  return (
                    <tr key={i}>
                      <td className="mono">{t.symbol}</td>
                      <td className="mono">{t.side || '-'}</td>
                      <td className="mono">{t.qty}</td>
                      <td className="mono">{price(t.buyPrice ?? t.entryPrice)}</td>
                      <td className="mono">{price(t.sellPrice ?? t.exitPrice)}</td>
                      <td className={`mono ${pnl >= 0 ? 'pnl-green' : 'pnl-red'}`}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                      </td>
                      <td className="mono">{t.duration || '-'}</td>
                      <td className="mono">{t.closeReason || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!trades.length && (
        <div className="empty">No trades yet. Import a CSV on the Journal tab and the days fill in here.</div>
      )}
    </div>
  )
}
