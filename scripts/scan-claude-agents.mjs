#!/usr/bin/env node
// Walks the local ~/.claude tree and emits a metadata-only snapshot of the
// agents, sessions and skills found there.
//
// The snapshot lands in a public, unauthenticated blob store, so nothing that
// could carry conversation content may enter it. Every field below is built by
// naming it explicitly — raw records are never spread into the output, and the
// transcript bodies, prompts, tool inputs, session titles, absolute paths and
// settings files are read past or skipped outright.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'

const SNAPSHOT_VERSION = 1
const DEFAULT_URL = 'https://edge-journal-kgc.netlify.app'
const DESCRIPTION_LIMIT = 220

// Built-in subagents can be spawned without any definition on disk, so the
// roster needs its own idea of what they are.
const BUILTIN_AGENTS = {
  'general-purpose': 'Researches complex questions, searches code and runs multi-step tasks.',
  Explore: 'Read-only search agent for broad fan-out searches across a codebase.',
  Plan: 'Software architect agent that designs implementation plans.',
  claude: 'Catch-all agent for tasks that do not fit a more specific one.',
  'claude-code-guide': 'Answers questions about Claude Code, the Agent SDK and the Claude API.',
  'statusline-setup': 'Configures the status line setting.',
  'output-style-setup': 'Creates output styles.'
}

function parseArgs(argv) {
  const args = { root: path.join(os.homedir(), '.claude'), url: DEFAULT_URL, out: null, user: null }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s)
    const value = () => (inline !== undefined ? inline : argv[++i])
    if (flag === '--root') args.root = value()
    else if (flag === '--url') args.url = value()
    else if (flag === '--out') args.out = value()
    else if (flag === '--user') args.user = value()
    else if (flag === '--help' || flag === '-h') args.help = true
  }
  return args
}

function helpText() {
  return [
    'scan-claude-agents — build a metadata-only snapshot of your local Claude agents',
    '',
    '  --root <dir>   Claude home to scan        (default: ~/.claude)',
    '  --out <file>   write the JSON here and do not upload',
    '  --url <base>   site to POST /api/agents to (default: ' + DEFAULT_URL + ')',
    '  --user <id>    value for the x-user-id header (default: anonymous)',
    ''
  ].join('\n')
}

function readDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function basenameOf(dir) {
  // Only ever the last segment: the parent folders spell out the home
  // directory, which carries the user's name.
  return path.basename(String(dir).replace(/[\\/]+$/, '')) || 'unknown'
}

// The project folder name is the cwd with every separator flattened to a dash,
// so a path segment containing its own dash cannot be recovered. Only trust the
// guess when it points at a directory that is really there.
function decodeProjectDir(name) {
  const guess = name.replace(/^([A-Za-z])--/, '$1:/').replace(/-/g, '/')
  let real = null
  try {
    if (fs.statSync(guess).isDirectory()) real = guess
  } catch {}
  return { name: basenameOf(guess), path: real }
}

function clean(value, limit = DESCRIPTION_LIMIT) {
  if (typeof value !== 'string') return null
  const flat = value.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat
}

function isoOrNull(value) {
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function bumpRange(range, iso) {
  if (!iso) return
  if (!range.first || iso < range.first) range.first = iso
  if (!range.last || iso > range.last) range.last = iso
}

// Frontmatter only, and only the four keys the office displays. The body of an
// agent or skill file is its system prompt and never enters the snapshot.
function readFrontmatter(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8').slice(0, 8000)
  } catch {
    return null
  }
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return null

  const fields = {}
  let key = null
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (pair) {
      key = pair[1]
      // `key: |` and `key: >` open a block scalar; the value is the lines under it.
      fields[key] = /^[|>][-+\d]*$/.test(pair[2].trim()) ? '' : pair[2]
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] = (fields[key] ? fields[key] + ' ' : '') + line.trim()
    }
  }

  const tools = clean(fields.tools, 400)
  return {
    name: clean(fields.name, 80),
    description: clean(fields.description),
    model: clean(fields.model, 40),
    tools: tools
      ? tools.replace(/^\[|\]$/g, '').split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean).slice(0, 24)
      : []
  }
}

