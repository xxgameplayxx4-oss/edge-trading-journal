export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { imageBase64 } = await request.json()
  const apiKey = process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY

  if (!apiKey) {
    return new Response(JSON.stringify({
      error: 'NVIDIA_API_KEY environment variable is missing. Set it in Netlify Environment Variables.'
    }), { status: 400 })
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
                  url: `data:image/jpeg;base64,${imageBase64}`
                }
              }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 1024
      })
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error(data.error?.message || 'NVIDIA NIM API error')
    }

    const content = data.choices[0].message.content
    // Extract JSON block if surrounded by markdown code blocks
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    const jsonText = jsonMatch ? jsonMatch[0] : content

    return new Response(jsonText, {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}

export const config = {
  path: '/api/parse-image'
}