import { createWheel } from './wheel.js';
import { createAudio } from './audio.js';
import { renderItemList, showResultModal, hideResultModal, renderHistory, renderSavedConfigs, announceResult } from './ui.js';
import { saveConfig, loadConfigs, deleteConfig, addHistoryEntry, loadHistory, clearHistory } from './storage.js';
import { getToken, saveToken, fetchPlaces, hasConfigToken, getListUrl } from './clickup.js';

// State
let mode = 'clickup'; // 'clickup' or 'custom'
let clickupItems = [];
let customItems = ['Sushi Palace', 'Taco Town', 'Pizza Planet'];

function activeItems() {
  return mode === 'clickup' ? clickupItems : customItems;
}

// DOM
const canvas = document.getElementById('wheel-canvas');
const spinBtn = document.getElementById('spin-btn');
const soundToggle = document.getElementById('sound-toggle');
const saveBtn = document.getElementById('save-btn');
const savedConfigsEl = document.getElementById('saved-configs');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const resultModal = document.getElementById('result-modal');
const modalClose = document.getElementById('modal-close');
const announcer = document.getElementById('announcer');

// Mode tabs
const tabClickup = document.getElementById('tab-clickup');
const tabCustom = document.getElementById('tab-custom');
const panelClickup = document.getElementById('panel-clickup');
const panelCustom = document.getElementById('panel-custom');

// ClickUp panel
const syncBtn = document.getElementById('sync-btn');
const clickupItemList = document.getElementById('item-list-clickup');
const clickupTokenInput = document.getElementById('clickup-token');
const saveTokenBtn = document.getElementById('save-token-btn');
const clickupStatus = document.getElementById('clickup-status');

// Custom panel
const itemInput = document.getElementById('item-input');
const addBtn = document.getElementById('add-btn');
const customItemList = document.getElementById('item-list-custom');
const templateHint = document.getElementById('template-hint');
const copyClickupBtn = document.getElementById('copy-clickup-btn');

// Modules
const audio = createAudio();
const wheel = createWheel(canvas, {
  onTick: () => audio.playTick(),
  onResult: (result) => {
    addHistoryEntry(result);
    renderHistory(historyList, loadHistory());
    showResultModal(resultModal, result);
    announceResult(announcer, result);
    fireConfetti();
    spinBtn.disabled = false;
  }
});

// --- Mode switching ---
function setMode(newMode) {
  mode = newMode;
  const isClickup = mode === 'clickup';

  tabClickup.classList.toggle('active', isClickup);
  tabCustom.classList.toggle('active', !isClickup);
  tabClickup.setAttribute('aria-selected', isClickup);
  tabCustom.setAttribute('aria-selected', !isClickup);
  panelClickup.hidden = !isClickup;
  panelCustom.hidden = isClickup;

  wheel.setItems(activeItems());
  updateUI();
}

tabClickup.addEventListener('click', () => setMode('clickup'));
tabCustom.addEventListener('click', () => setMode('custom'));

// --- Custom mode ---
function addItem(name) {
  const trimmed = name.trim();
  if (!trimmed || customItems.length >= 20) return;
  customItems.push(trimmed);
  wheel.setItems(activeItems());
  updateUI();
  itemInput.value = '';
  itemInput.focus();
}

function removeCustomItem(index) {
  customItems.splice(index, 1);
  wheel.setItems(activeItems());
  updateUI();
}

addBtn.addEventListener('click', () => addItem(itemInput.value));
itemInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addItem(itemInput.value);
});

// Copy ClickUp items into custom list
copyClickupBtn.addEventListener('click', () => {
  if (clickupItems.length === 0) return;
  customItems = [...clickupItems];
  wheel.setItems(activeItems());
  updateUI();
});

// --- ClickUp mode ---
if (hasConfigToken()) {
  document.getElementById('clickup-details').style.display = 'none';
}

if (getToken()) {
  if (!hasConfigToken()) {
    clickupTokenInput.value = '••••••••';
  }
  syncFromClickUp();
}

saveTokenBtn.addEventListener('click', () => {
  const token = clickupTokenInput.value.trim();
  if (!token || token === '••••••••') return;
  saveToken(token);
  clickupTokenInput.value = '••••••••';
  setClickupStatus('Token saved', 'success');
  syncFromClickUp();
});