async function scanSessions(root, report) {
  const projectsDir = path.join(root, 'projects')
  const projects = new Map()
  const spawns = new Map()
  const models = new Map()
  let sessionCount = 0
  let badLines = 0

  for (const entry of readDir(projectsDir)) {
    if (!entry.isDirectory()) continue
    const dir = path.join(projectsDir, entry.name)
    const files = readDir(dir).filter(f => f.isFile() && f.name.endsWith('.jsonl'))
    const decoded = decodeProjectDir(entry.name)

    const project = {
      name: decoded.name,
      realPath: decoded.path,
      sessions: 0,
      messages: 0,
      userMessages: 0,
      assistantMessages: 0,
      range: { first: null, last: null },
      models: new Map(),
      branches: new Set(),
      versions: new Set(),
      linesAdded: 0,
      linesRemoved: 0,
      costUSD: 0,
      cwds: new Map(),
      subagents: new Map()
    }

    // cost-state is rewritten in place as a session runs, so keep only the last
    // one per session instead of summing every revision.
    const costBySession = new Map()

    for (const file of files) {
      project.sessions++
      sessionCount++
      const stream = fs.createReadStream(path.join(dir, file.name), { encoding: 'utf8' })
      stream.on('error', () => {})
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

      for await (const line of rl) {
        if (!line.trim()) continue
        let record
        try {
          record = JSON.parse(line)
        } catch {
          badLines++
          continue
        }
        readRecord(record, project, spawns, models, costBySession)
      }
    }

    for (const cost of costBySession.values()) {
      project.costUSD += Number(cost.totalCostUSD) || 0
      project.linesAdded += Number(cost.totalLinesAdded) || 0
      project.linesRemoved += Number(cost.totalLinesRemoved) || 0
    }

    // The recorded cwd beats the flattened folder name, which cannot be decoded
    // unambiguously once a path segment contains a dash of its own.
    const topCwd = [...project.cwds.entries()].sort((a, b) => b[1] - a[1])[0]
    if (topCwd) {
      project.realPath = topCwd[0]
      project.name = basenameOf(topCwd[0])
    }
    projects.set(project.name, project)
  }

  report.badLines = badLines
  report.sessionCount = sessionCount
  return { projects, spawns, models }
}

function readRecord(record, project, spawns, models, costBySession) {
  const type = record && record.type
  if (!type) return

  if (type === 'cost-state') {
    if (record.sessionId) costBySession.set(record.sessionId, record)
    return
  }

  if (type !== 'user' && type !== 'assistant') return

  const iso = isoOrNull(record.timestamp)
  bumpRange(project.range, iso)
  project.messages++
  if (type === 'user') project.userMessages++
  else project.assistantMessages++

  if (typeof record.cwd === 'string') project.cwds.set(record.cwd, (project.cwds.get(record.cwd) || 0) + 1)
  if (typeof record.gitBranch === 'string' && record.gitBranch) project.branches.add(record.gitBranch)
  if (typeof record.version === 'string' && record.version) project.versions.add(record.version)

  const model = record.message && record.message.model
  if (typeof model === 'string' && !model.startsWith('<')) {
    project.models.set(model, (project.models.get(model) || 0) + 1)
    models.set(model, (models.get(model) || 0) + 1)
  }

  const content = record.message && record.message.content
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (!block || block.type !== 'tool_use') continue
    if (block.name !== 'Agent' && block.name !== 'Task') continue
    // Only the subagent type and the model override are read here. The sibling
    // description and prompt fields are the task text and stay unread.
    const kind = block.input && block.input.subagent_type
    if (typeof kind !== 'string' || !kind) continue

    let spawn = spawns.get(kind)
    if (!spawn) {
      spawn = { runs: 0, range: { first: null, last: null }, projects: new Set(), models: new Set() }
      spawns.set(kind, spawn)
    }
    spawn.runs++
    spawn.projects.add(project.name)
    bumpRange(spawn.range, iso)
    const override = block.input.model
    if (typeof override === 'string' && override) spawn.models.add(override)
    project.subagents.set(kind, (project.subagents.get(kind) || 0) + 1)
  }
}

