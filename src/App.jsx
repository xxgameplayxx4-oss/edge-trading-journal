import { useState, useEffect, useCallback } from 'react'

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
  const num = parseFloat(pnl.replace(/[$,()]/g, '').replace('-', ''))
  const isNegative = pnl.includes('(') || pnl.startsWith('-')
  return isNegative ? -num : num
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

  const handleFile = (file) => {
    if (!file.name.endsWith('.csv')) { showToast('Please upload a CSV file', 'error'); return }
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
        <button className={`tab ${activeTab === 'uploads' ? 'active' : ''}`} onClick={() => setActiveTab('uploads')}>Uploads</button>
      </div>

      {activeTab === 'journal' && (
        <>
          <div className={`card upload-area ${dragActive ? 'drag' : ''}`} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
            <input type="file" accept=".csv" onChange={handleFileSelect} id="fileInput" />
            <label htmlFor="fileInput" style={{ cursor: 'pointer' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>📁</div>
              <div>Drag & drop Tradovate CSV here, or click to browse</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 8 }}>Supports performance CSV export from Tradovate</div>
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
                      <th>#</th><th>Symbol</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Date</th><th>Duration</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => (
                      <tr key={i}>
                        <td className="mono">{i + 1}</td>
                        <td className="mono">{t.symbol}</td>
                        <td className="mono">{t.qty}</td>
                        <td className="mono">{parseFloat(t.buyPrice).toLocaleString()}</td>
                        <td className="mono">{parseFloat(t.sellPrice).toLocaleString()}</td>
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
                <svg viewBox="0 0 100% 300" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
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
      {isSaving && <div style={{ position: 'fixed', bottom: 24, left: 24, fontSize: '0.75rem', color: 'var(--muted)' }}>Saving…</div>}
    </div>
  )
}