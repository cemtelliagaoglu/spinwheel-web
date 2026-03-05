const API_BASE = 'https://api.clickup.com/api/v2';

// Allowed origins — update with your actual Netlify domain
const ALLOWED_ORIGINS = new Set([
  'http://localhost:8000',
  'http://localhost:3000',
  'http://127.0.0.1:8000',
]);

function getAllowedOrigin(requestOrigin) {
  if (!requestOrigin) return null;
  if (ALLOWED_ORIGINS.has(requestOrigin)) return requestOrigin;
  // Allow any *.netlify.app subdomain for your deploys
  if (/^https:\/\/[\w-]+\.netlify\.app$/.test(requestOrigin)) return requestOrigin;
  return null;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default async function handler(req, context) {
  const origin = req.headers.get('origin');
  const allowedOrigin = getAllowedOrigin(origin);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
  }

  // Only GET allowed
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders(allowedOrigin), 'Content-Type': 'application/json' },
    });
  }

  const token = Netlify.env.get('CLICKUP_API_TOKEN');
  const listId = Netlify.env.get('CLICKUP_LIST_ID');

  if (!token || !listId) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders(allowedOrigin), 'Content-Type': 'application/json' },
    });
  }

  // Check force param for cache-control hint
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';

  try {
    const res = await fetch(
      `${API_BASE}/list/${listId}/task?archived=false&order_by=created&reverse=true`,
      { headers: { Authorization: token } }
    );

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `ClickUp API: ${res.status}` }), {
        status: res.status,
        headers: { ...corsHeaders(allowedOrigin), 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    const places = data.tasks
      .filter(t => t.status?.type !== 'closed')
      .map(t => t.name.trim())
      .filter(Boolean);

    const listUrl = Netlify.env.get('CLICKUP_LIST_URL') || '';

    return new Response(JSON.stringify({ places, listUrl }), {
      status: 200,
      headers: {
        ...corsHeaders(allowedOrigin),
        'Content-Type': 'application/json',
        // Cache at CDN level for 5 min unless force refresh
        'Cache-Control': force ? 'no-cache' : 'public, max-age=300',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch from ClickUp' }), {
      status: 502,
      headers: { ...corsHeaders(allowedOrigin), 'Content-Type': 'application/json' },
    });
  }
}

export const config = {
  path: '/api/places',
};