function collectDefinitions(dir, source, plugin) {
  const found = []
  for (const entry of readDir(dir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const meta = readFrontmatter(path.join(dir, entry.name))
    if (!meta) continue
    found.push({
      name: meta.name || entry.name.replace(/\.md$/, ''),
      description: meta.description,
      model: meta.model,
      tools: meta.tools,
      source,
      plugin: plugin || null
    })
  }
  return found
}

function collectSkills(dir, source, plugin) {
  const found = []
  for (const entry of readDir(dir)) {
    if (!entry.isDirectory()) continue
    const meta = readFrontmatter(path.join(dir, entry.name, 'SKILL.md'))
    found.push({
      name: (meta && meta.name) || entry.name,
      description: meta ? meta.description : null,
      source,
      plugin: plugin || null
    })
  }
  return found
}

function scanPlugins(root) {
  const agents = []
  const skills = []
  const marketplaces = path.join(root, 'plugins', 'marketplaces')

  for (const market of readDir(marketplaces)) {
    if (!market.isDirectory()) continue
    const marketDir = path.join(marketplaces, market.name)
    for (const group of ['plugins', 'external_plugins']) {
      for (const plugin of readDir(path.join(marketDir, group))) {
        if (!plugin.isDirectory()) continue
        const pluginDir = path.join(marketDir, group, plugin.name)
        agents.push(...collectDefinitions(path.join(pluginDir, 'agents'), 'plugin', plugin.name))
        skills.push(...collectSkills(path.join(pluginDir, 'skills'), 'plugin', plugin.name))
      }
    }
  }
  return { agents, skills, marketplaces: readDir(marketplaces).filter(d => d.isDirectory()).map(d => d.name) }
}

function freshness(lastSeen, now) {
  if (!lastSeen) return 'never'
  const age = now - Date.parse(lastSeen)
  if (!Number.isFinite(age)) return 'never'
  if (age < 10 * 60 * 1000) return 'active'
  if (age < 24 * 60 * 60 * 1000) return 'idle'
  return 'dormant'
}

async function build(args, report) {
  const now = Date.now()
  const { projects, spawns, models } = await scanSessions(args.root, report)
  const plugins = scanPlugins(args.root)

  const agents = []

  // One worker per project stands in for the main sessions run there.
  for (const project of projects.values()) {
    agents.push({
      id: 'project:' + project.name,
      name: project.name,
      role: 'Main session',
      source: 'project',
      kind: 'session-worker',
      description: `Top-level Claude sessions in ${project.name}.`,
      model: [...project.models.entries()].sort((a, b) => b[1] - a[1]).map(m => m[0])[0] || null,
      models: [...project.models.keys()],
      tools: [],
      plugin: null,
      projects: [project.name],
      runs: project.sessions,
      messages: project.messages,
      firstSeen: project.range.first,
      lastSeen: project.range.last,
      state: freshness(project.range.last, now)
    })
  }

  for (const [kind, spawn] of spawns) {
    agents.push({
      id: 'builtin:' + kind,
      name: kind,
      role: 'Subagent',
      source: 'builtin',
      kind: 'subagent',
      description: BUILTIN_AGENTS[kind] || 'Subagent spawned through the Agent tool.',
      model: [...spawn.models][0] || null,
      models: [...spawn.models],
      tools: [],
      plugin: null,
      projects: [...spawn.projects],
      runs: spawn.runs,
      messages: 0,
      firstSeen: spawn.range.first,
      lastSeen: spawn.range.last,
      state: freshness(spawn.range.last, now)
    })
  }

  const definitions = [...plugins.agents]
  for (const project of projects.values()) {
    if (!project.realPath) continue
    definitions.push(...collectDefinitions(path.join(project.realPath, '.claude', 'agents'), 'project', project.name))
  }
  definitions.push(...collectDefinitions(path.join(args.root, 'agents'), 'user', null))

  for (const def of definitions) {
    const id = `${def.source}:${def.plugin || 'local'}:${def.name}`
    if (agents.some(a => a.id === id)) continue
    const spawn = spawns.get(def.name)
    agents.push({
      id,
      name: def.name,
      role: def.source === 'plugin' ? `Plugin agent · ${def.plugin}` : def.source === 'project' ? 'Project agent' : 'User agent',
      source: def.source,
      kind: 'definition',
      description: def.description,
      model: def.model,
      models: def.model ? [def.model] : [],
      tools: def.tools,
      plugin: def.plugin,
      projects: spawn ? [...spawn.projects] : [],
      runs: spawn ? spawn.runs : 0,
      messages: 0,
      firstSeen: spawn ? spawn.range.first : null,
      lastSeen: spawn ? spawn.range.last : null,
      state: freshness(spawn ? spawn.range.last : null, now)
    })
  }

  const skills = [...plugins.skills]
  for (const project of projects.values()) {
    if (!project.realPath) continue
    skills.push(...collectSkills(path.join(project.realPath, '.claude', 'skills'), 'project', project.name))
  }
  skills.push(...collectSkills(path.join(args.root, 'skills'), 'user', null))

  const projectList = [...projects.values()].map(p => ({
    name: p.name,
    sessions: p.sessions,
    messages: p.messages,
    userMessages: p.userMessages,
    assistantMessages: p.assistantMessages,
    firstSeen: p.range.first,
    lastSeen: p.range.last,
    branches: [...p.branches],
    models: [...p.models.entries()].sort((a, b) => b[1] - a[1]).map(([id, messages]) => ({ id, messages })),
    linesAdded: p.linesAdded,
    linesRemoved: p.linesRemoved,
    costUSD: Math.round(p.costUSD * 100) / 100,
    state: freshness(p.range.last, now)
  })).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))

  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date(now).toISOString(),
    source: 'scan-claude-agents',
    totals: {
      projects: projectList.length,
      sessions: report.sessionCount,
      messages: projectList.reduce((sum, p) => sum + p.messages, 0),
      agents: agents.length,
      agentsWithRuns: agents.filter(a => a.runs > 0).length,
      subagentSpawns: [...spawns.values()].reduce((sum, s) => sum + s.runs, 0),
      skills: skills.length,
      marketplaces: plugins.marketplaces.length,
      malformedLines: report.badLines
    },
    models: [...models.entries()].sort((a, b) => b[1] - a[1]).map(([id, messages]) => ({ id, messages })),
    projects: projectList,
    agents: agents.sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name)),
    skills: skills.sort((a, b) => a.name.localeCompare(b.name))
  }
}

