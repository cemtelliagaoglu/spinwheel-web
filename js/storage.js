const CONFIGS_KEY = 'wswe_v1_configs';
const HISTORY_KEY = 'wswe_v1_history';
const MAX_CONFIGS = 20;
const MAX_HISTORY = 50;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Storage full or unavailable
  }
}

// Configs
export function saveConfig(name, items) {
  const configs = read(CONFIGS_KEY, []);
  const existing = configs.findIndex(c => c.name === name);
  if (existing >= 0) {
    configs[existing].items = items;
  } else {
    configs.unshift({ name, items });
  }
  write(CONFIGS_KEY, configs.slice(0, MAX_CONFIGS));
}

export function loadConfigs() {
  return read(CONFIGS_KEY, []);
}

export function deleteConfig(name) {
  const configs = read(CONFIGS_KEY, []);
  write(CONFIGS_KEY, configs.filter(c => c.name !== name));
}

// History
export function addHistoryEntry(result) {
  const history = read(HISTORY_KEY, []);
  history.unshift({
    result,
    time: Date.now()
  });
  write(HISTORY_KEY, history.slice(0, MAX_HISTORY));
}

export function loadHistory() {
  return read(HISTORY_KEY, []);
}

export function clearHistory() {
  write(HISTORY_KEY, []);
}
