import { CONFIG } from '../config.js';

const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const FOOD_EMOJIS = [
  '\u{1F355}','\u{1F32E}','\u{1F363}','\u{1F354}','\u{1F35C}',
  '\u{1F957}','\u{1F32F}','\u{1F371}','\u{1F958}','\u{1F35D}',
  '\u{1F35B}','\u{1F959}','\u{1F357}','\u{1F961}','\u{1F9C6}',
  '\u{1F96A}','\u{1F372}','\u{1FAD4}','\u{1F953}','\u{1F356}'
];

// --- State ---
const state = {
  playerId: getOrCreatePlayerId(),
  playerName: sessionStorage.getItem('tournament_name') || '',
  tournamentId: null,
  roomCode: null,
  tournament: null,
  players: [],
  votes: [],
  myVote: null,
  isHost: false,
  view: 'home',
  channel: null,
  emojiMap: {},
  swapSelection: null, // { round, matchup, slot } for bracket editing
};

// --- Player ID ---
function getOrCreatePlayerId() {
  let id = sessionStorage.getItem('tournament_pid');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('tournament_pid', id);
  }
  return id;
}

// --- Room code ---
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

// --- Emoji mapping ---
function assignEmojis(items) {
  const shuffled = [...FOOD_EMOJIS].sort(() => Math.random() - 0.5);
  const map = {};
  items.forEach((item, i) => {
    map[item] = shuffled[i % shuffled.length];
  });
  return map;
}

// --- Bracket generation ---
// Build bracket from an ordered list (no shuffle). Core reusable logic.
function buildBracket(orderedItems) {
  if (orderedItems.length < 2) return [];

  const exp = Math.ceil(Math.log2(orderedItems.length));
  const size = Math.pow(2, exp);

  const slots = [...orderedItems];
  while (slots.length < size) slots.push(null);

  // Fold pairing: [0 vs size-1], [1 vs size-2], ... avoids null-vs-null
  const firstRound = [];
  for (let i = 0; i < size / 2; i++) {
    const a = slots[i];
    const b = slots[size - 1 - i];
    const isBye = !a || !b;
    firstRound.push({ a, b, winner: isBye ? (a || b) : null });
  }

  const rounds = [firstRound];
  let count = firstRound.length;
  for (let r = 1; r < exp; r++) {
    count /= 2;
    rounds.push(
      Array.from({ length: count }, () => ({ a: null, b: null, winner: null }))
    );
  }

  propagateByes(rounds);
  return rounds;
}

function propagateByes(rounds) {
  for (let r = 0; r < rounds.length - 1; r++) {
    for (let m = 0; m < rounds[r].length; m++) {
      if (rounds[r][m].winner) {
        const nextM = Math.floor(m / 2);
        const slot = m % 2 === 0 ? 'a' : 'b';
        rounds[r + 1][nextM][slot] = rounds[r][m].winner;
      }
    }
  }
}

// Build bracket with random shuffle
function generateBracket(items) {
  return buildBracket([...items].sort(() => Math.random() - 0.5));
}

// Extract ordered items from a bracket's first round
function extractItemsFromBracket(bracket) {
  if (!bracket?.[0]) return [];
  const items = [];
  for (const mu of bracket[0]) {
    if (mu.a) items.push(mu.a);
    if (mu.b) items.push(mu.b);
  }
  return items;
}

// --- Find next votable matchup ---
function findNextMatchup(bracket, startRound, startMatchup) {
  for (let r = startRound; r < bracket.length; r++) {
    const mStart = r === startRound ? startMatchup : 0;
    for (let m = mStart; m < bracket[r].length; m++) {
      const mu = bracket[r][m];
      if (mu.a && mu.b && !mu.winner) return { round: r, matchup: m };
    }
  }
  return null;
}

function getRoundName(roundIdx, totalRounds) {
  const remaining = totalRounds - roundIdx;
  if (remaining === 1) return 'Final';
  if (remaining === 2) return 'Semifinal';
  if (remaining === 3) return 'Quarterfinal';
  return `Round ${roundIdx + 1}`;
}

// --- Supabase actions ---
function sbError(error, fallback) {
  return error?.message || error?.details || error?.hint || fallback;
}

