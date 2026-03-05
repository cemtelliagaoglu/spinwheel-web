const API_BASE = 'https://api.clickup.com/api/v2';
const CACHE_KEY = 'wswe_v1_clickup_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Local dev config (from gitignored config.js)
let localToken = '';
let localListId = '';
let configListUrl = '';

try {
  const { CONFIG } = await import('../config.js');
  localToken = CONFIG.CLICKUP_API_TOKEN || '';
  localListId = CONFIG.CLICKUP_LIST_ID || '';
  configListUrl = CONFIG.CLICKUP_LIST_URL || '';
} catch {
  // config.js not present — will use Netlify function instead
}

const isLocal = !!localToken;

export function getToken() {
  return localToken;
}

export function isConfigured() {
  // Local config available, or not on localhost (assume Netlify function exists)
  return isLocal || window.location.protocol === 'https:';
}

export function getListUrl() {
  return configListUrl;
}

function getCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (Date.now() - cache.time > CACHE_TTL) return null;
    return cache;
  } catch {
    return null;
  }
}

function setCache(places) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ places, time: Date.now() }));
  } catch {
    // Storage unavailable
  }
}

export async function fetchPlaces({ force = false } = {}) {
  // Return cached data if fresh enough
  if (!force) {
    const cache = getCache();
    if (cache) return cache.places;
  }

  let places;

  if (isLocal) {
    // Local dev: call ClickUp API directly with config.js token
    const res = await fetch(
      `${API_BASE}/list/${localListId}/task?archived=false&order_by=created&reverse=true`,
      { headers: { Authorization: localToken } }
    );
    if (!res.ok) throw new Error(`ClickUp API error: ${res.status}`);
    const data = await res.json();
    places = data.tasks
      .filter(t => t.status?.type !== 'closed')
      .map(t => t.name.trim())
      .filter(Boolean);
  } else {
    // Production: call Netlify function (token stays server-side)
    const res = await fetch(`/api/places${force ? '?force=true' : ''}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `API error: ${res.status}`);
    }
    const data = await res.json();
    places = data.places;
    // Pick up list URL from server if not set locally
    if (data.listUrl && !configListUrl) configListUrl = data.listUrl;
  }

  setCache(places);
  return places;
}
