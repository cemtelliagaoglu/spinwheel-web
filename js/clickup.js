let LIST_ID = '';
const API_BASE = 'https://api.clickup.com/api/v2';
const CACHE_KEY = 'wswe_v1_clickup_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let configToken = '';
let configListUrl = '';

// Try loading from config.js (gitignored, for local dev)
try {
  const { CONFIG } = await import('../config.js');
  configToken = CONFIG.CLICKUP_API_TOKEN || '';
  LIST_ID = CONFIG.CLICKUP_LIST_ID || '';
  configListUrl = CONFIG.CLICKUP_LIST_URL || '';
} catch {
  // config.js not present — that's fine, fall back to localStorage
}

export function getToken() {
  return configToken;
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
  const token = getToken();
  if (!token) return null;

  // Return cached data if fresh enough
  if (!force) {
    const cache = getCache();
    if (cache) return cache.places;
  }

  const res = await fetch(`${API_BASE}/list/${LIST_ID}/task?archived=false&order_by=created&reverse=true`, {
    headers: { Authorization: token }
  });

  if (!res.ok) {
    throw new Error(`ClickUp API error: ${res.status}`);
  }

  const data = await res.json();
  const places = data.tasks
    .filter(t => t.status?.type !== 'closed')
    .map(t => t.name.trim())
    .filter(Boolean);

  setCache(places);
  return places;
}