async function createTournament(items, playerName) {
  const roomCode = generateRoomCode();
  const bracket = generateBracket(items);
  const first = findNextMatchup(bracket, 0, 0);

  const { data, error } = await supabase
    .from('tournaments')
    .insert({
      room_code: roomCode,
      items,
      bracket,
      current_round: first ? first.round : 0,
      current_matchup: first ? first.matchup : 0,
      status: 'lobby',
      host_id: state.playerId,
    })
    .select()
    .single();

  if (error) throw new Error(sbError(error, 'Failed to create tournament'));

  state.tournament = data;
  state.tournamentId = data.id;
  state.roomCode = roomCode;
  state.isHost = true;
  state.playerName = playerName;
  state.emojiMap = assignEmojis(items);
  state.view = 'lobby';

  sessionStorage.setItem('tournament_name', playerName);
  history.replaceState(null, '', `?room=${roomCode}`);

  await joinAsPlayer(data.id, playerName);
  await loadPlayers(data.id);
  subscribeToTournament(data.id);
  render();
}

async function joinTournament(roomCode, playerName) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('room_code', roomCode.toUpperCase())
    .single();

  if (error) throw new Error(sbError(error, 'Room not found'));
  if (!data) throw new Error('Room not found');
  if (data.status === 'finished') throw new Error('Tournament already finished');

  state.tournament = data;
  state.tournamentId = data.id;
  state.roomCode = data.room_code;
  state.isHost = data.host_id === state.playerId;
  state.playerName = playerName;
  state.emojiMap = assignEmojis(data.items);
  state.view = data.status === 'lobby' ? 'lobby' : 'voting';

  sessionStorage.setItem('tournament_name', playerName);
  history.replaceState(null, '', `?room=${roomCode.toUpperCase()}`);

  await joinAsPlayer(data.id, playerName);
  await loadPlayers(data.id);
  await loadVotes(data.id);
  checkMyVote();
  subscribeToTournament(data.id);
  render();
}

async function joinAsPlayer(tournamentId, name) {
  const { error } = await supabase
    .from('tournament_players')
    .upsert(
      { tournament_id: tournamentId, player_id: state.playerId, name },
      { onConflict: 'tournament_id,player_id' }
    );
  if (error) console.error('Failed to register player:', error);
}

async function loadPlayers(tournamentId) {
  const { data } = await supabase
    .from('tournament_players')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('joined_at');
  state.players = data || [];
}

async function loadVotes(tournamentId) {
  const { data } = await supabase
    .from('tournament_votes')
    .select('*')
    .eq('tournament_id', tournamentId);
  state.votes = data || [];
}

function checkMyVote() {
  if (!state.tournament) return;
  const { current_round: r, current_matchup: m } = state.tournament;
  const mine = state.votes.find(
    v => v.round === r && v.matchup === m && v.player_id === state.playerId
  );
  state.myVote = mine ? mine.choice : null;
}

async function castVote(choice) {
  if (state.myVote) return;
  const { current_round: r, current_matchup: m } = state.tournament;

  const { error } = await supabase.from('tournament_votes').insert({
    tournament_id: state.tournamentId,
    round: r,
    matchup: m,
    player_id: state.playerId,
    choice,
  });

  if (error) {
    console.error('Vote error:', error);
    return;
  }

  state.myVote = choice;
  render();
}

async function startTournament() {
  if (!state.isHost) return;
  await supabase
    .from('tournaments')
    .update({ status: 'voting' })
    .eq('id', state.tournamentId);
}

// --- Bracket editing (lobby only) ---
async function updateBracket(items, bracket) {
  const first = findNextMatchup(bracket, 0, 0);
  state.emojiMap = assignEmojis(items);
  await supabase.from('tournaments').update({
    items,
    bracket,
    current_round: first ? first.round : 0,
    current_matchup: first ? first.matchup : 0,
  }).eq('id', state.tournamentId);
}

async function addTournamentItem(name) {
  if (!state.isHost || !state.tournament) return;
  const items = [...state.tournament.items, name];
  await updateBracket(items, buildBracket(items));
}

async function removeTournamentItem(name) {
  if (!state.isHost || !state.tournament) return;
  const items = state.tournament.items.filter(i => i !== name);
  if (items.length < 2) return;
  await updateBracket(items, buildBracket(items));
}

