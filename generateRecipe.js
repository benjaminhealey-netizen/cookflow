// functions/api/generateRecipe.js
// Cloudflare Pages Function

export async function onRequestPost(context) {
  const { request, env } = context;

  let prompt, filters;
  try {
    const body = await request.json();
    prompt = body.prompt;
    filters = Array.isArray(body.filters) ? body.filters : [];
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() });
  }

  if (!prompt || !prompt.trim()) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400, headers: corsHeaders() });
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OpenAI API key not configured' }), { status: 500, headers: corsHeaders() });
  }

  const filterInstructions = filters.length > 0
    ? `\n\nCRITICAL DIETARY RESTRICTIONS — strictly follow ALL of these. Never include any ingredient that violates them:\n${filters.map(f => `- ${f}`).join('\n')}`
    : '';

  const systemPrompt = `You are a world-class chef and recipe writer. Respond ONLY with a valid JSON object — no markdown, no code fences, no extra text.

The JSON must follow this EXACT structure:
{
  "title": "Recipe Name",
  "description": "One to two sentence description.",
  "ingredients": ["quantity unit ingredient", "..."],
  "steps": ["Complete cooking instruction. ", "..."],
  "notes": ["Optional tip.", "..."],
  "dietaryTags": ["vegetarian", "gluten-free", "..."]
}

Rules:
- title: short appetizing name (string)
- description: 1-2 sentences (string)
- ingredients: 4-14 items with quantities (array of strings)
- steps: 4-10 clear steps. ALWAYS put a space after every period before the next word.
- notes: 1-3 tips (array, can be [])
- dietaryTags: only tags from ["vegetarian","vegan","gluten-free","dairy-free","nut-free","shellfish-free","low-carb","halal","kosher"] that genuinely apply${filterInstructions}

Respond ONLY with raw JSON.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.75,
        max_tokens: 1000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Create a recipe for: ${prompt.trim()}` },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('OpenAI error:', res.status, err);
      return new Response(JSON.stringify({ error: 'OpenAI request failed', status: res.status }), { status: 502, headers: corsHeaders() });
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return new Response(JSON.stringify({ error: 'Empty OpenAI response' }), { status: 502, headers: corsHeaders() });

    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let recipe;
    try { recipe = JSON.parse(cleaned); }
    catch { return new Response(JSON.stringify({ error: 'Failed to parse recipe JSON' }), { status: 502, headers: corsHeaders() }); }

    if (!recipe.title || !Array.isArray(recipe.ingredients) || !Array.isArray(recipe.steps)) {
      return new Response(JSON.stringify({ error: 'Recipe missing required fields' }), { status: 502, headers: corsHeaders() });
    }
    if (!Array.isArray(recipe.notes)) recipe.notes = [];
    if (!Array.isArray(recipe.dietaryTags)) recipe.dietaryTags = [];

    return new Response(JSON.stringify(recipe), { status: 200, headers: corsHeaders() });
  } catch (err) {
    console.error('Function error:', err);
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
