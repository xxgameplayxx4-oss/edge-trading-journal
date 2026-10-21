import { useEffect, useState, useRef, useCallback } from 'react'

const DESK_COORDS = [
  {x: 84, y: 112}, {x: 214, y: 112}, {x: 344, y: 112},
  {x: 84, y: 292}, {x: 214, y: 292}, {x: 344, y: 292},
  {x: 474, y: 112}, {x: 604, y: 112},
]
const CHARGING_PAD_COORD = {x: 730, y: 395}
const BREAK_ROOM_COORD = {x: 200, y: 420}
const MEETING_AREA_COORD = {x: 480, y: 80}

const CONTAINER_NAMES = [
  'nginx', 'postgres', 'redis', 'api', 'worker', 'scheduler',
  'freeilmapi', 'monitor', 'logstash'
]

// Several agents head for the same zone at once, so fan them out across slots
// instead of letting them stack into a single sprite.
function zoneSlot(coord, slot, perRow, gapX, gapY) {
  const row = Math.floor(slot / perRow)
  const col = slot % perRow
  return {
    x: coord.x + (col - (perRow - 1) / 2) * gapX,
    y: coord.y - 6 + row * gapY,
  }
}

function targetFor(c) {
  if (c.state === 'break') return zoneSlot(BREAK_ROOM_COORD, c.slot % 6, 3, 34, 26)
  if (c.state === 'meeting') return zoneSlot(MEETING_AREA_COORD, c.slot % 8, 4, 38, 26)
  // Dead containers park on the pad's front row, overheating ones in the row behind.
  if (c.state === 'offline') return zoneSlot(CHARGING_PAD_COORD, c.slot % 2, 2, 38, 26)
  if (c.state === 'error') return zoneSlot(CHARGING_PAD_COORD, 2 + (c.slot % 2), 2, 38, 26)
  return c.home
}