async function reshuffleBracket() {
  if (!state.isHost || !state.tournament) return;
  const items = state.tournament.items;
  await updateBracket(items, generateBracket(items));
}

function handleSwapTap(round, matchup, slot) {
  const bracket = state.tournament.bracket;
  const item = bracket?.[round]?.[matchup]?.[slot];
  if (!item) return; // can't swap nulls/byes

  if (!state.swapSelection) {
    state.swapSelection = { round, matchup, slot };
    render();
    return;
  }

  const sel = state.swapSelection;
  if (sel.round === round && sel.matchup === matchup && sel.slot === slot) {
    state.swapSelection = null;
    render();
    return;
  }

  // Perform swap
  const newBracket = JSON.parse(JSON.stringify(bracket));
  const itemA = newBracket[sel.round][sel.matchup][sel.slot];
  const itemB = newBracket[round][matchup][slot];
  newBracket[sel.round][sel.matchup][sel.slot] = itemB;
  newBracket[round][matchup][slot] = itemA;

  // Recalculate byes in first round
  for (const mu of newBracket[0]) {
    if (!mu.a || !mu.b) {
      mu.winner = mu.a || mu.b || null;
    } else {
      mu.winner = null;
    }
  }

  // Clear and re-propagate later rounds
  for (let r = 1; r < newBracket.length; r++) {
    for (const mu of newBracket[r]) {
      mu.a = null; mu.b = null; mu.winner = null;
    }
  }
  propagateByes(newBracket);

  state.swapSelection = null;
  const items = extractItemsFromBracket(newBracket);
  updateBracket(items, newBracket);
}

async function advanceMatchup() {
  if (!state.isHost) return;

  const bracket = JSON.parse(JSON.stringify(state.tournament.bracket));
  const r = state.tournament.current_round;
  const m = state.tournament.current_matchup;
  const matchup = bracket[r][m];

  // Tally votes
  const currentVotes = state.votes.filter(v => v.round === r && v.matchup === m);
  const votesA = currentVotes.filter(v => v.choice === matchup.a).length;
  const votesB = currentVotes.filter(v => v.choice === matchup.b).length;

  let winner;
  if (votesA > votesB) winner = matchup.a;
  else if (votesB > votesA) winner = matchup.b;
  else winner = Math.random() < 0.5 ? matchup.a : matchup.b;

  bracket[r][m].winner = winner;

  // Propagate to next round
  if (r + 1 < bracket.length) {
    const nextM = Math.floor(m / 2);
    const slot = m % 2 === 0 ? 'a' : 'b';
    bracket[r + 1][nextM][slot] = winner;
  }

  const next = findNextMatchup(bracket, r, m + 1);

  await supabase
    .from('tournaments')
    .update({
      bracket,
      current_round: next ? next.round : r,
      current_matchup: next ? next.matchup : m,
      status: next ? 'voting' : 'finished',
      winner: next ? null : winner,
    })
    .eq('id', state.tournamentId);
}

// --- Realtime ---
function subscribeToTournament(tournamentId) {
  if (state.channel) state.channel.unsubscribe();

  state.channel = supabase
    .channel(`room:${tournamentId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tournamentId}` },
      (payload) => {
        const oldRound = state.tournament?.current_round;
        const oldMatchup = state.tournament?.current_matchup;
        const oldStatus = state.tournament?.status;
        state.tournament = payload.new;

        if (oldRound !== payload.new.current_round || oldMatchup !== payload.new.current_matchup) {
          state.myVote = null;
          checkMyVote();
        }

        if (payload.new.status === 'voting' && oldStatus === 'lobby') {
          state.view = 'voting';
        } else if (payload.new.status === 'finished') {
          state.view = 'finished';
        }

        render();
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'tournament_votes', filter: `tournament_id=eq.${tournamentId}` },
      (payload) => {
        if (!state.votes.find(v => v.id === payload.new.id)) {
          state.votes.push(payload.new);
        }
        render();
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'tournament_players', filter: `tournament_id=eq.${tournamentId}` },
      (payload) => {
        if (!state.players.find(p => p.id === payload.new.id)) {
          state.players.push(payload.new);
        }
        render();
      }
    )
    .subscribe();
}

