// Geometry and colour rules for the office floor. The floor is laid out in a
// fixed 940x560 coordinate space and scaled by CSS, so every number here can be
// read as "where in the room", independent of the rendered size.

export const FLOOR_W = 940
export const FLOOR_H = 560

// Each room is a real walled space. `floor` picks the material class, `accent`
// tints the walls and signage so the plan reads as several rooms, not a grid.
// The 16px gaps between the rooms are corridor, and every room opens onto it
// through a door, so the plan has a circulation ring rather than sealed boxes.
export const ROOMS = [
  { id: 'reception', name: 'Reception', icon: '🛎️', x: 16, y: 300, w: 198, h: 244, floor: 'wood', accent: 'rose', door: { x: 214, y: 404, dir: 'v' } },
  { id: 'desks', name: 'Open Floor', icon: '🖥️', x: 230, y: 96, w: 420, h: 448, floor: 'carpet', accent: 'cyan', door: { x: 650, y: 200, dir: 'v' } },
  { id: 'meeting', name: 'Meeting Room', icon: '🤝', x: 666, y: 96, w: 258, h: 198, floor: 'polished', accent: 'violet', door: { x: 666, y: 200, dir: 'v' } },
  { id: 'break', name: 'Break Room', icon: '☕', x: 16, y: 96, w: 198, h: 188, floor: 'tile', accent: 'amber', door: { x: 214, y: 204, dir: 'v' } },
  { id: 'server', name: 'Server Closet', icon: '🗄️', x: 666, y: 310, w: 120, h: 234, floor: 'grate', accent: 'emerald', door: { x: 726, y: 310, dir: 'h' } },
  { id: 'bench', name: 'Talent Pool', icon: '🪑', x: 802, y: 310, w: 122, h: 234, floor: 'concrete', accent: 'slate', door: { x: 863, y: 310, dir: 'h' } }
]

// How many never-run definitions the Talent Pool shows before the roster panel
// takes over; 42 nameplates on one bench would be unreadable.
export const BENCH_LIMIT = 12

export const ROOM_BY_ID = ROOMS.reduce((map, room) => ({ ...map, [room.id]: room }), {})

// Where a room's occupants gather when they are not at a desk.
const GATHER = {
  meeting: { x: 795, y: 212 },
  break: { x: 115, y: 214 },
  server: { x: 726, y: 440 },
  bench: { x: 863, y: 352 },
  reception: { x: 115, y: 430 }
}

// Six rows of two, sized so the last row still lands inside the Talent Pool.
export function benchSlot(slot) {
  return zoneSlot(GATHER.bench, slot % BENCH_LIMIT, 2, 46, 30)
}

// Desks fill the open floor in three columns. Index order matters: the busiest
// agents are assigned first, so they land nearest the front of the room.
export const DESKS = [
  { x: 310, y: 176 }, { x: 440, y: 176 }, { x: 570, y: 176 },
  { x: 310, y: 306 }, { x: 440, y: 306 }, { x: 570, y: 306 },
  { x: 310, y: 436 }, { x: 440, y: 436 }, { x: 570, y: 436 }
]

export const SOURCE_META = {
  project: { label: 'Project', hue: 'cyan', icon: '📁' },
  builtin: { label: 'Built-in', hue: 'violet', icon: '⚙️' },
  plugin: { label: 'Plugin', hue: 'amber', icon: '🧩' },
  user: { label: 'User', hue: 'emerald', icon: '👤' },
  demo: { label: 'Demo', hue: 'slate', icon: '🎭' }
}

// An agent that has run recently is at its own desk; one that has not been seen
// for over a day has stepped away, and one that has never run waits on the bench.
export const STATE_META = {
  active: { label: 'Active', room: 'desks', hue: 'emerald' },
  idle: { label: 'Ran today', room: 'desks', hue: 'cyan' },
  dormant: { label: 'Dormant', room: 'break', hue: 'amber' },
  never: { label: 'Never run', room: 'bench', hue: 'rose' }
}

export function sourceMeta(source) {
  return SOURCE_META[source] || SOURCE_META.demo
}

export function stateMeta(state) {
  return STATE_META[state] || STATE_META.dormant
}

// The snapshot is a point-in-time file, so recompute freshness against the
// clock in the browser rather than trusting the state the scanner wrote.
export function deriveState(lastSeen, now = Date.now()) {
  if (!lastSeen) return 'never'
  const age = now - Date.parse(lastSeen)
  if (!Number.isFinite(age)) return 'never'
  if (age < 10 * 60 * 1000) return 'active'
  if (age < 24 * 60 * 60 * 1000) return 'idle'
  return 'dormant'
}

// Several agents head for the same room at once, so fan them out across slots
// instead of letting them stack into a single sprite.
export function zoneSlot(coord, slot, perRow, gapX, gapY) {
  const row = Math.floor(slot / perRow)
  const col = slot % perRow
  return {
    x: coord.x + (col - (perRow - 1) / 2) * gapX,
    y: coord.y - 6 + row * gapY
  }
}

export function targetFor(agent) {
  const room = agent.room || stateMeta(agent.state).room
  // Dormant agents stay at their own desk rather than crowding a shared zone,
  // which is what makes the open floor look staffed instead of abandoned.
  if (room === 'desks') return agent.home
  const gather = GATHER[room] || GATHER.reception
  if (room === 'bench') return benchSlot(agent.slot)
  if (room === 'break') return zoneSlot(gather, agent.slot % 6, 3, 44, 32)
  return zoneSlot(gather, agent.slot % 8, 4, 48, 34)
}

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return 'never'
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'never'
  if (ms < 60 * 1000) return 'just now'
  const units = [
    ['d', 86400000],
    ['h', 3600000],
    ['m', 60000]
  ]
  for (const [suffix, size] of units) {
    if (ms >= size) return `${Math.floor(ms / size)}${suffix} ago`
  }
  return 'just now'
}

export function shortModel(model) {
  if (!model) return null
  return String(model).replace(/^claude-/, '').replace(/-\d{8}$/, '')
}
