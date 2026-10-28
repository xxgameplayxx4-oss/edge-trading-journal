import { useState } from 'react'
import { money, signedMoney } from '../lib/pnl'

// The equity curve, drawn against a real dollar scale that always contains $0.
//
// The chart this replaces drew into a 100x100 box with preserveAspectRatio
// "none", which stretches the stroke by a different factor on each axis — the
// reason the line came out as a wedge. Here the viewBox has the same aspect
// ratio as the box it is rendered into, so a 2px stroke is 2px everywhere, and
// every coordinate below is in those user units.

const W = 800
const H = 320
const PAD = { top: 18, right: 18, bottom: 36, left: 64 }
const PLOT = {
  left: PAD.left,
  right: W - PAD.right,
  top: PAD.top,
  bottom: H - PAD.bottom,
}
const PLOT_W = PLOT.right - PLOT.left
const PLOT_H = PLOT.bottom - PLOT.top

// Round axis numbers people actually read: 1, 2, 2.5, 5 and 10 per decade.
function niceScale(min, max, target = 5) {
  const span = max - min || 1
  const mag = Math.pow(10, Math.floor(Math.log10(span / target)))
  const norm = span / target / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks = []
  for (let v = lo; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)))
  return { ticks, lo, hi, step }
}

// The axis repeats the same year on every tick, which costs width and says
// nothing. The readout under the chart still shows the full date on hover.
const shortDate = (d) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/\d{4}$/.exec(String(d || '').trim())
  return m ? `${m[1]}/${m[2]}` : d
}