// --- Rendering ---
function render() {
  const app = document.getElementById('app');
  switch (state.view) {
    case 'home':
      renderHome(app);
      break;
    case 'lobby':
      renderLobby(app);
      break;
    case 'voting':
      renderVoting(app);
      break;
    case 'finished':
      renderFinished(app);
      break;
  }
}

function renderHome(app) {
  const items = JSON.parse(sessionStorage.getItem('tournament_items') || '[]');
  const urlRoom = new URLSearchParams(window.location.search).get('room') || '';

  app.innerHTML = `
    <div class="t-home">
      <div class="t-hero">
        <h2>Food Tournament</h2>
        <p>Create a bracket. Vote head-to-head. Crown the winner.</p>
      </div>

      <div class="t-home-actions">
        <div class="t-card">
          <h3>Create Tournament</h3>
          <input type="text" id="host-name" placeholder="Your name" maxlength="20"
                 value="${esc(state.playerName)}">
          ${items.length >= 2
            ? `<p class="t-item-count">${items.length} places from your wheel</p>`
            : '<p class="t-item-count t-warning">Add at least 2 places to the wheel first</p>'}
          <button id="create-btn" class="t-btn t-btn-primary" ${items.length < 2 ? 'disabled' : ''}>
            Create Room
          </button>
        </div>

        <div class="t-divider"><span>or</span></div>

        <div class="t-card">
          <h3>Join Tournament</h3>
          <input type="text" id="join-name" placeholder="Your name" maxlength="20"
                 value="${esc(state.playerName)}">
          <input type="text" id="join-code" placeholder="Room code" maxlength="4"
                 class="t-code-input" value="${esc(urlRoom)}">
          <button id="join-btn" class="t-btn t-btn-secondary">Join Room</button>
        </div>
      </div>

      <a href="index.html" class="t-back-link">\u2190 Back to wheel</a>
      <p id="t-error" class="t-error" hidden></p>
    </div>
  `;

  listen('create-btn', 'click', async () => {
    const name = val('host-name');
    if (!name) return showError('Enter your name');
    const btn = document.getElementById('create-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';
    try {
      await createTournament(items, name);
    } catch (e) {
      showError(e.message);
      btn.disabled = false;
      btn.textContent = 'Create Room';
    }
  });

  listen('join-btn', 'click', async () => {
    const name = val('join-name');
    const code = val('join-code');
    if (!name) return showError('Enter your name');
    if (!code || code.length < 4) return showError('Enter a 4-letter room code');
    const btn = document.getElementById('join-btn');
    btn.disabled = true;
    btn.textContent = 'Joining...';
    try {
      await joinTournament(code, name);
    } catch (e) {
      showError(e.message);
      btn.disabled = false;
      btn.textContent = 'Join Room';
    }
  });

  const codeInput = document.getElementById('join-code');
  if (codeInput) {
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase();
    });
  }
}

