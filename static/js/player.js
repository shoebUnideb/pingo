const OPTION_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71'];
const OPTION_LABELS = ['A', 'B', 'C', 'D'];

const socket = io();

let playerName = '';
let hasAnswered = false;
let selectedRating = 0;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const joinScreen      = document.getElementById('join-screen');
const waitingScreen   = document.getElementById('waiting-screen');
const questionScreen  = document.getElementById('question-screen');
const feedbackScreen  = document.getElementById('feedback-screen');
const gameoverScreen  = document.getElementById('pgameover-screen');
const joinForm        = document.getElementById('join-form');
const codeInput       = document.getElementById('code-input');
const nameInput       = document.getElementById('name-input');
const joinError       = document.getElementById('join-error');
const waitingName     = document.getElementById('waiting-name');
const pqCounter       = document.getElementById('pq-counter');
const pquestionText   = document.getElementById('pquestion-text');
const optionsGrid     = document.getElementById('options-grid');
const submittedMsg    = document.getElementById('submitted-msg');
const playerNameBadge = document.getElementById('player-name-badge');
const goName          = document.getElementById('go-name');
const feedbackForm    = document.getElementById('feedback-form');
const skipFeedbackBtn = document.getElementById('skip-feedback-btn');
const feedbackThanks  = document.getElementById('feedback-thanks');
const fbName          = document.getElementById('fb-name');
const ratingInput     = document.getElementById('rating-val');
const starContainer   = document.getElementById('star-container');

// ── Join form ─────────────────────────────────────────────────────────────────
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = codeInput.value.trim();
  const name = nameInput.value.trim();
  if (!code || !name) return;
  playerName = name;
  joinError.classList.add('hidden');
  socket.emit('join_as_player', { code, name });
});

socket.on('join_error', (data) => {
  joinError.textContent = data.message;
  joinError.classList.remove('hidden');
  playerName = '';
});

// ── Star rating ───────────────────────────────────────────────────────────────
if (starContainer) {
  starContainer.addEventListener('mouseover', (e) => {
    const val = e.target.dataset.val;
    if (!val) return;
    highlightStars(parseInt(val));
  });
  starContainer.addEventListener('mouseout', () => {
    highlightStars(selectedRating);
  });
  starContainer.addEventListener('click', (e) => {
    const val = e.target.dataset.val;
    if (!val) return;
    selectedRating = parseInt(val);
    ratingInput.value = selectedRating;
    highlightStars(selectedRating);
  });
}

function highlightStars(count) {
  document.querySelectorAll('.star').forEach((s, i) => {
    s.classList.toggle('active', i < count);
  });
}

// ── Feedback form submit ──────────────────────────────────────────────────────
if (feedbackForm) {
  feedbackForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendFeedback();
  });
}

if (skipFeedbackBtn) {
  skipFeedbackBtn.addEventListener('click', () => {
    socket.emit('submit_feedback', { rating: 0, comment: '', contact: '' });
    showThanks();
  });
}

function sendFeedback() {
  const rating  = parseInt(ratingInput.value) || 0;
  const comment = document.getElementById('fb-comment').value.trim();
  const contact = document.getElementById('fb-contact').value.trim();
  socket.emit('submit_feedback', { rating, comment, contact });
  showThanks();
}

function showThanks() {
  feedbackForm.classList.add('hidden');
  fbName.textContent = playerName;
  feedbackThanks.classList.remove('hidden');
}

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on('waiting', () => {
  waitingName.textContent = `Hi, ${playerName}! 👋`;
  showScreen(waitingScreen);
});

socket.on('question_data', (data) => {
  showQuestion(data);
});

socket.on('collect_feedback', () => {
  selectedRating = 0;
  ratingInput.value = 0;
  highlightStars(0);
  feedbackForm.classList.remove('hidden');
  feedbackThanks.classList.add('hidden');
  if (document.getElementById('fb-comment')) document.getElementById('fb-comment').value = '';
  if (document.getElementById('fb-contact')) document.getElementById('fb-contact').value = '';
  showScreen(feedbackScreen);
});

socket.on('game_over', () => {
  goName.textContent = playerName;
  showScreen(gameoverScreen);
});

socket.on('game_reset', () => {
  playerName = '';
  hasAnswered = false;
  nameInput.value = '';
  showScreen(joinScreen);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function showScreen(el) {
  [joinScreen, waitingScreen, questionScreen, feedbackScreen, gameoverScreen].forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

function showQuestion(data) {
  hasAnswered = false;
  submittedMsg.classList.add('hidden');

  pqCounter.textContent = `Q ${data.index + 1} / ${data.total}`;
  pquestionText.textContent = data.question;
  playerNameBadge.textContent = playerName;

  buildOptions(data.options);
  showScreen(questionScreen);
}

function buildOptions(options) {
  optionsGrid.innerHTML = '';
  options.forEach((optText, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.style.background = OPTION_COLORS[i];
    btn.innerHTML = `<span class="opt-letter">${OPTION_LABELS[i]}</span> ${optText}`;
    btn.addEventListener('click', () => selectAnswer(i));
    optionsGrid.appendChild(btn);
  });
}

function selectAnswer(index) {
  if (hasAnswered) return;
  hasAnswered = true;

  const btns = optionsGrid.querySelectorAll('.option-btn');
  btns.forEach((btn, i) => {
    if (i === index) {
      btn.classList.add('selected');
    } else {
      btn.classList.add('faded');
    }
    btn.disabled = true;
  });

  socket.emit('submit_answer', { answer_index: index });
  submittedMsg.classList.remove('hidden');
}
