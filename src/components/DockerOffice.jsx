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
  const [selectedContainer, setSelectedContainer] = useState(null)
  const logRef = useRef(null)

  const addLog = useCallback((container, level, message) => {
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLogs(prev => [
      { time: timeString, container, level, message, id: Date.now() + Math.random() },
      ...prev.slice(0, 99)
    ])
  }, [])

  // Simulate Docker containers
  useEffect(() => {
    const initialContainers = CONTAINER_NAMES.slice(0, 8).map((name, idx) => ({
      id: `container-${idx}`,
      name,
      image: name.includes('api') ? 'node:18' : name === 'postgres' ? 'postgres:15' : 'alpine:latest',
      status: idx % 4 === 0 ? 'exited' : 'running',
      health: idx % 6 === 0 ? 'unhealthy' : 'healthy',
      cpu: Math.random() * 80,
      memory: Math.floor(Math.random() * 512 * 1024 * 1024),
      memoryLimit: 512 * 1024 * 1024,
      networkIO: { rx: Math.floor(Math.random() * 1000), tx: Math.floor(Math.random() * 1000) },
      home: DESK_COORDS[idx],
      x: DESK_COORDS[idx].x,
      y: DESK_COORDS[idx].y,
      state: 'working',
      uptime: Math.floor(Math.random() * 86400)
    }))
    setContainers(initialContainers)

    addLog('SYSTEM', 'info', 'Docker office initialized with 8 containers')

    // Simulate state changes
    const interval = setInterval(() => {
      setContainers(prev => prev.map(container => {
        if (Math.random() < 0.15) {
          const newCpu = Math.max(0, Math.min(100, container.cpu + (Math.random() - 0.5) * 20))
          const isIdle = newCpu < 5
          const wasIdle = container.cpu < 5

          let newState = container.state
          let logMessage = null

          if (isIdle && !wasIdle && Math.random() < 0.5) {
            newState = 'break'
            logMessage = `${container.name} CPU low (${newCpu.toFixed(1)}%), going to break`
          } else if (newCpu > 80 && Math.random() < 0.1) {
            newState = 'error'
            logMessage = `${container.name} CPU spike detected!`
          }

          if (logMessage) {
            addLog(container.name, newState === 'error' ? 'failure' : 'info', logMessage)
          }

          return { ...container, cpu: newCpu, state: newState }
        }
        return container
      }))
    }, 3000)

    return () => clearInterval(interval)
  }, [addLog])

  // Move containers based on state
  useEffect(() => {
    const moveInterval = setInterval(() => {
      setContainers(prev => prev.map(container => {
        const target =
          container.state === 'break' ? BREAK_ROOM_COORD :
          container.state === 'error' ? CHARGING_PAD_COORD :
          container.state === 'meeting' ? MEETING_AREA_COORD :
          container.home

        if (container.x !== target.x || container.y !== target.y) {
          const speed = container.state === 'error' ? 1.8 : 1.2
          const dx = target.x - container.x
          const dy = target.y - container.y
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < 2) {
            const newState = container.state === 'error' ? 'working' : container.state
            if (container.state === 'error' && newState === 'working') {
              addLog(container.name, 'success', `${container.name} recovered from error`)
            }
            return { ...container, x: target.x, y: target.y, state: newState }
          }

          const step = Math.min(dist * 0.1 * speed, dist)
          const moveX = container.x + (dx / dist) * step
          const moveY = container.y + (dy / dist) * step

          return { ...container, x: moveX, y: moveY }
        }
        return container
      }))
    }, 50)

    return () => clearInterval(moveInterval)
  }, [addLog])

  const toggleBreak = (containerId) => {
    setContainers(prev => prev.map(c => {
      if (c.id === containerId) {
        const newState = c.state === 'break' ? 'working' : 'break'
        addLog(c.name, newState === 'break' ? 'info' : 'success',
          newState === 'break' ? `${c.name} sent to break room` : `${c.name} returned from break`)
        return { ...c, state: newState }
      }
      return c
    }))
  }

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
            {containers.map(container => (
              <div
                key={container.id}
                style={{
                  position: 'absolute',
                  left: container.x - 16,
                  top: container.y - 19,
                  width: 32,
                  height: 38,
                  cursor: 'pointer',
                  transform: `translate(${0}px, ${0}px)`,
                  transition: 'transform 0.1s linear'
                }}
                onClick={() => setSelectedContainer(selectedContainer?.id === container.id ? null : container)}
              >
                <div style={{
                  position: 'absolute',
                  top: 4,
                  left: '50%',
                  transform: 'translateX(-50%)',
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
                    background: container.state === 'error' ? '#ef4444' :
                               container.state === 'break' ? '#3f3f46' :
                               container.state === 'meeting' ? '#a855f7' : '#22c55e',
                    borderRadius: 2,
                    boxShadow: container.state !== 'idle' ? `0 0 10px ${
                      container.state === 'error' ? '#ef4444' :
                      container.state === 'break' ? '#3f3f46' :
                      container.state === 'meeting' ? '#a855f7' : '#22c55e'
                    }` : 'none'
                  }} />
                </div>
                <div style={{
                  position: 'absolute',
                  bottom: 4,
                  left: '50%',
                  transform: 'translateX(-50%)',
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
                    background: container.state === 'error' ? '#ef4444' :
                               container.state === 'break' ? '#3f3f46' :
                               container.state === 'meeting' ? '#a855f7' : '#22c55e',
                    boxShadow: container.state !== 'idle' ? `0 0 8px ${
                      container.state === 'error' ? '#ef4444' :
                      container.state === 'break' ? '#3f3f46' :
                      container.state === 'meeting' ? '#a855f7' : '#22c55e'
                    }` : 'none'
                  }} />
                </div>
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 26,
                  height: 6,
                  background: '#18181b',
                  borderRadius: 3,
                  zIndex: 1
                }}>
                  <div style={{ width: 6, height: 6, background: '#a1a1aa', borderRadius: '50%', display: 'inline-block', margin: '0 2px' }} />
                  <div style={{ width: 6, height: 6, background: '#a1a1aa', borderRadius: '50%', display: 'inline-block', margin: '0 2px' }} />
                  <div style={{ width: 6, height: 6, background: '#a1a1aa', borderRadius: '50%', display: 'inline-block', margin: '0 2px' }} />
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
            ))}
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
                {selectedContainer.id} • {selectedContainer.image}
              </div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => toggleBreak(selectedContainer.id)}
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              {selectedContainer.state === 'break' ? 'Return to Work' : 'Send to Break'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
            {[
              { label: 'State', value: selectedContainer.state, color: selectedContainer.state === 'error' ? '#ef4444' : selectedContainer.state === 'break' ? '#f59e0b' : '#22c55e' },
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