function renderLobby(app) {
  const bracket = state.tournament.bracket;
  const isHost = state.isHost;
  const sel = state.swapSelection;

  // Build matchup rows from first round (skip byes for display, but show bye items)
  let matchupsHtml = '';
  if (bracket?.[0]) {
    for (let m = 0; m < bracket[0].length; m++) {
      const mu = bracket[0][m];
      const isBye = !mu.a || !mu.b;

      if (isBye) {
        const byeItem = mu.a || mu.b;
        if (!byeItem) continue;
        matchupsHtml += `
          <div class="t-edit-matchup t-edit-bye">
            <span class="t-edit-item ${isHost ? 't-edit-tappable' : ''} ${sel && sel.round === 0 && sel.matchup === m && sel.slot === 'a' ? 't-edit-selected' : ''}"
                  data-r="0" data-m="${m}" data-s="a">
              ${state.emojiMap[byeItem] || '\u{1F37D}'} ${esc(byeItem)}
            </span>
            <span class="t-edit-bye-label">bye</span>
            ${isHost ? `<button class="t-edit-remove" data-name="${esc(byeItem)}">\u00D7</button>` : ''}
          </div>`;
      } else {
        matchupsHtml += `
          <div class="t-edit-matchup">
            <span class="t-edit-item ${isHost ? 't-edit-tappable' : ''} ${sel && sel.round === 0 && sel.matchup === m && sel.slot === 'a' ? 't-edit-selected' : ''}"
                  data-r="0" data-m="${m}" data-s="a">
              ${state.emojiMap[mu.a] || '\u{1F37D}'} ${esc(mu.a)}
            </span>
            <span class="t-edit-vs">vs</span>
            <span class="t-edit-item ${isHost ? 't-edit-tappable' : ''} ${sel && sel.round === 0 && sel.matchup === m && sel.slot === 'b' ? 't-edit-selected' : ''}"
                  data-r="0" data-m="${m}" data-s="b">
              ${state.emojiMap[mu.b] || '\u{1F37D}'} ${esc(mu.b)}
            </span>
            ${isHost ? `
              <button class="t-edit-remove" data-name="${esc(mu.a)}">\u00D7</button>
              <button class="t-edit-remove" data-name="${esc(mu.b)}">\u00D7</button>
            ` : ''}
          </div>`;
      }
    }
  }

  app.innerHTML = `
    <div class="t-lobby">
      <div class="t-room-code-display">
        <span class="t-label">Room Code</span>
        <span class="t-code">${state.roomCode}</span>
        <button id="copy-code" class="t-btn-small">Copy</button>
      </div>

      <div class="t-card" style="width:100%">
        <h3>Players (${state.players.length})</h3>
        <ul class="t-player-list">
          ${state.players
            .map(
              p => `
            <li>
              ${esc(p.name)}
              ${p.player_id === state.tournament.host_id ? '<span class="t-host-badge">Host</span>' : ''}
            </li>`
            )
            .join('')}
        </ul>
      </div>

      <div class="t-card" style="width:100%">
        <h3>Bracket (${state.tournament.items.length} places)</h3>
        ${sel ? '<p class="t-swap-hint">Tap another item to swap</p>' : ''}
        <div class="t-bracket-editor">
          ${matchupsHtml}
        </div>
        ${isHost ? `
          <div class="t-edit-actions">
            <div class="t-edit-add">
              <input type="text" id="add-item-input" placeholder="Add a place..." maxlength="40">
              <button id="add-item-btn" class="t-btn-small">+ Add</button>
            </div>
            <div class="t-edit-buttons">
              <button id="reshuffle-btn" class="t-btn-small">Reshuffle</button>
            </div>
          </div>
          ${isHost && sel ? '<p class="t-hint">Tap two items to swap their matchups</p>' : ''}
        ` : ''}
      </div>

      ${
        isHost
          ? `<button id="start-btn" class="t-btn t-btn-primary t-btn-large" ${state.tournament.items.length < 2 ? 'disabled' : ''}>Start Tournament</button>`
          : '<p class="t-waiting">Waiting for host to start...</p>'
      }

      <p class="t-hint">Share the room code with your team!</p>
      <p id="t-error" class="t-error" hidden></p>
    </div>
  `;

  // --- Event listeners ---
  listen('copy-code', 'click', () => {
    navigator.clipboard?.writeText(state.roomCode);
    const btn = document.getElementById('copy-code');
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  });

  listen('start-btn', 'click', startTournament);

  // Swap taps (host only)
  if (isHost) {
    document.querySelectorAll('.t-edit-item.t-edit-tappable').forEach(el => {
      el.addEventListener('click', () => {
        handleSwapTap(
          parseInt(el.dataset.r),
          parseInt(el.dataset.m),
          el.dataset.s
        );
      });
    });

    // Remove buttons
    document.querySelectorAll('.t-edit-remove').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTournamentItem(el.dataset.name);
      });
    });

    // Add item
    listen('add-item-btn', 'click', () => {
      const name = val('add-item-input');
      if (!name) return;
      if (state.tournament.items.includes(name)) return showError('Already in the bracket');
      if (state.tournament.items.length >= 20) return showError('Max 20 items');
      addTournamentItem(name);
    });
    document.getElementById('add-item-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('add-item-btn')?.click();
    });

    listen('reshuffle-btn', 'click', reshuffleBracket);
  }
}

