const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

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

  const apiKey = process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY
  if (!apiKey) {
    return json({
      error: 'NVIDIA_API_KEY environment variable is missing. Set it in Netlify Environment Variables.'
    }, 400)
  }

  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'meta/llama-3.2-11b-vision-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract trade data from this image (P&L card or TradingView chart screenshot) as strict JSON with keys: symbol (e.g. MNQ, MES), type (Long/Short), qty (number), entryPrice (number), exitPrice (number), pnl (number), openTime, closeTime, stopLoss (number or null if not found), takeProfit (number or null if not found). Return ONLY valid JSON.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mediaType};base64,${base64}`
                }
              }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 1024
      })
    })

    const data = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(data?.error?.message || `NVIDIA NIM API error (${res.status})`)
    }

    const content = data?.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('The vision model returned no content.')
    }

    // Extract the JSON block in case the model wrapped it in prose or a code fence.
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    let parsed
    try {
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content)
    } catch {
      throw new Error('The vision model did not return readable JSON for that image.')
    }

    return json(parsed)
  } catch (e) {
    return json({ error: e.message }, 500)
  }
}

export const config = {
  path: '/api/parse-image'
}