function stateColor(state) {
  if (state === 'error') return '#ef4444'
  if (state === 'offline') return '#3f3f46'
  if (state === 'break') return '#f59e0b'
  if (state === 'meeting') return '#a855f7'
  return '#22c55e'
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default function DockerOffice() {
  const [containers, setContainers] = useState([])
  const [logs, setLogs] = useState([])
  const [selectedId, setSelectedId] = useState(null)

  // The scheduler reads the live fleet from here, so its state transitions and the
  // log lines they produce stay outside the setState updater React may re-run.
  const fleetRef = useRef([])
  useEffect(() => { fleetRef.current = containers }, [containers])

  const addLog = useCallback((container, level, message) => {
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLogs(prev => [
      { time: timeString, container, level, message, id: `${Date.now()}-${Math.random()}` },
      ...prev.slice(0, 99)
    ])
  }, [])

  // Build the fleet
  useEffect(() => {
    const initial = CONTAINER_NAMES.slice(0, 8).map((name, idx) => {
      const status = idx % 4 === 0 ? 'exited' : 'running'
      const base = {
        id: `container-${idx}`,
        slot: idx,
        name,
        image: name.includes('api') ? 'node:18' : name === 'postgres' ? 'postgres:15' : 'alpine:latest',
        status,
        health: idx % 6 === 0 ? 'unhealthy' : 'healthy',
        cpu: status === 'exited' ? 0 : 10 + Math.random() * 70,
        memory: Math.floor(Math.random() * 512 * 1024 * 1024),
        memoryLimit: 512 * 1024 * 1024,
        networkIO: { rx: Math.floor(Math.random() * 1000), tx: Math.floor(Math.random() * 1000) },
        home: DESK_COORDS[idx],
        state: status === 'exited' ? 'offline' : 'working',
        walking: false,
        facing: 1,
        uptime: Math.floor(Math.random() * 86400),
      }
      // Everyone starts at their desk and walks to wherever they actually belong.
      const target = targetFor(base)
      return { ...base, x: base.home.x, y: base.home.y, tx: target.x, ty: target.y }
    })

    setContainers(initial)
    fleetRef.current = initial
    addLog('SYSTEM', 'info', `Docker office initialized with ${initial.length} containers`)
  }, [addLog])

  // Decide where everyone should be. Runs often enough that the floor is never still.
  useEffect(() => {
    const tick = setInterval(() => {
      const prev = fleetRef.current
      if (!prev.length) return

      const running = prev.filter(c => c.status === 'running')
      const callMeeting = running.length > 1 && !prev.some(c => c.state === 'meeting') && Math.random() < 0.12
      const pending = []

      const next = prev.map(c => {
        if (c.status === 'exited') {
          const t = targetFor({ ...c, state: 'offline' })
          return { ...c, cpu: 0, state: 'offline', tx: t.x, ty: t.y }
        }

        let cpu = Math.max(0, Math.min(100, c.cpu + (Math.random() - 0.5) * 28))
        let state = c.state

        if (state === 'error') {
          if (Math.random() < 0.45) {
            state = 'working'
            cpu = 20 + Math.random() * 30
            pending.push([c.name, 'success', `${c.name} recovered and is back at its desk`])
          }
        } else if (callMeeting) {
          state = 'meeting'
        } else if (state === 'meeting') {
          if (Math.random() < 0.4) {
            state = 'working'
            pending.push([c.name, 'info', `${c.name} left the sync room`])
          }
        } else if (cpu > 85 && Math.random() < 0.35) {
          state = 'error'
          pending.push([c.name, 'failure', `${c.name} CPU spike at ${cpu.toFixed(0)}% — sent to the charging pad`])
        } else if (state === 'break') {
          if (Math.random() < 0.3) {
            state = 'working'
            cpu = 15 + Math.random() * 45
            pending.push([c.name, 'success', `${c.name} is back from break`])
          }
        } else if (cpu < 25 && Math.random() < 0.4) {
          state = 'break'
          pending.push([c.name, 'info', `${c.name} idle at ${cpu.toFixed(0)}% CPU — heading to the break room`])
        }

        const t = targetFor({ ...c, state })
        return { ...c, cpu, state, tx: t.x, ty: t.y }
      })

      if (callMeeting) {
        pending.unshift(['SYSTEM', 'info', 'Orchestrator called a sync — all running containers to the sync room'])
      }

      setContainers(next)
      fleetRef.current = next
      pending.forEach(([name, level, message]) => addLog(name, level, message))
    }, 1600)

    return () => clearInterval(tick)
  }, [addLog])

  // Walk each agent toward its target once per animation frame rather than on a
  // 50ms timer, so the motion reads as walking instead of stepping.
  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      setContainers(prev => {
        let changed = false

        const next = prev.map(c => {
          const dx = c.tx - c.x
          const dy = c.ty - c.y
          const dist = Math.hypot(dx, dy)

          if (dist < 0.5) {
            if (!c.walking) return c
            changed = true
            return { ...c, x: c.tx, y: c.ty, walking: false }
          }

          changed = true
          const speed = c.state === 'error' ? 170 : c.state === 'offline' ? 70 : 105
          const step = Math.min(dist, speed * dt)
          return {
            ...c,
            x: c.x + (dx / dist) * step,
            y: c.y + (dy / dist) * step,
            walking: true,
            facing: Math.abs(dx) < 1 ? c.facing : dx < 0 ? -1 : 1,
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

  const toggleBreak = (containerId) => {
    const current = fleetRef.current.find(c => c.id === containerId)
    if (!current) return

    if (current.status === 'exited') {
      addLog(current.name, 'failure', `${current.name} is exited — start it before moving it`)
      return
    }

    const state = current.state === 'break' ? 'working' : 'break'
    const t = targetFor({ ...current, state })
    const next = fleetRef.current.map(c => (c.id === containerId ? { ...c, state, tx: t.x, ty: t.y } : c))

    setContainers(next)
    fleetRef.current = next
    addLog(current.name, state === 'break' ? 'info' : 'success',
      state === 'break' ? `${current.name} sent to the break room` : `${current.name} returned from break`)
  }

  // Track the selection by id, so the panel below follows the live container
  // instead of a frozen snapshot taken at click time.
  const selectedContainer = containers.find(c => c.id === selectedId) || null

  const stats = {
    running: containers.filter(c => c.status === 'running').length,
    total: containers.length,
    avgCpu: containers.reduce((sum, c) => sum + c.cpu, 0) / containers.length || 0,
    totalMemory: containers.reduce((sum, c) => sum + c.memory, 0),
    errors: containers.filter(c => c.state === 'error').length,
    breaks: containers.filter(c => c.state === 'break').length
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {[
          { label: 'Running', value: `${stats.running}/${stats.total}`, icon: '▶️', color: '#22c55e' },
          { label: 'Avg CPU', value: `${stats.avgCpu.toFixed(1)}%`, icon: '⚡', color: '#60a5fa' },
          { label: 'Memory', value: formatBytes(stats.totalMemory), icon: '💾', color: '#a855f7' },
          { label: 'Errors', value: stats.errors, icon: '⚠️', color: '#ef4444' },
          { label: 'On Break', value: stats.breaks, icon: '☕', color: '#f59e0b' }
        ].map((metric, i) => (
          <div key={i} className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
              <span>{metric.label}</span>
              <span>{metric.icon}</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 12, color: metric.color }}>
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>🏢 DOCKER OFFICE</span>
            <span style={{ color: '#22c55e', fontSize: 11 }}>● Live</span>
          </div>
          <div style={{ position: 'relative', width: '100%', height: 480, background: '#0c0c0e', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {/* Office Floor */}
            <div style={{ position: 'absolute', width: '100%', height: '100%', background: 'radial-gradient(circle at 20% 30%, rgba(34, 211, 238, 0.05), transparent 50%)' }} />

            {/* Desks */}
            {DESK_COORDS.slice(0, containers.length).map((coord, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: coord.x - 40,
                top: coord.y - 22,
                width: 80,
                height: 45,
                background: '#1e1e24',
                border: '1px solid #3f3f46',
                borderRadius: 6,
                boxShadow: '0 10px 20px rgba(0,0,0,0.4)'
              }}>
                <div style={{
                  position: 'absolute',
                  top: -10,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 44,
                  height: 24,
                  background: '#020617',
                  border: '2px solid #52525b',
                  borderRadius: 4
                }} />
              </div>
            ))}

            {/* Break Room */}
            <div style={{
              position: 'absolute',
              left: BREAK_ROOM_COORD.x - 60,
              top: BREAK_ROOM_COORD.y - 40,
              width: 120,
              height: 80,
              border: '1px dashed #3f3f46',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              background: 'rgba(39, 39, 42, 0.3)'
            }}>
              <div style={{ fontSize: 20 }}>☕</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Break Room</div>
            </div>

            {/* Charging Station */}
            <div style={{
              position: 'absolute',
              left: CHARGING_PAD_COORD.x - 45,
              top: CHARGING_PAD_COORD.y - 45,
              width: 90,
              height: 90,
              border: '1px dashed #3f3f46',
              borderRadius: 8,
              background: 'rgba(39, 39, 42, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <div style={{
                width: 44,
                height: 44,
                background: '#18181b',
                border: '2px solid #27272a',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20
              }}>⚡</div>
            </div>

            {/* Meeting Area */}
            <div style={{
              position: 'absolute',
              left: MEETING_AREA_COORD.x - 85,
              top: MEETING_AREA_COORD.y - 50,
              width: 170,
              height: 80,
              border: '1px solid var(--border)',
              background: '#09090b',
              borderRadius: 6,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 8,
              fontSize: 10,
              color: 'var(--muted)'
            }}>
              <div>🤝 Sync Room</div>
              <div style={{ opacity: 0.7, marginTop: 4 }}>Container orchestration</div>
            </div>

            {/* Container Agents */}
            {containers.map(container => {
              const color = stateColor(container.state)
              const lit = container.state !== 'offline'

              return (
                <div
                  key={container.id}
                  className={`agent${container.walking ? ' walking' : ''}`}
                  style={{
                    left: 0,
                    top: 0,
                    width: 32,
                    height: 38,
                    cursor: 'pointer',
                    transform: `translate3d(${container.x - 16}px, ${container.y - 19}px, 0)`,
                    willChange: 'transform',
                    zIndex: 10 + Math.round(container.y / 10),
                    opacity: container.state === 'offline' ? 0.55 : 1
                  }}
                  onClick={() => setSelectedId(selectedId === container.id ? null : container.id)}
                >
                  <div className="agent-body" style={{ transform: `scaleX(${container.facing})` }}>
                    <div style={{
                      position: 'absolute',
                      top: 4,
                      left: '50%',
                      marginLeft: -10,
                      width: 20,
                      height: 16,
                      background: 'linear-gradient(135deg, #a1a1aa, #52525b)',
                      border: '1.5px solid #fafafa',
                      borderRadius: 5,
                      zIndex: 3
                    }}>
                      <div style={{
                        position: 'absolute',
                        top: 2,
                        left: 3,
                        width: 14,
                        height: 4,
                        background: color,
                        borderRadius: 2,
                        boxShadow: lit ? `0 0 10px ${color}` : 'none'
                      }} />
                    </div>
                    <div style={{
                      position: 'absolute',
                      bottom: 4,
                      left: '50%',
                      marginLeft: -12,
                      width: 24,
                      height: 16,
                      background: 'linear-gradient(135deg, #71717a, #27272a)',
                      border: '1.5px solid #fafafa',
                      borderRadius: 4,
                      zIndex: 2
                    }}>
                      <div style={{
                        position: 'absolute',
                        top: 4,
                        left: 8,
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: color,
                        boxShadow: lit ? `0 0 8px ${color}` : 'none'
                      }} />
                    </div>
                    <div className="agent-legs" style={{
                      position: 'absolute',
                      bottom: 0,
                      left: '50%',
                      marginLeft: -13,
                      width: 26,
                      height: 6,
                      background: '#18181b',
                      borderRadius: 3,
                      zIndex: 1
                    }}>
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                  <div style={{
                    position: 'absolute',
                    bottom: -16,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: 9,
                    fontWeight: 700,
                    color: '#ffffff',
                    whiteSpace: 'nowrap',
                    background: 'rgba(9, 9, 11, 0.95)',
                    border: '1px solid var(--border)',
                    padding: '1px 6px',
                    borderRadius: 4,
                    pointerEvents: 'none',
                    zIndex: 101
                  }}>
                    {container.name}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Logs Panel */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 512 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)', marginBottom: 12 }}>
            CONTAINER EVENTS
          </div>
          <div style={{
            flex: 1,
            background: '#09090b',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            overflowY: 'auto',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}>
            {logs.length === 0 ? (
              <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
                No events yet
              </div>
            ) : logs.map(log => (
              <div key={log.id} style={{ display: 'flex', gap: 8, lineHeight: 1.4 }}>
                <span style={{ color: '#52525b' }}>[{log.time}]</span>
                <span style={{
                  fontWeight: 700,
                  color: log.level === 'failure' ? '#ef4444' :
                         log.level === 'success' ? '#22c55e' : '#22d3ee'
                }}>
                  {log.container}
                </span>
                <span>{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedContainer && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 20 }}>{selectedContainer.name}</h3>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
                {selectedContainer.id} • {selectedContainer.image} • {selectedContainer.status}
              </div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => toggleBreak(selectedContainer.id)}
              disabled={selectedContainer.status === 'exited'}
              style={{ padding: '6px 12px', fontSize: 12, opacity: selectedContainer.status === 'exited' ? 0.5 : 1 }}
            >
              {selectedContainer.state === 'break' ? 'Return to Work' : 'Send to Break'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
            {[
              { label: 'State', value: selectedContainer.state, color: stateColor(selectedContainer.state) },
              { label: 'CPU', value: `${selectedContainer.cpu.toFixed(1)}%` },
              { label: 'Memory', value: formatBytes(selectedContainer.memory) },
              { label: 'Uptime', value: `${Math.floor(selectedContainer.uptime / 3600)}h` },
            ].map((stat, i) => (
              <div key={i}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>{stat.label}</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: stat.color || 'var(--text)' }}>{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