function renderVoting(app) {
  const bracket = state.tournament.bracket;
  const r = state.tournament.current_round;
  const m = state.tournament.current_matchup;
  const matchup = bracket?.[r]?.[m];
  if (!matchup || !matchup.a || !matchup.b) {
    app.innerHTML = '<div class="t-home"><p class="t-error">Waiting for next matchup...</p></div>';
    return;
  }

  const roundName = getRoundName(r, bracket.length);
  const currentVotes = state.votes.filter(v => v.round === r && v.matchup === m);
  const votesA = currentVotes.filter(v => v.choice === matchup.a).length;
  const votesB = currentVotes.filter(v => v.choice === matchup.b).length;
  const total = votesA + votesB;
  const hasVoted = !!state.myVote;

  app.innerHTML = `
    <div class="t-voting">
      <div class="t-round-info">
        <span class="t-round-name">${roundName}</span>
        <span class="t-room-badge">${state.roomCode}</span>
      </div>

      <p class="t-prompt">${hasVoted ? 'Waiting for others...' : 'Pick your favorite!'}</p>

      <div class="t-matchup" id="matchup-container">
        <button class="t-choice-card ${state.myVote === matchup.a ? 't-voted' : ''} ${hasVoted && state.myVote !== matchup.a ? 't-not-picked' : ''}"
                id="vote-a" ${hasVoted ? 'disabled' : ''}>
          <span class="t-choice-emoji">${state.emojiMap[matchup.a] || '\u{1F37D}'}</span>
          <span class="t-choice-name">${esc(matchup.a)}</span>
          ${hasVoted ? `<span class="t-vote-count">${votesA} vote${votesA !== 1 ? 's' : ''}</span>` : ''}
          ${hasVoted ? `<div class="t-vote-bar" style="width:${total ? (votesA / total) * 100 : 0}%"></div>` : ''}
        </button>

        <div class="t-vs">VS</div>

        <button class="t-choice-card ${state.myVote === matchup.b ? 't-voted' : ''} ${hasVoted && state.myVote !== matchup.b ? 't-not-picked' : ''}"
                id="vote-b" ${hasVoted ? 'disabled' : ''}>
          <span class="t-choice-emoji">${state.emojiMap[matchup.b] || '\u{1F37D}'}</span>
          <span class="t-choice-name">${esc(matchup.b)}</span>
          ${hasVoted ? `<span class="t-vote-count">${votesB} vote${votesB !== 1 ? 's' : ''}</span>` : ''}
          ${hasVoted ? `<div class="t-vote-bar" style="width:${total ? (votesB / total) * 100 : 0}%"></div>` : ''}
        </button>
      </div>

      <div class="t-vote-status">
        <span>${total} of ${state.players.length} voted</span>
      </div>

      ${
        state.isHost
          ? `<button id="advance-btn" class="t-btn t-btn-primary" ${total === 0 ? 'disabled' : ''}>Next Match \u2192</button>`
          : ''
      }

      ${renderMiniBracket(bracket, r, m)}

      <p class="t-swipe-hint">Tap a card or swipe to vote</p>
    </div>
  `;

  if (!hasVoted) {
    listen('vote-a', 'click', () => castVote(matchup.a));
    listen('vote-b', 'click', () => castVote(matchup.b));
    setupSwipe(document.getElementById('matchup-container'), matchup.a, matchup.b);
  }

  listen('advance-btn', 'click', advanceMatchup);
}

function renderFinished(app) {
  const winner = state.tournament.winner;
  const bracket = state.tournament.bracket;

  app.innerHTML = `
    <div class="t-finished">
      <div class="t-winner-display">
        <span class="t-winner-emoji">${state.emojiMap[winner] || '\u{1F37D}'}</span>
        <h2 class="t-winner-name">${esc(winner)}</h2>
        <p class="t-winner-label">wins the tournament!</p>
      </div>

      ${renderMiniBracket(bracket, -1, -1)}

      <div class="t-finished-actions">
        <a href="index.html" class="t-btn t-btn-secondary">Back to Wheel</a>
        <button id="new-tournament" class="t-btn t-btn-primary">New Tournament</button>
      </div>
    </div>
  `;

  listen('new-tournament', 'click', () => {
    state.view = 'home';
    state.tournament = null;
    state.tournamentId = null;
    state.votes = [];
    state.players = [];
    state.myVote = null;
    if (state.channel) state.channel.unsubscribe();
    history.replaceState(null, '', 'tournament.html');
    render();
  });

  fireConfetti();
}