// Last line of defence: walk the finished snapshot and refuse to ship it if a
// Windows or POSIX home path survived anywhere in it.
function auditPaths(snapshot) {
  const hits = []
  const home = basenameOf(os.homedir()).toLowerCase()
  const walk = (value, trail) => {
    if (typeof value === 'string') {
      const suspect = /[A-Za-z]:[\\/]/.test(value) || /(^|[\\/])(Users|home)[\\/]/.test(value) ||
        (home && value.toLowerCase().includes(home))
      if (suspect) hits.push(`${trail} = ${value.slice(0, 80)}`)
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${trail}[${i}]`))
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, `${trail}.${k}`)
    }
  }
  walk(snapshot, 'snapshot')
  return hits
}

function summarise(snapshot) {
  const t = snapshot.totals
  const bySource = {}
  for (const a of snapshot.agents) bySource[a.source] = (bySource[a.source] || 0) + 1
  const lines = [
    '',
    'Claude agent snapshot',
    '─'.repeat(52),
    `  projects          ${t.projects}`,
    `  sessions          ${t.sessions}`,
    `  messages          ${t.messages}`,
    `  agents            ${t.agents}  (${t.agentsWithRuns} with real activity)`,
    `  subagent spawns   ${t.subagentSpawns}`,
    `  skills            ${t.skills}`,
    `  malformed lines   ${t.malformedLines}`,
    '',
    '  by source         ' + (Object.entries(bySource).map(([s, n]) => `${s} ${n}`).join(' · ') || 'none'),
    ''
  ]
  for (const p of snapshot.projects) {
    lines.push(`  ${p.name.padEnd(18)} ${String(p.sessions).padStart(3)} sessions  ${String(p.messages).padStart(5)} msgs  ${p.state}`)
  }
  lines.push('')
  for (const a of snapshot.agents.filter(a => a.runs > 0)) {
    lines.push(`  ${a.name.padEnd(18)} ${String(a.runs).padStart(3)} runs      ${a.source.padEnd(8)} ${a.state}`)
  }
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(helpText())
    return
  }

  if (!fs.existsSync(args.root)) {
    console.error(`No Claude home at ${args.root} — pass --root if it lives elsewhere.`)
    process.exitCode = 1
    return
  }

  const report = { badLines: 0, sessionCount: 0 }
  const snapshot = await build(args, report)

  const leaks = auditPaths(snapshot)
  if (leaks.length) {
    console.error('Refusing to emit: the snapshot still contains path-like values.')
    leaks.slice(0, 10).forEach(h => console.error('  ' + h))
    process.exitCode = 1
    return
  }

  process.stdout.write(summarise(snapshot))

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(snapshot, null, 2))
    console.log(`Wrote ${args.out} — inspect it, then re-run without --out to upload.\n`)
    return
  }

  const endpoint = args.url.replace(/\/$/, '') + '/api/agents'
  const headers = { 'Content-Type': 'application/json' }
  if (args.user) headers['x-user-id'] = args.user

  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(snapshot) })
  if (!response.ok) {
    console.error(`Upload to ${endpoint} failed: ${response.status} ${response.statusText}`)
    process.exitCode = 1
    return
  }
  console.log(`Uploaded to ${endpoint} — reload the Agent Office tab.\n`)
}

main().catch(err => {
  console.error('Scan failed:', err && err.message ? err.message : err)
  process.exitCode = 1
})
