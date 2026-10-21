import { useEffect, useRef, useState } from 'react'
import { FLOOR_W, FLOOR_H, ROOMS, DESKS, sourceMeta, stateMeta } from './officeLayout'

// Pure presentation: every element is placed in the fixed floor coordinate
// space and coloured through the palette tokens in index.css.

function Windows() {
  return (
    <div className="office-exterior">
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div key={i} className="window">
          <div className="window-sky" />
          <div className="window-bar" />
        </div>
      ))}
      <div className="daylight" />
    </div>
  )
}

function Room({ room }) {
  return (
    <div
      className={`room accent-${room.accent} floor-${room.floor}`}
      style={{ left: room.x, top: room.y, width: room.w, height: room.h }}
    >
      <div className={`door ${room.door.dir === 'v' ? 'door-v' : 'door-h'}`}
        style={{ left: room.door.x - room.x, top: room.door.y - room.y }} />
      <div className="room-sign">
        <span>{room.icon}</span>
        <span>{room.name}</span>
      </div>
    </div>
  )
}

function Desk({ coord, agent }) {
  const hue = agent ? sourceMeta(agent.source).hue : 'slate'
  return (
    <div className={`desk hue-${hue}${agent ? '' : ' desk-vacant'}`} style={{ left: coord.x - 48, top: coord.y - 30 }}>
      <div className="desk-top" />
      <div className="monitor">
        <div className="monitor-screen" />
        <div className="monitor-stand" />
      </div>
      <div className="desk-mug" />
      <div className="chair" />
      <div className="nameplate">{agent ? agent.name : 'vacant'}</div>
    </div>
  )
}

function MeetingRoom() {
  return (
    <div className="furniture meeting-table" style={{ left: 712, top: 170 }}>
      <div className="table-top" />
      {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className={`table-chair tc-${i}`} />)}
    </div>
  )
}

function BreakRoom() {
  return (
    <>
      <div className="furniture coffee-machine" style={{ left: 30, top: 112 }}>
        <div className="cm-body"><div className="cm-screen" /><div className="cm-spout" /></div>
        <div className="cm-cup" />
      </div>
      <div className="furniture break-table" style={{ left: 120, top: 128 }}>
        <div className="bt-top" />
        <div className="bt-stool s1" />
        <div className="bt-stool s2" />
      </div>
      <div className="furniture fridge" style={{ left: 166, top: 212 }} />
    </>
  )
}

function ServerCloset() {
  return (
    <div className="furniture rack-stack" style={{ left: 684, top: 334 }}>
      {[0, 1, 2].map(r => (
        <div key={r} className="rack">
          {[0, 1, 2, 3, 4, 5].map(u => <span key={u} className={`led l${(r + u) % 4}`} />)}
        </div>
      ))}
    </div>
  )
}

function Reception() {
  return (
    <>
      <div className="furniture reception-desk" style={{ left: 42, top: 330 }}>
        <div className="rd-top" />
        <div className="rd-front" />
        <div className="rd-bell" />
      </div>
      <div className="furniture sofa" style={{ left: 38, top: 452 }}>
        <div className="sofa-back" />
        <div className="sofa-seat" />
      </div>
      <div className="furniture art art-a" style={{ left: 150, top: 320 }} />
    </>
  )
}

function Plant({ x, y, size = 1 }) {
  return (
    <div className="furniture plant" style={{ left: x, top: y, transform: `scale(${size})` }}>
      <div className="leaf a" /><div className="leaf b" /><div className="leaf c" />
      <div className="pot" />
    </div>
  )
}

function Agent({ agent, selected, onSelect }) {
  const source = sourceMeta(agent.source)
  const state = stateMeta(agent.state)
  const dim = agent.state === 'never' || agent.state === 'dormant'
  // The desk nameplate already names whoever is sitting at it, and twelve tags
  // would overlap on the bench, so the floating tag is for agents in between.
  const tagged = selected || agent.walking || agent.room === 'meeting' || state.room === 'break'

  return (
    <div
      className={`agent hue-${source.hue} state-${agent.state}${agent.walking ? ' walking' : ''}${selected ? ' selected' : ''}`}
      style={{
        left: 0,
        top: 0,
        transform: `translate3d(${agent.x - 16}px, ${agent.y - 19}px, 0)`,
        willChange: 'transform',
        zIndex: 40 + Math.round(agent.y / 10),
        opacity: dim ? 0.68 : 1
      }}
      onClick={() => onSelect(agent.id)}
      title={`${agent.name} — ${source.label} · ${state.label}`}
    >
      <div className="agent-body" style={{ transform: `scaleX(${agent.facing})` }}>
        <div className="agent-head"><span className="visor" /></div>
        <div className="agent-torso"><span className="core" /></div>
        <div className="agent-legs"><span /><span /><span /></div>
      </div>
      {tagged && <div className="agent-tag">{agent.name}</div>}
    </div>
  )
}

export default function OfficeFloor({ agents, deskPlan, selectedId, onSelect, demo }) {
  const frame = useRef(null)
  const [scale, setScale] = useState(1)

  // The floor is authored at a fixed size and scaled to the card. Measuring here
  // keeps it correct without relying on calc() dividing one length by another.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const fit = () => setScale(el.clientWidth / FLOOR_W)
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className={`office-floor${demo ? ' office-demo' : ''}`} ref={frame} style={{ '--office-scale': scale }}>
      <div className="office-stage" style={{ width: FLOOR_W, height: FLOOR_H }}>
        <Windows />
        {ROOMS.map(room => <Room key={room.id} room={room} />)}

        <div className="rug rug-main" />
        <div className="rug rug-reception" />

        {DESKS.map((coord, i) => <Desk key={i} coord={coord} agent={deskPlan[i] || null} />)}

        <MeetingRoom />
        <BreakRoom />
        <ServerCloset />
        <Reception />

        <Plant x={238} y={104} />
        <Plant x={626} y={492} size={0.85} />
        <Plant x={900} y={104} size={0.9} />
        <Plant x={186} y={286} size={0.75} />

        <div className="furniture art art-b" style={{ left: 420, top: 100 }} />
        <div className="furniture whiteboard" style={{ left: 690, top: 108 }} />
        <div className="corridor-label">corridor</div>

        {agents.map(agent => (
          <Agent
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}