function renderMiniBracket(bracket, currentRound, currentMatchup) {
  let html = '<div class="t-mini-bracket">';
  for (let r = 0; r < bracket.length; r++) {
    html += '<div class="t-mini-round">';
    html += `<div class="t-mini-round-label">${getRoundName(r, bracket.length)}</div>`;
    for (let m = 0; m < bracket[r].length; m++) {
      const mu = bracket[r][m];
      const isBye = (!mu.a || !mu.b) && mu.winner;
      if (isBye) continue;
      const isCurrent = r === currentRound && m === currentMatchup;
      html += `<div class="t-mini-matchup ${isCurrent ? 't-current' : ''} ${mu.winner ? 't-resolved' : ''}">`;
      html += `<span class="${mu.winner === mu.a ? 't-mini-winner' : ''}">${mu.a ? esc(mu.a).substring(0, 14) : '?'}</span>`;
      html += '<span class="t-mini-vs">v</span>';
      html += `<span class="${mu.winner === mu.b ? 't-mini-winner' : ''}">${mu.b ? esc(mu.b).substring(0, 14) : '?'}</span>`;
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// --- Swipe handling ---
function setupSwipe(container, optionA, optionB) {
  if (!container) return;
  let startX = 0;
  let isDragging = false;
  const cardA = document.getElementById('vote-a');
  const cardB = document.getElementById('vote-b');

  container.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    isDragging = true;
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    if (!isDragging) return;
    const diffX = e.touches[0].clientX - startX;
    const clamped = Math.max(-80, Math.min(80, diffX));

    if (clamped < -15 && cardA) {
      cardA.style.transform = `scale(1.04)`;
      cardA.style.borderColor = 'var(--accent)';
      if (cardB) {
        cardB.style.transform = '';
        cardB.style.borderColor = '';
      }
    } else if (clamped > 15 && cardB) {
      cardB.style.transform = `scale(1.04)`;
      cardB.style.borderColor = 'var(--accent)';
      if (cardA) {
        cardA.style.transform = '';
        cardA.style.borderColor = '';
      }
    } else {
      if (cardA) { cardA.style.transform = ''; cardA.style.borderColor = ''; }
      if (cardB) { cardB.style.transform = ''; cardB.style.borderColor = ''; }
    }
  }, { passive: true });

  container.addEventListener('touchend', e => {
    if (!isDragging) return;
    isDragging = false;

    // Reset styles
    if (cardA) { cardA.style.transform = ''; cardA.style.borderColor = ''; }
    if (cardB) { cardB.style.transform = ''; cardB.style.borderColor = ''; }

    const diffX = e.changedTouches[0].clientX - startX;
    if (Math.abs(diffX) > 60) {
      castVote(diffX < 0 ? optionA : optionB);
    }
  }, { passive: true });
}

// --- Confetti ---
function fireConfetti() {
  if (typeof confetti !== 'function') return;
  const d = { startVelocity: 30, spread: 70, ticks: 60, zIndex: 200 };
  confetti({ ...d, particleCount: 80, origin: { x: 0.25, y: 0.6 } });
  confetti({ ...d, particleCount: 80, origin: { x: 0.75, y: 0.6 } });
}

// --- Utility ---
function esc(text) {
  const d = document.createElement('div');
  d.textContent = text || '';
  return d.innerHTML;
}

function listen(id, event, handler) {
  document.getElementById(id)?.addEventListener(event, handler);
}

function val(id) {
  return document.getElementById(id)?.value.trim() || '';
}

function showError(msg) {
  const el = document.getElementById('t-error');
  if (el) {
    el.textContent = msg;
    el.hidden = false;
    setTimeout(() => (el.hidden = true), 6000);
  }
  console.error('Tournament error:', msg);
}

// --- Init ---
async function init() {
  // Quick Supabase health check
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    document.getElementById('app').innerHTML =
      '<div class="t-home"><p class="t-error">Supabase not configured. Check environment variables.</p></div>';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room');

  if (roomCode && state.playerName) {
    try {
      await joinTournament(roomCode, state.playerName);
      return;
    } catch (e) {
      console.error('Rejoin failed:', e);
      // Fall through to home view — show the error there
      render();
      showError(e.message);
      return;
    }
  }

  render();
}

init();
