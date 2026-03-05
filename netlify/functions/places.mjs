const API_BASE = 'https://api.clickup.com/api/v2';

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };

  // CORS: allow same-site requests (no origin) + localhost + *.netlify.app
  if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || /^https:\/\/[\w-]+\.netlify\.app$/.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  const token = process.env.CLICKUP_API_TOKEN;
  const listId = process.env.CLICKUP_LIST_ID;

  if (!token || !listId) {
    return new Response(JSON.stringify({ error: 'Server misconfigured — set CLICKUP_API_TOKEN and CLICKUP_LIST_ID env vars' }), { status: 500, headers });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';

  try {
    const res = await fetch(
      `${API_BASE}/list/${listId}/task?archived=false&order_by=created&reverse=true`,
      { headers: { Authorization: token } }
    );

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `ClickUp API: ${res.status}` }), { status: res.status, headers });
    }

    const data = await res.json();
    const places = data.tasks
      .filter(t => t.status?.type !== 'closed')
      .map(t => t.name.trim())
      .filter(Boolean);

    const listUrl = process.env.CLICKUP_LIST_URL || '';

    return new Response(JSON.stringify({ places, listUrl }), {
      status: 200,
      headers: {
        ...headers,
        'Cache-Control': force ? 'no-cache' : 'public, max-age=300',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to fetch from ClickUp' }), { status: 502, headers });
  }
}

export const config = {
  path: '/api/places',
};
