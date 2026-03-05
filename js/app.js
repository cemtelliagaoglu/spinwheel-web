import { createWheel } from './wheel.js';
import { createAudio } from './audio.js';
import { renderItemList, showResultModal, hideResultModal, renderHistory, renderSavedConfigs, announceResult } from './ui.js';
import { saveConfig, loadConfigs, deleteConfig, addHistoryEntry, loadHistory, clearHistory } from './storage.js';

// State
let items = ['Sushi Palace', 'Taco Town', 'Pizza Planet'];

// DOM
const canvas = document.getElementById('wheel-canvas');
const itemInput = document.getElementById('item-input');
const addBtn = document.getElementById('add-btn');
const spinBtn = document.getElementById('spin-btn');
const itemList = document.getElementById('item-list');
const soundToggle = document.getElementById('sound-toggle');
const saveBtn = document.getElementById('save-btn');
const savedConfigsEl = document.getElementById('saved-configs');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const resultModal = document.getElementById('result-modal');
const modalClose = document.getElementById('modal-close');
const announcer = document.getElementById('announcer');

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

// Init
wheel.setItems(items);
updateUI();

// Add item
function addItem(name) {
  const trimmed = name.trim();
  if (!trimmed || items.length >= 20) return;
  items.push(trimmed);
  wheel.setItems(items);
  updateUI();
  itemInput.value = '';
  itemInput.focus();
}

addBtn.addEventListener('click', () => addItem(itemInput.value));
itemInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addItem(itemInput.value);
});

// Remove item
function removeItem(index) {
  items.splice(index, 1);
  wheel.setItems(items);
  updateUI();
}

// Spin
spinBtn.addEventListener('click', () => {
  if (wheel.isSpinning() || items.length < 2) return;
  spinBtn.disabled = true;
  wheel.spin();
});

// Sound
soundToggle.addEventListener('change', () => {
  audio.setEnabled(soundToggle.checked);
});

// Modal
modalClose.addEventListener('click', () => hideResultModal(resultModal));
resultModal.addEventListener('click', (e) => {
  if (e.target === resultModal) hideResultModal(resultModal);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !resultModal.hidden) hideResultModal(resultModal);
});

// Save config
saveBtn.addEventListener('click', () => {
  if (items.length === 0) return;
  const name = prompt('Name this wheel:');
  if (!name?.trim()) return;
  saveConfig(name.trim(), [...items]);
  refreshSavedConfigs();
});

// Load config
function onLoadConfig(config) {
  items = [...config.items];
  wheel.setItems(items);
  updateUI();
}

// Delete config
function onDeleteConfig(name) {
  deleteConfig(name);
  refreshSavedConfigs();
}

// Clear history
clearHistoryBtn.addEventListener('click', () => {
  clearHistory();
  renderHistory(historyList, []);
});

// Confetti
function fireConfetti() {
  if (typeof confetti !== 'function') return;
  const defaults = { startVelocity: 30, spread: 70, ticks: 60, zIndex: 200 };
  confetti({ ...defaults, particleCount: 60, origin: { x: 0.25, y: 0.6 } });
  confetti({ ...defaults, particleCount: 60, origin: { x: 0.75, y: 0.6 } });
}

// UI update helpers
function updateUI() {
  renderItemList(itemList, items, removeItem);
  spinBtn.disabled = items.length < 2;
  refreshSavedConfigs();
  renderHistory(historyList, loadHistory());
}

function refreshSavedConfigs() {
  renderSavedConfigs(savedConfigsEl, loadConfigs(), onLoadConfig, onDeleteConfig);
}
