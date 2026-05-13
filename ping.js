// functions/api/ping.js
// Debug endpoint - visit /api/ping to check if functions are working

export async function onRequest(context) {
  const { env } = context;

  const hasOpenAI = !!(env.OPENAI_API_KEY);
  const hasSpoon = !!(env.SPOONACULAR_API_KEY);

  return new Response(JSON.stringify({
    ok: true,
    message: 'Cloudflare Pages Functions are working',
    env: {
      OPENAI_API_KEY: hasOpenAI ? '✓ set' : '✗ MISSING',
      SPOONACULAR_API_KEY: hasSpoon ? '✓ set' : '✗ MISSING',
    }
  }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
