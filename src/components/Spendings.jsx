import { useMemo, useState } from 'react'
import { money, signedMoney } from '../lib/pnl'

// What the trading costs you outside the trades themselves — data feeds, prop
// firm resets, courses, hardware. Kept apart from trade P&L so it can never
// move the win rate, but subtracted at the end, because a profitable month that
// bought a $300 course was not a profitable month.

const CATEGORIES = ['Data & feeds', 'Software', 'Education', 'Prop firm / resets', 'Hardware', 'Fees & interest', 'Other']

const todayValue = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const monthOf = (iso) => String(iso || '').slice(0, 7)

const pretty = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (iso || '-')
}

export default function Spendings({ rows, onAdd, onDelete, netPnl }) {
  const [date, setDate] = useState(todayValue)
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')

  const totals = useMemo(() => {
    const total = rows.reduce((s, r) => s + (r.amount || 0), 0)
    const thisMonth = monthOf(todayValue())
    const month = rows.filter((r) => monthOf(r.date) === thisMonth).reduce((s, r) => s + (r.amount || 0), 0)

    const byCategory = new Map()
    for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) || 0) + (r.amount || 0))
    const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1])

    return { total, month, ranked, top: ranked[0] || null }
  }, [rows])

  const submit = (e) => {
    e.preventDefault()
    const value = parseFloat(String(amount).replace(/[^0-9.-]/g, ''))
    if (!Number.isFinite(value) || value === 0) { setError('Enter an amount.'); return }
    if (!label.trim()) { setError('Give it a name so the list stays readable.'); return }
    setError('')
    onAdd({
      id: `sp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: date || todayValue(),
      label: label.trim(),
      category,
      amount: Math.abs(value),
    })
    setLabel('')
    setAmount('')
  }

  const ordered = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)))

  return (
    <>
      <div className="stats-grid">
        <div className="stat">
          <div className="stat-label">Total Spent</div>
          <div className="stat-value red">{money(totals.total)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">This Month</div>
          <div className="stat-value">{money(totals.month)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Entries</div>
          <div className="stat-value">{rows.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Biggest Category</div>
          <div className="stat-value" style={{ fontSize: '1.05rem' }}>
            {totals.top ? totals.top[0] : '-'}
          </div>
          {totals.top && <div className="cal-stat-note">{money(totals.top[1])}</div>}
        </div>
        <div className="stat">
          <div className="stat-label">Trading P&amp;L After Spending</div>
          <div className={`stat-value ${netPnl - totals.total >= 0 ? 'green' : 'red'}`}>
            {signedMoney(netPnl - totals.total)}
          </div>
          <div className="cal-stat-note">{signedMoney(netPnl)} traded less {money(totals.total)} spent</div>
        </div>
      </div>

      <div className="card">
        <strong>Log a cost</strong>
        <form className="spend-form" onSubmit={submit}>
          <label className="spend-field">
            <span className="stat-label">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="spend-field spend-grow">
            <span className="stat-label">What was it</span>
            <input type="text" value={label} placeholder="TradingView Premium" onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="spend-field">
            <span className="stat-label">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="spend-field spend-amount">
            <span className="stat-label">Amount</span>
            <input type="text" inputMode="decimal" value={amount} placeholder="59.95" onChange={(e) => setAmount(e.target.value)} />
          </label>
          <button className="btn btn-primary" type="submit">Add</button>
        </form>
        {error && <div className="spend-error">{error}</div>}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="spend-head">
          <strong>Spending</strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            {rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · {money(totals.total)}
          </span>
        </div>

        {!rows.length ? (
          <div className="empty">Nothing logged yet. Add what the trading costs you and it totals up here.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>What</th><th>Category</th><th>Amount</th><th></th></tr>
              </thead>
              <tbody>
                {ordered.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{pretty(r.date)}</td>
                    <td>{r.label}</td>
                    <td><span className="spend-tag">{r.category}</span></td>
                    <td className="mono pnl-red">{money(r.amount)}</td>
                    <td>
                      <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.75rem' }} onClick={() => onDelete(r.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totals.ranked.length > 1 && (
          <div className="spend-breakdown">
            {totals.ranked.map(([name, value]) => (
              <div key={name} className="spend-bar-row">
                <span className="spend-bar-name">{name}</span>
                <span className="spend-bar-track">
                  <span className="spend-bar-fill" style={{ width: `${(value / totals.ranked[0][1]) * 100}%` }} />
                </span>
                <span className="mono spend-bar-value">{money(value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
