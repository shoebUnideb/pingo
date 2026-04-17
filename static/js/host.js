const OPTION_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71'];
const OPTION_LABELS = ['A', 'B', 'C', 'D'];

const socket = io();

let playerCount = 0;
let currentAnswerCounts = [0, 0, 0, 0];
let currentTotal = 0;
let currentOptions = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const lobbyScreen         = document.getElementById('lobby-screen');
const questionScreen      = document.getElementById('question-screen');
const feedbackPhaseScreen = document.getElementById('feedback-phase-screen');
const gameoverScreen      = document.getElementById('gameover-screen');
const playerCountEl       = document.getElementById('player-count');
const startBtn            = document.getElementById('start-btn');
const nextBtn             = document.getElementById('next-btn');
const resetBtn            = document.getElementById('reset-btn');
const endGameBtn          = document.getElementById('end-game-btn');
const qCounter            = document.getElementById('q-counter');
const answeredBadge       = document.getElementById('answered-badge');
const pendingBadge        = document.getElementById('pending-badge');
const questionText        = document.getElementById('question-text');
const chartGrid           = document.getElementById('chart-grid');
const playerUrlEl         = document.getElementById('player-url');
const responseFeed        = document.getElementById('response-feed');
const feedEmpty           = document.getElementById('feed-empty');
const feedCount           = document.getElementById('feed-count');
const summaryWrap             = document.getElementById('summary-table-wrap');
const fbSubmittedCount        = document.getElementById('fb-submitted-count');
const fbTotalPlayers          = document.getElementById('fb-total-players');
const feedbackSummaryWrap     = document.getElementById('feedback-summary-wrap');
const feedbackList            = document.getElementById('feedback-list');
const identityToggle          = document.getElementById('identity-toggle');
const summaryIdentityToggle   = document.getElementById('summary-identity-toggle');

let namesVisible = false;
let summaryNamesVisible = false;

identityToggle.addEventListener('click', () => {
  namesVisible = !namesVisible;
  if (namesVisible) {
    responseFeed.classList.remove('names-hidden');
    identityToggle.classList.replace('off', 'on');
    identityToggle.querySelector('.toggle-label').textContent = 'Names visible';
  } else {
    responseFeed.classList.add('names-hidden');
    identityToggle.classList.replace('on', 'off');
    identityToggle.querySelector('.toggle-label').textContent = 'Names hidden';
  }
});

summaryIdentityToggle.addEventListener('click', () => {
  summaryNamesVisible = !summaryNamesVisible;
  if (summaryNamesVisible) {
    summaryWrap.classList.remove('names-hidden');
    summaryIdentityToggle.classList.replace('off', 'on');
    summaryIdentityToggle.querySelector('.toggle-label').textContent = 'Names visible';
  } else {
    summaryWrap.classList.add('names-hidden');
    summaryIdentityToggle.classList.replace('on', 'off');
    summaryIdentityToggle.querySelector('.toggle-label').textContent = 'Names hidden';
  }
});

// Show player URL
playerUrlEl.textContent = window.location.origin + '/player';

// ── Socket events ─────────────────────────────────────────────────────────────
socket.emit('join_as_host');

socket.on('host_ack', (data) => {
  playerCount = data.player_count;
  playerCountEl.textContent = playerCount;
  startBtn.disabled = playerCount === 0;
  if (data.game_code) {
    document.getElementById('game-code-value').textContent = data.game_code;
  }
});

socket.on('player_joined', (data) => {
  playerCount = data.count;
  playerCountEl.textContent = playerCount;
  startBtn.disabled = playerCount === 0;
});

socket.on('question_data', (data) => {
  showQuestion(data);
});

socket.on('answer_update', (data) => {
  currentAnswerCounts = data.counts;
  currentTotal = data.total;
  updateChart();

  const pc = data.player_count || playerCount;
  answeredBadge.textContent = `${currentTotal} answered`;
  pendingBadge.textContent  = `${Math.max(0, pc - currentTotal)} pending`;

  // Append the latest response to the feed
  if (data.latest) {
    appendResponse(data.latest.name, data.latest.answer_index);
  }
});

