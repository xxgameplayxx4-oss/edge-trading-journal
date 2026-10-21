import { getStore } from '@netlify/blobs'

export default async (request) => {
  const store = getStore({ name: 'trading-journal', consistency: 'strong' })
  const userId = request.headers.get('x-user-id') || 'anonymous'

  if (request.method === 'GET') {
    const data = await store.get(`journal-${userId}`, { type: 'json' })
    return new Response(JSON.stringify(data || { trades: [], uploads: [] }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (request.method === 'POST') {
    const body = await request.json()
    await store.setJSON(`journal-${userId}`, body)
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config = {
  path: '/api/journal'
}