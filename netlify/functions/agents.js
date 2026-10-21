import { getStore } from '@netlify/blobs'

const EMPTY = { version: 1, generatedAt: null, totals: {}, models: [], projects: [], agents: [], skills: [] }

export default async (request) => {
  const store = getStore({ name: 'claude-agents', consistency: 'strong' })
  const userId = request.headers.get('x-user-id') || 'anonymous'

  if (request.method === 'GET') {
    const data = await store.get(`agents-${userId}`, { type: 'json' })
    return new Response(JSON.stringify(data || EMPTY), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (request.method === 'POST') {
    const body = await request.json()
    await store.setJSON(`agents-${userId}`, body)
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config = {
  path: '/api/agents'
}
