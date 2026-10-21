import { useEffect, useState, useRef, useCallback } from 'react'
import OfficeFloor from './OfficeFloor'
import {
  DESKS, BENCH_LIMIT, ROOM_BY_ID, sourceMeta, stateMeta, deriveState,
  targetFor, benchSlot, relativeTime, shortModel
} from './officeLayout'

const API_URL = '/api/agents'
const REFRESH_MS = 60000
// Everyone enters through the reception door and walks to their room, so the
// floor has motion on load without inventing any state change.
const ENTRANCE = { x: 222, y: 404 }

// Shown only when the blob store is empty. These names are invented; nothing
// here is read from the user's machine, and the UI says so in two places.
const DEMO_NAMES = ['nginx', 'postgres', 'redis', 'api-gateway', 'worker', 'scheduler', 'monitor']

function demoSnapshot() {
  const now = Date.now()
  const ages = [2 * 60e3, 40 * 60e3, 5 * 3600e3, 3 * 86400e3, 0, 90 * 60e3, 0]
  return {
    demo: true,
    generatedAt: new Date(now).toISOString(),
    totals: { projects: 2, sessions: 7, messages: 418, agents: DEMO_NAMES.length, agentsWithRuns: 5, skills: 0, subagentSpawns: 12 },
    models: [],
    projects: [
      { name: 'example-app', sessions: 4, messages: 260, lastSeen: new Date(now - 2 * 60e3).toISOString(), models: [], branches: ['main'], linesAdded: 0, linesRemoved: 0, costUSD: 0 },
      { name: 'example-site', sessions: 3, messages: 158, lastSeen: new Date(now - 5 * 3600e3).toISOString(), models: [], branches: ['main'], linesAdded: 0, linesRemoved: 0, costUSD: 0 }
    ],
    agents: DEMO_NAMES.map((name, i) => ({
      id: `demo:${name}`,
      name,
      role: 'Simulated',
      source: 'demo',
      kind: 'definition',
      description: 'Placeholder agent — run the scanner to replace this with your own.',
      model: null,
      models: [],
      tools: [],
      plugin: null,
      projects: i % 2 ? ['example-site'] : ['example-app'],
      runs: ages[i] ? 5 - (i % 4) : 0,
      messages: ages[i] ? 40 + i * 9 : 0,
      firstSeen: ages[i] ? new Date(now - ages[i] - 86400e3).toISOString() : null,
      lastSeen: ages[i] ? new Date(now - ages[i]).toISOString() : null
    })),
    skills: []
  }
}

// Agents with real activity get a desk; definitions that have never run wait on
// the bench. Everything else about where they stand follows from their state.
function planFloor(snapshot, now) {
  const ranked = [...(snapshot.agents || [])].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
  const staffed = ranked.filter(a => a.runs > 0).slice(0, DESKS.length)
  const bench = ranked.filter(a => a.runs === 0)

  const deskPlan = []
  const fleet = staffed.map((agent, i) => {
    deskPlan[i] = agent
    return { ...agent, slot: i, home: DESKS[i], state: deriveState(agent.lastSeen, now) }
  })

  // Two or more agents live in the same ten-minute window really were running
  // alongside each other, so that is when the meeting room fills.
  const live = fleet.filter(a => a.state === 'active')
  if (live.length > 1) live.forEach((agent, i) => { agent.room = 'meeting'; agent.slot = i })

  bench.slice(0, BENCH_LIMIT).forEach((agent, i) => {
    fleet.push({ ...agent, slot: i, home: benchSlot(i), state: 'never' })
  })

  return { fleet, deskPlan, hidden: Math.max(0, bench.length - BENCH_LIMIT) }
}

function place(agent, initial) {
  const target = targetFor(agent)
  const start = initial ? ENTRANCE : { x: agent.x, y: agent.y }
  return { ...agent, x: start.x, y: start.y, tx: target.x, ty: target.y, walking: false, facing: 1 }
}