const tickLabel = (v, step) => {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`
  return `${sign}$${abs.toFixed(step < 1 ? 2 : 0)}`
}

export default function EquityCurve({ data }) {
  const [hover, setHover] = useState(null)

  if (!data || data.length < 1) {
    return <div className="empty">Not enough trades yet to draw a curve.</div>
  }

  // A curve has to start somewhere, and that somewhere is flat zero before the
  // first trade. Without it the first point sits on the axis and the opening
  // trade's result is invisible.
  const points = [{ equity: 0, date: '', tradeNum: 0, pnl: 0 }, ...data.map((d, i) => ({
    ...d,
    pnl: d.equity - (i === 0 ? 0 : data[i - 1].equity),
  }))]

  const values = points.map((p) => p.equity)
  // $0 is always in frame — that is the line the whole chart is read against.
  const { ticks, lo, hi, step } = niceScale(Math.min(0, ...values), Math.max(0, ...values))
  const span = hi - lo || 1

  const x = (i) => (points.length === 1 ? PLOT.left + PLOT_W / 2 : PLOT.left + (i / (points.length - 1)) * PLOT_W)
  const y = (v) => PLOT.bottom - ((v - lo) / span) * PLOT_H

  const zeroY = y(0)
  // Where $0 falls as a fraction of the plot, so the gradients can switch
  // colour exactly on that line instead of guessing.
  const zeroPct = `${((zeroY - PLOT.top) / PLOT_H) * 100}%`

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(p.equity).toFixed(2)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(2)} ${zeroY.toFixed(2)} L${x(0).toFixed(2)} ${zeroY.toFixed(2)} Z`

  const last = points[points.length - 1]
  const peak = points.reduce((best, p) => (p.equity > best.equity ? p : best), points[0])

  // Dates are too long to print under every point, so thin them out.
  const labelEvery = Math.max(1, Math.ceil((points.length - 1) / 6))

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    // The viewBox fills the box exactly, so this ratio maps straight to user units.
    const userX = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((userX - PLOT.left) / PLOT_W) * (points.length - 1))
    setHover(Math.min(points.length - 1, Math.max(0, i)))
  }

  const active = hover === null ? null : points[hover]

  return (
    <div className="equity">
      <div className="equity-head">
        <div>
          <div className="stat-label">Equity</div>
          <div className={`stat-value ${last.equity >= 0 ? 'green' : 'red'}`}>{signedMoney(last.equity)}</div>
        </div>
        <div className="equity-legend">
          <span>Peak {signedMoney(peak.equity)}</span>
          <span>{data.length} trade{data.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {/* The CSS gives the box the same aspect ratio as the viewBox, so nothing
          is scaled unevenly. "meet" rather than "none" means that if that ever
          stops being true the chart letterboxes instead of distorting every
          stroke, which is what went wrong with the chart this replaces. */}
      <svg
        className="equity-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Equity curve, currently ${signedMoney(last.equity)} over ${data.length} trades`}
      >
        <defs>
          {/* Both gradients are pinned to the plot in user space so the colour
              break lands exactly on $0 rather than halfway down the box. */}
          <linearGradient id="eqFill" gradientUnits="userSpaceOnUse" x1="0" y1={PLOT.top} x2="0" y2={PLOT.bottom}>
            <stop offset="0%" stopColor="var(--green)" stopOpacity="0.32" />
            <stop offset={zeroPct} stopColor="var(--green)" stopOpacity="0" />
            <stop offset={zeroPct} stopColor="var(--red)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--red)" stopOpacity="0.32" />
          </linearGradient>
          <linearGradient id="eqStroke" gradientUnits="userSpaceOnUse" x1="0" y1={PLOT.top} x2="0" y2={PLOT.bottom}>
            <stop offset={zeroPct} stopColor="var(--green)" />
            <stop offset={zeroPct} stopColor="var(--red)" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PLOT.left} x2={PLOT.right} y1={y(t)} y2={y(t)}
              stroke={t === 0 ? 'var(--muted)' : 'var(--border)'}
              strokeWidth={t === 0 ? 1.5 : 1}
              strokeDasharray={t === 0 ? '' : '4 5'}
            />
            <text
              x={PLOT.left - 10} y={y(t)}
              textAnchor="end" dominantBaseline="middle"
              className={`equity-tick ${t === 0 ? 'equity-tick-zero' : ''}`}
            >
              {tickLabel(t, step)}
            </text>
          </g>
        ))}

        <path d={area} fill="url(#eqFill)" />
        <path d={line} fill="none" stroke="url(#eqStroke)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => {
          const isLast = i === points.length - 1
          // The last label always wins its spot; a regular one that would land
          // on top of it is dropped rather than drawn over it.
          const show = i > 0 && (isLast || (i % labelEvery === 0 && points.length - 1 - i >= labelEvery))
          if (!show) return null
          return (
            <text
              key={`xl-${i}`} x={x(i)} y={PLOT.bottom + 20}
              textAnchor={isLast ? 'end' : 'middle'} className="equity-tick"
            >
              {shortDate(p.date) || `#${p.tradeNum}`}
            </text>
          )
        })}

        {points.map((p, i) => (
          <circle
            key={`pt-${i}`} cx={x(i)} cy={y(p.equity)} r={hover === i ? 5 : 3}
            fill={p.equity >= 0 ? 'var(--green)' : 'var(--red)'}
            stroke="var(--bg)" strokeWidth="1.5"
          />
        ))}

        {active && (
          <line
            x1={x(hover)} x2={x(hover)} y1={PLOT.top} y2={PLOT.bottom}
            stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 4"
          />
        )}
      </svg>

      <div className="equity-readout">
        {active ? (
          <>
            <span className="mono">{active.tradeNum === 0 ? 'Start' : `Trade #${active.tradeNum}`}</span>
            {active.date && <span className="equity-dim">{active.date}</span>}
            <span className={`mono ${active.equity >= 0 ? 'pnl-green' : 'pnl-red'}`}>{signedMoney(active.equity)}</span>
            {active.tradeNum > 0 && (
              <span className={`mono equity-delta ${active.pnl >= 0 ? 'pnl-green' : 'pnl-red'}`}>
                {active.pnl >= 0 ? '+' : ''}{active.pnl.toFixed(2)} on this trade
              </span>
            )}
          </>
        ) : (
          <span className="equity-dim">
            Hover the curve to read any point. Scale runs {tickLabel(lo, step)} to {tickLabel(hi, step)}, zero line marked.
          </span>
        )}
      </div>
    </div>
  )
}