socket.on('feedback_phase', (data) => {
  fbSubmittedCount.textContent = '0';
  fbTotalPlayers.textContent = data.player_count || playerCount;
  showScreen(feedbackPhaseScreen);
});

socket.on('feedback_update', (data) => {
  fbSubmittedCount.textContent = data.count;
  fbTotalPlayers.textContent = data.player_count || playerCount;
});

socket.on('game_over', (data) => {
  renderSummary(data.stats || []);
  renderFeedback(data.feedback || []);
  showScreen(gameoverScreen);
});

socket.on('game_reset', () => {
  showScreen(lobbyScreen);
  startBtn.disabled = playerCount === 0;
});

// ── Button handlers ───────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  socket.emit('start_game');
  startBtn.disabled = true;
});

nextBtn.addEventListener('click', () => {
  socket.emit('next_question');
});

endGameBtn.addEventListener('click', () => {
  socket.emit('end_game');
});

document.getElementById('save-pdf-btn').addEventListener('click', () => {
  // Set print date before opening dialog
  const d = new Date();
  document.getElementById('print-date').textContent =
    'Generated: ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
  window.print();
});

resetBtn.addEventListener('click', () => {
  socket.emit('reset_game');
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function showScreen(el) {
  [lobbyScreen, questionScreen, feedbackPhaseScreen, gameoverScreen].forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

function showQuestion(data) {
  currentOptions = data.options;
  currentAnswerCounts = [0, 0, 0, 0];
  currentTotal = 0;

  questionText.textContent = data.question;
  qCounter.textContent = `Q ${data.index + 1} / ${data.total}`;
  answeredBadge.textContent = `0 answered`;
  pendingBadge.textContent  = `${playerCount} pending`;

  nextBtn.textContent = (data.index + 1 >= data.total) ? 'Finish Quiz' : 'Next Question →';

  buildChart(data.options);
  clearFeed();
  showScreen(questionScreen);
}

function buildChart(options) {
  chartGrid.innerHTML = '';
  options.forEach((optText, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'bar-wrapper';
    wrapper.innerHTML = `
      <div class="bar-label">
        <span class="bar-letter" style="background:${OPTION_COLORS[i]}">${OPTION_LABELS[i]}</span>
        <span class="bar-option-text">${optText}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" id="bar-${i}" style="background:${OPTION_COLORS[i]};width:0%"></div>
        <span class="bar-count" id="count-${i}">0</span>
      </div>
    `;
    chartGrid.appendChild(wrapper);
  });
}

function updateChart() {
  const max = Math.max(...currentAnswerCounts, 1);
  currentAnswerCounts.forEach((count, i) => {
    const pct = Math.round((count / max) * 100);
    const bar = document.getElementById(`bar-${i}`);
    const countEl = document.getElementById(`count-${i}`);
    if (bar) bar.style.width = pct + '%';
    if (countEl) countEl.textContent = count;
  });
}

function clearFeed() {
  responseFeed.querySelectorAll('.response-row').forEach(el => el.remove());
  feedEmpty.classList.remove('hidden');
  feedCount.textContent = '0';
  // Reset identity toggle to OFF (safe for projector) on each new question
  namesVisible = false;
  responseFeed.classList.add('names-hidden');
  identityToggle.classList.add('off');
  identityToggle.classList.remove('on');
  identityToggle.querySelector('.toggle-label').textContent = 'Names hidden';
}

function appendResponse(name, answerIndex) {
  feedEmpty.classList.add('hidden');
  feedCount.textContent = currentTotal;

  const row = document.createElement('div');
  row.className = 'response-row';
  row.innerHTML = `
    <span class="resp-avatar">${name.charAt(0).toUpperCase()}</span>
    <span class="resp-name">${name}</span>
    <span class="resp-badge" style="background:${OPTION_COLORS[answerIndex]}">
      ${OPTION_LABELS[answerIndex]}
    </span>
    <span class="resp-opt-text">${currentOptions[answerIndex] || ''}</span>
  `;

  // Newest answers appear at the top
  responseFeed.insertBefore(row, responseFeed.firstChild);
}

function renderSummary(stats) {
  summaryWrap.innerHTML = '';
  summaryWrap.classList.add('names-hidden'); // start hidden (projector safe)
  summaryNamesVisible = false;
  summaryIdentityToggle.classList.replace('on', 'off');
  summaryIdentityToggle.querySelector('.toggle-label').textContent = 'Names hidden';

  if (!stats.length) {
    summaryWrap.innerHTML = '<p style="color:#aaa">No data recorded.</p>';
    return;
  }

  stats.forEach((s, i) => {
    const total = s.total_players || 1;
    const pct = Math.round((s.attempted / total) * 100);

    const card = document.createElement('div');
    card.className = 'summary-card';

    // Option breakdown rows
    const optRows = s.options.map((opt, oi) => {
      const count = s.counts[oi] || 0;
      const optPct = s.attempted > 0 ? Math.round((count / s.attempted) * 100) : 0;
      return `
        <div class="sum-opt-row">
          <span class="sum-opt-letter" style="background:${OPTION_COLORS[oi]}">${OPTION_LABELS[oi]}</span>
          <span class="sum-opt-text">${opt}</span>
          <div class="sum-bar-track">
            <div class="sum-bar-fill" style="width:${optPct}%;background:${OPTION_COLORS[oi]}"></div>
          </div>
          <span class="sum-opt-count">${count}</span>
        </div>`;
    }).join('');

    // Per-player response list (hidden until toggle enabled)
    const responses = s.player_responses || [];
    const playerRows = responses.length
      ? responses.map(r => `
          <div class="sum-player-row">
            <span class="resp-avatar sum-player-avatar">${r.name.charAt(0).toUpperCase()}</span>
            <span class="sum-player-name resp-name">${r.name}</span>
            <span class="resp-badge" style="background:${OPTION_COLORS[r.answer_index]}">${OPTION_LABELS[r.answer_index]}</span>
            <span class="sum-player-opt">${s.options[r.answer_index] || ''}</span>
          </div>`).join('')
      : '<p class="sum-no-responses">No responses recorded.</p>';

    card.innerHTML = `
      <div class="sum-card-header">
        <span class="sum-q-num">Q${i + 1}</span>
        <span class="sum-q-text">${s.question}</span>
        <span class="sum-attempted">${s.attempted} / ${total} attempted (${pct}%)</span>
      </div>
      <div class="sum-opts">${optRows}</div>
      <div class="sum-player-list">${playerRows}</div>
    `;
    summaryWrap.appendChild(card);
  });
}

function renderFeedback(feedbackArr) {
  feedbackList.innerHTML = '';
  if (!feedbackArr.length) {
    feedbackSummaryWrap.classList.add('hidden');
    return;
  }
  feedbackSummaryWrap.classList.remove('hidden');

  // Average rating
  const rated = feedbackArr.filter(f => f.rating > 0);
  if (rated.length) {
    const avg = (rated.reduce((s, f) => s + f.rating, 0) / rated.length).toFixed(1);
    const avgEl = document.createElement('div');
    avgEl.className = 'fb-avg-row';
    avgEl.innerHTML = `
      <span class="fb-avg-stars">${'★'.repeat(Math.round(avg))}${'☆'.repeat(5 - Math.round(avg))}</span>
      <span class="fb-avg-label">${avg} / 5 average &nbsp;·&nbsp; ${rated.length} rating${rated.length > 1 ? 's' : ''}</span>
    `;
    feedbackList.appendChild(avgEl);
  }

  feedbackArr.forEach(f => {
    const row = document.createElement('div');
    row.className = 'fb-entry';
    const stars = f.rating > 0
      ? `<span class="fb-entry-stars">${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}</span>`
      : '';
    const comment = f.comment ? `<p class="fb-entry-comment">"${f.comment}"</p>` : '';
    const contact = f.contact
      ? `<span class="fb-entry-contact">📧 ${f.contact}</span>`
      : '';
    row.innerHTML = `
      <div class="fb-entry-header">
        <span class="resp-avatar">${f.name.charAt(0).toUpperCase()}</span>
        <strong class="fb-entry-name">${f.name}</strong>
        ${stars}
        ${contact}
      </div>
      ${comment}
    `;
    feedbackList.appendChild(row);
  });
}
