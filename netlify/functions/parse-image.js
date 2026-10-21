// Netlify gives a synchronous function 10s. The NVIDIA NIM endpoint regularly
// takes longer than that, which surfaced as a 504 and an HTML error page rather
// than anything the client could read, so every call is bounded here instead.
const CALL_TIMEOUT_MS = 8500

const PROMPT =
  'Extract trade data from this image (P&L card or TradingView chart screenshot). ' +
  'These cards often show a loss in red with no minus sign: if the P&L is red, or if the direction and prices ' +
  'imply a loss (Long with exitPrice below entryPrice, Short with exitPrice above entryPrice), return pnl as a ' +
  'NEGATIVE number. Copy prices digit for digit. Use null for anything not visible in the image.'

const SCHEMA = {
  type: 'object',
  properties: {
    symbol: { type: 'string' },
    type: { type: 'string' },
    qty: { type: 'number' },
    entryPrice: { type: 'number' },
    exitPrice: { type: 'number' },
    pnl: { type: 'number' },
    openTime: { type: 'string', nullable: true },
    closeTime: { type: 'string', nullable: true },
    stopLoss: { type: 'number', nullable: true },
    takeProfit: { type: 'number', nullable: true }
  },
  required: ['symbol', 'type', 'qty', 'entryPrice', 'exitPrice', 'pnl']
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

async function postJSON(url, headers, payload, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(data?.error?.message || `${label} returned ${res.status}`)
    }
    return data
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`${label} did not answer within ${CALL_TIMEOUT_MS / 1000}s. Try again, or switch provider.`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// Gemini is constrained by a response schema, so the reply is already the shape
// we want — no scraping a JSON object out of prose.
async function readWithGemini(apiKey, base64, mediaType) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const data = await postJSON(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { 'x-goog-api-key': apiKey },
    {
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mediaType, data: base64 } }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: SCHEMA }
    },
    'Gemini'
  )

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    const blocked = data?.promptFeedback?.blockReason
    throw new Error(blocked ? `Gemini declined the image (${blocked}).` : 'Gemini returned no content.')
  }
  return text
}

async function readWithNvidia(apiKey, base64, mediaType) {
  const data = await postJSON(
    'https://integrate.api.nvidia.com/v1/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    {
      model: process.env.NVIDIA_MODEL || 'meta/llama-3.2-11b-vision-instruct',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${PROMPT} Return ONLY valid JSON with keys: symbol, type, qty, entryPrice, exitPrice, pnl, openTime, closeTime, stopLoss, takeProfit.` },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 1024
    },
    'NVIDIA NIM'
  )

  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('The vision model returned no content.')
  return content
}

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Request body was not valid JSON.' }, 400)
  }

  const { imageBase64, mediaType = 'image/jpeg' } = body || {}
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return json({ error: 'No image data was sent.' }, 400)
  }

  // Tolerate a client that posts the whole data URL rather than just the payload.
  const base64 = imageBase64.includes(',') ? imageBase64.slice(imageBase64.indexOf(',') + 1) : imageBase64

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  const nvidiaKey = process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY

  if (!geminiKey && !nvidiaKey) {
    return json({
      error: 'No vision API key is set. Add GEMINI_API_KEY (or NVIDIA_API_KEY) in Netlify Environment Variables, scoped to Functions.'
    }, 400)
  }

  try {
    // Gemini wins when both are present: it is faster, reads small numerals more
    // reliably, and its schema removes the "model wrapped the JSON in prose" case.
    const text = geminiKey
      ? await readWithGemini(geminiKey, base64, mediaType)
      : await readWithNvidia(nvidiaKey, base64, mediaType)

    const match = text.match(/\{[\s\S]*\}/)
    let parsed
    try {
      parsed = JSON.parse(match ? match[0] : text)
    } catch {
      throw new Error('The vision model did not return readable JSON for that image.')
    }

    return json({ ...parsed, provider: geminiKey ? 'gemini' : 'nvidia' })
  } catch (e) {
    return json({ error: e.message }, 502)
  }
}

export const config = {
  path: '/api/parse-image'
}