// The log is seeded from what the snapshot actually records, so the first screen
// of events is the user's real history rather than invented chatter.
function historyFrom(snapshot, now) {
  const events = []
  const push = (who, level, message) => events.push({ who, level, message })

  for (const project of snapshot.projects || []) {
    const state = deriveState(project.lastSeen, now)
    push(project.name, state === 'active' ? 'success' : 'info',
      project.sessions
        ? `${project.sessions} session${project.sessions === 1 ? '' : 's'}, ${project.messages} messages · last active ${relativeTime(project.lastSeen, now)}`
        : 'no session transcripts on disk')
  }

  for (const agent of snapshot.agents || []) {
    if (!agent.runs || agent.kind !== 'subagent') continue
    push(agent.name, 'success',
      `spawned ${agent.runs}× in ${agent.projects.join(', ') || 'unknown'} · last ${relativeTime(agent.lastSeen, now)}`)
  }

  const never = (snapshot.agents || []).filter(a => !a.runs).length
  if (never) push('SCAN', 'info', `${never} agent definitions found on disk that have never been spawned`)
  if (snapshot.totals && snapshot.totals.skills) push('SCAN', 'info', `${snapshot.totals.skills} skills installed`)
  if (snapshot.totals && snapshot.totals.malformedLines) {
    push('SCAN', 'failure', `${snapshot.totals.malformedLines} transcript lines could not be parsed and were skipped`)
  }
  push('SCAN', 'info', snapshot.demo
    ? 'showing simulated placeholders — the blob store is empty'
    : `snapshot taken ${relativeTime(snapshot.generatedAt, now)}`)

  return events
}

function Metric({ label, value, icon, hue }) {
  return (
    <div className={`office-metric hue-${hue}`}>
      <div className="office-metric-head"><span>{label}</span><span>{icon}</span></div>
      <div className="office-metric-value">{value}</div>
    </div>
  )
}