clickupTokenInput.addEventListener('focus', () => {
  if (clickupTokenInput.value === '••••••••') clickupTokenInput.value = '';
});

clickupTokenInput.addEventListener('blur', () => {
  if (!clickupTokenInput.value && getToken()) clickupTokenInput.value = '••••••••';
});

syncBtn.addEventListener('click', () => syncFromClickUp({ force: true }));

async function syncFromClickUp({ force = false } = {}) {
  if (!getToken()) {
    setClickupStatus('Set your API token first', 'error');
    return;
  }
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing...';
  setClickupStatus('', '');

  try {
    const places = await fetchPlaces({ force });
    if (places && places.length > 0) {
      clickupItems = places;
      if (mode === 'clickup') {
        wheel.setItems(clickupItems);
      }
      updateUI();
      setClickupStatus(`Synced ${places.length} places`, 'success');
    } else if (places && places.length === 0) {
      setClickupStatus('No open tasks found in list', 'error');
    }
  } catch (err) {
    const msg = err.message.includes('401') ? 'Invalid token' :
                err.message.includes('404') ? 'List not found' :
                'Sync failed';
    setClickupStatus(msg, 'error');
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = 'Sync from ClickUp';
  }
}

function setClickupStatus(text, type) {
  clickupStatus.textContent = text;
  clickupStatus.className = 'clickup-status' + (type ? ` ${type}` : '');
}

// --- Spin ---
spinBtn.addEventListener('click', () => {
  if (wheel.isSpinning() || activeItems().length < 2) return;
  spinBtn.disabled = true;
  wheel.spin();
});

// --- Sound ---
soundToggle.addEventListener('change', () => {
  audio.setEnabled(soundToggle.checked);
});

// --- Modal ---
modalClose.addEventListener('click', () => hideResultModal(resultModal));
resultModal.addEventListener('click', (e) => {
  if (e.target === resultModal) hideResultModal(resultModal);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !resultModal.hidden) hideResultModal(resultModal);
});

// --- Save/load configs (custom mode only) ---
saveBtn.addEventListener('click', () => {
  if (customItems.length === 0) return;
  const name = prompt('Name this wheel:');
  if (!name?.trim()) return;
  saveConfig(name.trim(), [...customItems]);
  refreshSavedConfigs();
});

function onLoadConfig(config) {
  customItems = [...config.items];
  setMode('custom');
}

function onDeleteConfig(name) {
  deleteConfig(name);
  refreshSavedConfigs();
}

// --- Clear history ---
clearHistoryBtn.addEventListener('click', () => {
  clearHistory();
  renderHistory(historyList, []);
});

// --- Confetti ---
function fireConfetti() {
  if (typeof confetti !== 'function') return;
  const defaults = { startVelocity: 30, spread: 70, ticks: 60, zIndex: 200 };
  confetti({ ...defaults, particleCount: 60, origin: { x: 0.25, y: 0.6 } });
  confetti({ ...defaults, particleCount: 60, origin: { x: 0.75, y: 0.6 } });
}

// --- UI updates ---
function updateUI() {
  // Render the correct item list for the active mode
  if (mode === 'clickup') {
    renderItemList(clickupItemList, clickupItems);
    renderItemList(customItemList, customItems, removeCustomItem);
  } else {
    renderItemList(customItemList, customItems, removeCustomItem);
    renderItemList(clickupItemList, clickupItems);
  }
  // Show "Copy from ClickUp" when there are ClickUp items to copy
  templateHint.hidden = clickupItems.length === 0;
  spinBtn.disabled = activeItems().length < 2;
  refreshSavedConfigs();
  renderHistory(historyList, loadHistory());
}

function refreshSavedConfigs() {
  renderSavedConfigs(savedConfigsEl, loadConfigs(), onLoadConfig, onDeleteConfig);
}

// --- Init ---
wheel.setItems(activeItems());
updateUI();

// Set ClickUp list link dynamically
const listLink = document.getElementById('clickup-list-link');
const listUrl = getListUrl();
if (listUrl) {
  listLink.href = listUrl;
} else {
  listLink.removeAttribute('href');
  listLink.style.pointerEvents = 'none';
}
