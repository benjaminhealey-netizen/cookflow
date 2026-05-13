// functions/api/searchRecipes.js
// Cloudflare Pages Function — Spoonacular first, AI fallback

const DIET_MAP = {
  'vegetarian': 'vegetarian',
  'vegan': 'vegan',
  'gluten-free': 'gluten free',
  'dairy-free': 'dairy free',
  'nut-free': null,
  'shellfish-free': null,
  'low-carb': 'paleo',
  'halal': null,
  'kosher': null,
};

const INTOLERANCE_MAP = {
  'gluten-free': 'gluten',
  'dairy-free': 'dairy',
  'nut-free': 'tree nut,peanut',
  'shellfish-free': 'shellfish',
};

export async function onRequestPost(context) {
  const { request, env } = context;

  let prompt, filters, count;
  try {
    const body = await request.json();
    prompt = body.prompt || '';
    filters = Array.isArray(body.filters) ? body.filters : [];
    count = Math.min(body.count || 3, 5);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: corsHeaders() });
  }

  const spoonKey = env.SPOONACULAR_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;

  // Try Spoonacular first
  if (spoonKey) {
    try {
      const spoonRecipes = await searchSpoonacular(prompt, filters, count, spoonKey);
      if (spoonRecipes && spoonRecipes.length > 0) {
        return new Response(JSON.stringify({ recipes: spoonRecipes, source: 'spoonacular' }), { status: 200, headers: corsHeaders() });
      }
    } catch (err) {
      console.error('Spoonacular error:', err.message);
    }
  }

  // Fallback to OpenAI
  if (!openaiKey) {
    return new Response(JSON.stringify({ error: 'No API keys configured' }), { status: 500, headers: corsHeaders() });
  }

  try {
    const aiRecipes = await generateMultipleAI(prompt, filters, count, openaiKey);
    return new Response(JSON.stringify({ recipes: aiRecipes, source: 'ai' }), { status: 200, headers: corsHeaders() });
  } catch (err) {
    console.error('AI fallback error:', err.message);
    return new Response(JSON.stringify({ error: 'Failed to fetch recipes' }), { status: 502, headers: corsHeaders() });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ==================== SPOONACULAR ====================

// Cuisine and meal type pools for variety injection
const CUISINE_POOL = ['italian','mexican','asian','mediterranean','american','french','indian','middle eastern','japanese','thai','greek','spanish','chinese','korean','vietnamese'];
const MEAL_TYPES = ['main course','side dish','appetizer','soup','salad','breakfast','dessert','snack'];

async function searchSpoonacular(prompt, filters, count, apiKey) {
  const diets = filters.map(f => DIET_MAP[f]).filter(Boolean);
  const intolerances = filters.flatMap(f => INTOLERANCE_MAP[f] ? INTOLERANCE_MAP[f].split(',') : []).filter(Boolean);

  const stopWords = new Set(['a','an','the','make','me','i','want','something','some','please','give','create','recipe','for','with','and','or','that','is','are','very','really','dish','food','meal','cook','cooking','quick','easy','healthy','best','great','delicious','simple','grilled','baked','fried','roasted']);
  const keywords = prompt.toLowerCase().replace(/[^a-z0-9 ]/g,'').split(' ')
    .filter(w => w.length > 2 && !stopWords.has(w)).slice(0,3).join(' ');

  // Run 2 searches in parallel with different offsets and random cuisine injection for variety
  const randomCuisine = CUISINE_POOL[Math.floor(Math.random() * CUISINE_POOL.length)];
  const randomOffset = Math.floor(Math.random() * 40);

  const makeParams = (extraOffset, cuisine) => new URLSearchParams({
    apiKey,
    query: keywords || 'dinner',
    number: count + 2,
    offset: extraOffset,
    addRecipeInformation: true,
    fillIngredients: false,
    instructionsRequired: true,
    sort: 'popularity',
    ...(cuisine && !keywords && { cuisine }),
    ...(diets.length > 0 && { diet: diets[0] }),
    ...(intolerances.length > 0 && { intolerances: intolerances.join(',') }),
  });

  const [res1, res2] = await Promise.all([
    fetch(`https://api.spoonacular.com/recipes/complexSearch?${makeParams(0, null)}`),
    fetch(`https://api.spoonacular.com/recipes/complexSearch?${makeParams(randomOffset, randomCuisine)}`),
  ]);

  const results = [];
  const seenIds = new Set();

  for (const res of [res1, res2]) {
    if (!res.ok) continue;
    const data = await res.json();
    for (const r of (data.results || [])) {
      if (!seenIds.has(r.id)) { seenIds.add(r.id); results.push(r); }
    }
  }

  if (!results.length) return [];

  // Shuffle for variety and take what we need
  const shuffled = results.sort(() => Math.random() - 0.5).slice(0, count);
  const detailed = await Promise.all(shuffled.map(r => fetchSpoonacularRecipe(r.id, apiKey)));
  return detailed.filter(Boolean);
}

async function fetchSpoonacularRecipe(id, apiKey) {
  try {
    const res = await fetch(`https://api.spoonacular.com/recipes/${id}/information?apiKey=${apiKey}&includeNutrition=false`);
    if (!res.ok) return null;
    const r = await res.json();

    let steps = [];
    if (r.analyzedInstructions?.length > 0) {
      steps = r.analyzedInstructions[0].steps.map(s => s.step);
    }
    if (!steps.length) return null;

    const ingredients = (r.extendedIngredients || []).map(ing =>
      `${ing.amount ? ing.amount + ' ' : ''}${ing.unit ? ing.unit + ' ' : ''}${ing.name}`.trim()
    );

    const dietaryTags = [];
    if (r.vegetarian) dietaryTags.push('vegetarian');
    if (r.vegan) dietaryTags.push('vegan');
    if (r.glutenFree) dietaryTags.push('gluten-free');
    if (r.dairyFree) dietaryTags.push('dairy-free');

    const description = (r.summary || '')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
      .split('.')[0].trim().substring(0, 140) + '.';

    return {
      title: r.title,
      description,
      ingredients,
      steps,
      notes: [],
      dietaryTags,
      emoji: pickEmoji(r.dishTypes || [], r.title),
      imageUrl: r.image || null,
      sourceUrl: r.sourceUrl || null,
    };
  } catch { return null; }
}

function pickEmoji(dishTypes, title) {
  const t = (dishTypes.join(' ') + ' ' + title).toLowerCase();
  if (t.includes('pasta')||t.includes('noodle')) return '🍝';
  if (t.includes('soup')||t.includes('stew')) return '🍲';
  if (t.includes('salad')) return '🥗';
  if (t.includes('burger')||t.includes('sandwich')) return '🥪';
  if (t.includes('pizza')) return '🍕';
  if (t.includes('taco')||t.includes('mexican')) return '🌮';
  if (t.includes('sushi')||t.includes('japanese')) return '🍱';
  if (t.includes('curry')||t.includes('indian')) return '🍛';
  if (t.includes('breakfast')||t.includes('egg')) return '🍳';
  if (t.includes('dessert')||t.includes('cake')) return '🧁';
  if (t.includes('chicken')) return '🍗';
  if (t.includes('fish')||t.includes('seafood')) return '🐟';
  if (t.includes('steak')||t.includes('beef')) return '🥩';
  if (t.includes('rice')) return '🍚';
  return ['🍽️','🥘','🫕','🍜','🥙'][Math.floor(Math.random()*5)];
}

// ==================== AI FALLBACK ====================
async function generateMultipleAI(prompt, filters, count, apiKey) {
  const filterInstructions = filters.length > 0
    ? `\nCRITICAL — strictly follow ALL these dietary restrictions:\n${filters.map(f => `- ${f}`).join('\n')}`
    : '';

  const styleVariants = [
    'Make it restaurant-quality and impressive.',
    'Make it a quick weeknight version.',
    'Give it an international twist.',
    'Make it a cozy homestyle version.',
    'Make it a healthy lighter version.',
  ];

  const promises = Array.from({ length: count }, (_, i) =>
    generateSingleAI(`${prompt}. ${styleVariants[i % styleVariants.length]}`, filters, filterInstructions, apiKey)
  );

  const results = await Promise.all(promises);
  return results.filter(Boolean);
}

async function generateSingleAI(prompt, filters, filterInstructions, apiKey) {
  const systemPrompt = `You are a world-class chef. Respond ONLY with a valid JSON object, no markdown.

{
  "title": "Recipe Name",
  "description": "1-2 sentence description.",
  "ingredients": ["quantity unit ingredient"],
  "steps": ["Step instruction. Always space after periods."],
  "notes": ["Tip."],
  "dietaryTags": ["vegetarian","vegan","gluten-free","dairy-free","nut-free","shellfish-free","low-carb","halal","kosher"]
}

Only include dietaryTags the recipe genuinely qualifies for.${filterInstructions}
Raw JSON only.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.9,
        max_tokens: 800,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Recipe for: ${prompt}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
    const recipe = JSON.parse(cleaned);
    if (!recipe.title || !recipe.ingredients || !recipe.steps) return null;
    if (!Array.isArray(recipe.notes)) recipe.notes = [];
    if (!Array.isArray(recipe.dietaryTags)) recipe.dietaryTags = [];
    return recipe;
  } catch { return null; }
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