export default function AgentOffice() {
  const [snapshot, setSnapshot] = useState(null)
  const [agents, setAgents] = useState([])
  const [deskPlan, setDeskPlan] = useState([])
  const [hidden, setHidden] = useState(0)
  const [logs, setLogs] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [status, setStatus] = useState('loading')

  // The walk loop and the refresh both read the live fleet from here, so the
  // transitions they log stay outside the setState updater React may re-run.
  const fleetRef = useRef([])
  useEffect(() => { fleetRef.current = agents }, [agents])

  const addLog = useCallback((who, level, message) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLogs(prev => [
      { time, who, level, message, id: `${Date.now()}-${Math.random()}` },
      ...prev.slice(0, 99)
    ])
  }, [])

  const apply = useCallback((incoming, initial) => {
    const now = Date.now()
    const plan = planFloor(incoming, now)
    const previous = new Map(fleetRef.current.map(a => [a.id, a]))

    const next = plan.fleet.map(agent => {
      const old = previous.get(agent.id)
      return place(old ? { ...agent, x: old.x, y: old.y, facing: old.facing } : agent, !old)
    })

    // Only genuine differences between two scans are logged as transitions.
    const transitions = []
    if (!initial) {
      for (const agent of next) {
        const old = previous.get(agent.id)
        if (!old) transitions.push([agent.name, 'success', 'joined the floor'])
        else if (old.state !== agent.state) {
          transitions.push([agent.name, agent.state === 'active' ? 'success' : 'info',
            `${stateMeta(old.state).label.toLowerCase()} → ${stateMeta(agent.state).label.toLowerCase()}`])
        }
      }
    }

    setSnapshot(incoming)
    setAgents(next)
    setDeskPlan(plan.deskPlan)
    setHidden(plan.hidden)
    fleetRef.current = next

    if (initial) historyFrom(incoming, now).forEach(e => addLog(e.who, e.level, e.message))
    else transitions.forEach(([who, level, message]) => addLog(who, level, message))
  }, [addLog])

  useEffect(() => {
    let live = true

    const load = async (initial) => {
      try {
        const response = await fetch(API_URL)
        // In `vite dev` there is no function behind /api, and the SPA fallback
        // answers with index.html, so the body is parsed rather than assumed.
        const body = response.ok ? await response.text() : ''
        let data = null
        try {
          data = JSON.parse(body)
        } catch {}
        if (!live) return
        const populated = data && Array.isArray(data.agents) && data.agents.length
        apply(populated ? data : demoSnapshot(), initial)
        setStatus(populated ? 'live' : 'demo')
      } catch {
        if (!live) return
        apply(demoSnapshot(), initial)
        setStatus('offline')
      }
    }

    load(true)
    const poll = setInterval(() => load(false), REFRESH_MS)
    return () => { live = false; clearInterval(poll) }
  }, [apply])

  // Walk each agent toward its target once per animation frame rather than on a
  // timer, so the motion reads as walking instead of stepping.
  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      setAgents(prev => {
        let changed = false

        const next = prev.map(agent => {
          const dx = agent.tx - agent.x
          const dy = agent.ty - agent.y
          const dist = Math.hypot(dx, dy)

          if (dist < 0.5) {
            if (!agent.walking) return agent
            changed = true
            return { ...agent, x: agent.tx, y: agent.ty, walking: false }
          }

          changed = true
          const speed = agent.state === 'active' ? 118 : agent.state === 'idle' ? 96 : agent.state === 'never' ? 52 : 70
          const step = Math.min(dist, speed * dt)
          return {
            ...agent,
            x: agent.x + (dx / dist) * step,
            y: agent.y + (dy / dist) * step,
            walking: true,
            facing: Math.abs(dx) < 1 ? agent.facing : dx < 0 ? -1 : 1
          }
        })

        // Hand back the same array on an idle floor so React stops re-rendering.
        return changed ? next : prev
      })

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Track the selection by id, so the panel below follows the live agent
  // instead of a frozen snapshot taken at click time.
  const selected = agents.find(a => a.id === selectedId) ||
    (snapshot && (snapshot.agents || []).find(a => a.id === selectedId)) || null

  const totals = (snapshot && snapshot.totals) || {}
  const demo = status !== 'live'
  const spend = (snapshot ? snapshot.projects || [] : []).reduce((sum, p) => sum + (p.costUSD || 0), 0)

  const bySource = (snapshot ? snapshot.agents || [] : []).reduce((acc, a) => {
    acc[a.source] = (acc[a.source] || 0) + 1
    return acc
  }, {})

  return (
    <div className="office">
      {demo && (
        <div className="office-banner">
          <strong>Demo floor — this is not your data.</strong>
          <span>
            {status === 'offline'
              ? 'Could not reach /api/agents, so placeholder agents are shown.'
              : 'No snapshot has been uploaded yet, so placeholder agents are shown.'}
            {' '}Populate it with your real agents by running, in the project root:
          </span>
          <code>node scripts/scan-claude-agents.mjs</code>
        </div>
      )}

      <div className="office-metrics">
        <Metric label="Agents" icon="🤖" hue="cyan"
          value={`${totals.agentsWithRuns ?? 0}/${totals.agents ?? 0}`} />
        <Metric label="Projects" icon="📁" hue="violet" value={totals.projects ?? 0} />
        <Metric label="Sessions" icon="🧵" hue="emerald" value={totals.sessions ?? 0} />
        <Metric label="Messages" icon="💬" hue="amber" value={(totals.messages ?? 0).toLocaleString()} />
        <Metric label="Skills" icon="📚" hue="rose" value={totals.skills ?? 0} />
        <Metric label="Spend" icon="💸" hue="slate" value={spend ? `$${spend.toFixed(0)}` : '—'} />
      </div>

      <div className="office-main">
        <div className="card office-card">
          <div className="office-card-head">
            <span className="office-title">🏢 AGENT OFFICE</span>
            <span className={`office-pill ${demo ? 'pill-demo' : 'pill-live'}`}>
              {demo ? '● Demo data' : `● Live · scanned ${relativeTime(snapshot && snapshot.generatedAt)}`}
            </span>
          </div>

          <OfficeFloor
            agents={agents}
            deskPlan={deskPlan}
            selectedId={selectedId}
            onSelect={id => setSelectedId(selectedId === id ? null : id)}
            demo={demo}
          />

          <div className="office-legend">
            {['project', 'builtin', 'plugin', 'user', 'demo'].filter(key => bySource[key]).map(key => (
              <span key={key} className={`legend-chip hue-${sourceMeta(key).hue}`}>
                <i /> {sourceMeta(key).label}
                <b>{bySource[key]}</b>
              </span>
            ))}
            {hidden > 0 && <span className="legend-note">+{hidden} more on the bench, listed right →</span>}
          </div>
          <div className="legend-note office-key">
            Colour is where an agent comes from. Where it stands is when it last ran:
            desk = ran today · break room = not seen for over a day · talent pool = defined on disk but never spawned ·
            meeting room = two or more running at once.
          </div>
        </div>

        <div className="office-side">
          <div className="card office-log">
            <div className="office-subtitle">ACTIVITY</div>
            <div className="log-body mono">
              {logs.length === 0
                ? <div className="log-empty">Reading snapshot…</div>
                : logs.map(log => (
                  <div key={log.id} className="log-row">
                    <span className="log-time">[{log.time}]</span>
                    <span className={`log-who level-${log.level}`}>{log.who}</span>
                    <span>{log.message}</span>
                  </div>
                ))}
            </div>
          </div>

          <div className="card office-roster">
            <div className="office-subtitle">ROSTER</div>
            <div className="roster-body">
              {(snapshot ? snapshot.agents || [] : []).map(agent => {
                const state = deriveState(agent.lastSeen)
                return (
                  <button
                    key={agent.id}
                    className={`roster-row hue-${sourceMeta(agent.source).hue}${agent.id === selectedId ? ' is-selected' : ''}`}
                    onClick={() => setSelectedId(selectedId === agent.id ? null : agent.id)}
                  >
                    <i />
                    <span className="roster-name">{agent.name}</span>
                    <span className="roster-meta">{agent.runs ? `${agent.runs}×` : stateMeta(state).label.toLowerCase()}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {selected && (
        <div className="card office-detail">
          <div className="detail-head">
            <div>
              <h3>{selected.name}</h3>
              <div className="detail-sub">
                <span className={`legend-chip hue-${sourceMeta(selected.source).hue}`}>
                  <i /> {sourceMeta(selected.source).label}
                </span>
                <span>{selected.role}</span>
                {selected.plugin && <span>· {selected.plugin}</span>}
                <span className={`state-chip hue-${stateMeta(deriveState(selected.lastSeen)).hue}`}>
                  {stateMeta(deriveState(selected.lastSeen)).label}
                </span>
              </div>
            </div>
            <button className="btn btn-secondary" onClick={() => setSelectedId(null)}>Close</button>
          </div>

          {selected.description && <p className="detail-desc">{selected.description}</p>}

          <div className="detail-grid">
            {[
              { label: 'Runs', value: selected.runs || '—' },
              { label: 'Messages', value: selected.messages ? selected.messages.toLocaleString() : '—' },
              { label: 'Model', value: shortModel(selected.model) || '—' },
              { label: 'Last run', value: relativeTime(selected.lastSeen) },
              { label: 'First seen', value: selected.firstSeen ? relativeTime(selected.firstSeen) : '—' },
              { label: 'Projects', value: selected.projects && selected.projects.length ? selected.projects.join(', ') : '—' },
              { label: 'Where', value: (ROOM_BY_ID[stateMeta(deriveState(selected.lastSeen)).room] || {}).name || '—' },
              { label: 'Tools', value: selected.tools && selected.tools.length ? selected.tools.join(', ') : 'inherits all' }
            ].map(stat => (
              <div key={stat.label}>
                <div className="detail-label">{stat.label}</div>
                <div className="detail-value">{stat.value}</div>
              </div>
            ))}
          </div>

          {selected.models && selected.models.length > 1 && (
            <div className="detail-models">
              {selected.models.map(m => <span key={m} className="model-chip">{shortModel(m)}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
