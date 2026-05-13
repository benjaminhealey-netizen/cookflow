// functions/api/scanFridge.js
// Cloudflare Pages Function — OpenAI vision ingredient detection

export async function onRequestPost(context) {
  const { request, env } = context;

  let image;
  try {
    const body = await request.json();
    image = body.image;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() });
  }

  if (!image || typeof image !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing image data' }), { status: 400, headers: corsHeaders() });
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OpenAI API key not configured' }), { status: 500, headers: corsHeaders() });
  }

  const systemPrompt = `You are a culinary ingredient detection assistant. Identify every food ingredient visible in the photo and return them as JSON.

Respond ONLY with:
{
  "ingredients": ["ingredient 1", "ingredient 2", "..."]
}

Rules:
- Simple names with specifics where visible: "cherry tomatoes", "garlic", "cheddar cheese"
- Include condiments and sauces only if food-usable
- Ignore non-food items
- Return 3-20 ingredients max
- If unclear, return { "ingredients": [] }
- Raw JSON only, no markdown.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}`, detail: 'low' } },
              { type: 'text', text: 'What food ingredients do you see? Return JSON only.' },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('OpenAI vision error:', res.status, err);
      return new Response(JSON.stringify({ error: 'OpenAI vision request failed' }), { status: 502, headers: corsHeaders() });
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return new Response(JSON.stringify({ error: 'Empty response' }), { status: 502, headers: corsHeaders() });

    const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
    let result;
    try { result = JSON.parse(cleaned); }
    catch { return new Response(JSON.stringify({ error: 'Failed to parse JSON' }), { status: 502, headers: corsHeaders() }); }

    if (!Array.isArray(result.ingredients)) result.ingredients = [];
    return new Response(JSON.stringify({ ingredients: result.ingredients }), { status: 200, headers: corsHeaders() });
  } catch (err) {
    console.error('scanFridge error:', err);
    return new Response(JSON.stringify({ error: 'Internal error', details: err.message }), { status: 500, headers: corsHeaders() });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
