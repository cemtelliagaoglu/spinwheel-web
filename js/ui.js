const COLORS = [
  '#E63946', '#F4A261', '#E9C46A', '#6A994E', '#D65108',
  '#9B2226', '#F28482', '#F7B801', '#588157', '#BC4749'
];

export function renderItemList(container, items, onRemove) {
  container.innerHTML = '';
  if (items.length === 0) {
    container.innerHTML = '<li class="empty-msg">No places added yet</li>';
    return;
  }
  items.forEach((item, i) => {
    const li = document.createElement('li');
    const removeBtn = onRemove
      ? `<button type="button" aria-label="Remove ${escapeHtml(item)}">&times;</button>`
      : '';
    li.innerHTML = `
      <span class="color-dot" style="background:${COLORS[i % COLORS.length]}"></span>
      <span class="item-name">${escapeHtml(item)}</span>
      ${removeBtn}
    `;
    if (onRemove) {
      li.querySelector('button').addEventListener('click', () => onRemove(i));
    }
    container.appendChild(li);
  });
}

export function showResultModal(modal, result) {
  modal.querySelector('.modal-result').textContent = result;
  modal.hidden = false;
  modal.querySelector('.modal-close').focus();
}

export function hideResultModal(modal) {
  modal.hidden = true;
}

export function renderHistory(container, history) {
  container.innerHTML = '';
  if (history.length === 0) {
    container.innerHTML = '<li class="empty-msg">No spins yet</li>';
    return;
  }
  history.forEach(entry => {
    const li = document.createElement('li');
    const time = new Date(entry.time);
    const h = String(time.getHours()).padStart(2, '0');
    const m = String(time.getMinutes()).padStart(2, '0');
    li.innerHTML = `${h}:${m} &mdash; <strong>${escapeHtml(entry.result)}</strong>`;
    container.appendChild(li);
  });
}

export function renderSavedConfigs(container, configs, onLoad, onDelete) {
  container.innerHTML = '';
  configs.forEach(config => {
    const chip = document.createElement('span');
    chip.className = 'config-chip';

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.textContent = config.name;
    nameBtn.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;font:inherit;padding:0;';
    nameBtn.addEventListener('click', () => onLoad(config));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delete-config';
    delBtn.innerHTML = '&times;';
    delBtn.setAttribute('aria-label', `Delete ${config.name}`);
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete(config.name);
    });

    chip.appendChild(nameBtn);
    chip.appendChild(delBtn);
    container.appendChild(chip);
  });
}

export function announceResult(announcer, result) {
  announcer.textContent = `Result: ${result}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
