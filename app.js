const API = 'http://localhost:5000';
let loaded = false;
let thinking = false;

// ── DOM refs ──────────────────────────────────────────────
const dropZone     = document.getElementById('drop-zone');
const fileInput    = document.getElementById('file-input');
const fileChip     = document.getElementById('file-chip');
const chipFilename = document.getElementById('chip-filename');
const chipMeta     = document.getElementById('chip-meta');
const btnReset     = document.getElementById('btn-reset');
const statsSection = document.getElementById('stats-section');
const statRows     = document.getElementById('stat-rows');
const statCols     = document.getElementById('stat-cols');
const colsWrap     = document.getElementById('cols-wrap');
const suggestWrap  = document.getElementById('suggestions-wrap');
const suggestBox   = document.getElementById('suggestions');
const chat         = document.getElementById('chat');
const queryInput   = document.getElementById('query-input');
const sendBtn      = document.getElementById('send-btn');

// ── Drag & drop ───────────────────────────────────────────
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('over');
});

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) handleFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

// ── Upload ────────────────────────────────────────────────
async function handleFile(file) {
  dropZone.style.opacity = '0.5';

  const form = new FormData();
  form.append('file', file);

  try {
    const res  = await fetch(`${API}/upload`, { method: 'POST', body: form });
    const data = await res.json();

    if (data.error) {
      alert(data.error);
      dropZone.style.opacity = '1';
      return;
    }

    loaded = true;
    renderSidebar(data.info);
    enableChat();
    loadSuggestions();
    clearChat();
    addBotMessage(`✓ Loaded **${file.name}** — ${data.info.rows.toLocaleString()} rows × ${data.info.cols} columns.\n\nAsk me anything about your data.`);

  } catch (e) {
    alert('Upload failed. Is Flask running on port 5000?');
    dropZone.style.opacity = '1';
  }
}

// ── Sidebar ───────────────────────────────────────────────
function renderSidebar(info) {
  // Show file chip, hide upload zone
  dropZone.style.display  = 'none';
  fileChip.style.display  = 'block';
  chipFilename.textContent = info.filename;
  chipMeta.textContent     = `${info.rows.toLocaleString()} rows · ${info.cols} cols`;

  // Stats
  statsSection.style.display = 'block';
  statRows.textContent = info.rows.toLocaleString();
  statCols.textContent = info.cols;

  // Column list
  colsWrap.innerHTML = `<div class="cols-label">Columns</div>` +
    info.columns.map(col => {
      const typeClass = col.type.includes('int') || col.type.includes('float') ? 'num'
                      : col.type.includes('date') || col.type.includes('time') ? 'dt'
                      : 'str';
      const typeLabel = typeClass === 'num' ? 'NUM' : typeClass === 'dt' ? 'DATE' : 'STR';
      const nullBadge = col.nulls > 0
        ? `<span class="col-null">${col.nulls} null</span>`
        : '';
      return `
        <div class="col-row">
          <span class="type-badge type-${typeClass}">${typeLabel}</span>
          <span class="col-name">${col.name}</span>
          ${nullBadge}
        </div>`;
    }).join('');
}

async function loadSuggestions() {
  try {
    const res  = await fetch(`${API}/suggestions`);
    const data = await res.json();

    suggestWrap.style.display = 'block';
    suggestBox.innerHTML = data.questions
      .map(q => `<span class="sugg-pill" data-q="${escHtml(q)}">${escHtml(q)}</span>`)
      .join('');

    // Attach click handlers
    suggestBox.querySelectorAll('.sugg-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        queryInput.value = pill.dataset.q;
        autoResize();
        sendMessage();
      });
    });
  } catch (e) {
    // Suggestions are optional — fail silently
  }
}

// ── Chat ──────────────────────────────────────────────────
function enableChat() {
  queryInput.disabled = false;
  queryInput.placeholder = 'Ask about your data…';
  sendBtn.disabled = false;
  queryInput.focus();
}

function clearChat() {
  chat.innerHTML = '';
}

queryInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

queryInput.addEventListener('input', autoResize);

function autoResize() {
  queryInput.style.height = 'auto';
  queryInput.style.height = Math.min(queryInput.scrollHeight, 100) + 'px';
}

sendBtn.addEventListener('click', sendMessage);

async function sendMessage() {
  if (thinking || !loaded) return;
  const query = queryInput.value.trim();
  if (!query) return;

  addUserMessage(query);
  queryInput.value = '';
  queryInput.style.height = 'auto';
  queryInput.disabled = true;
  sendBtn.disabled = true;

  const typingEl = addTypingIndicator();
  thinking = true;

  try {
    const res  = await fetch(`${API}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    typingEl.remove();

    if (data.error) {
      addBotMessage(data.error, true);
    } else {
      addBotMessage(data.answer);
      if (data.chart) addChartMessage(data.chart);
    }

  } catch (e) {
    typingEl.remove();
    addBotMessage('Could not reach the server. Make sure Flask is running.', true);
  }

  thinking = false;
  queryInput.disabled = false;
  queryInput.placeholder = 'Ask about your data…';
  sendBtn.disabled = false;
  queryInput.focus();
  scrollToBottom();
}

// ── Message builders ──────────────────────────────────────
function addUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-user';
  div.innerHTML = `
    <div class="msg-who">YOU</div>
    <div class="bubble">${escHtml(text)}</div>
  `;
  chat.appendChild(div);
  scrollToBottom();
}

function addBotMessage(text, isError = false) {
  const div = document.createElement('div');
  div.className = 'msg msg-bot';
  div.innerHTML = `
    <div class="msg-who">ANALYST</div>
    <div class="bubble${isError ? ' err' : ''}">${formatText(text)}</div>
  `;
  chat.appendChild(div);
  scrollToBottom();
}

function addChartMessage(base64) {
  const div = document.createElement('div');
  div.className = 'msg msg-bot';
  div.innerHTML = `
    <div class="msg-who">CHART</div>
    <div class="chart-wrap">
      <img src="data:image/png;base64,${base64}" alt="chart"/>
    </div>
  `;
  chat.appendChild(div);
  scrollToBottom();
}

function addTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'msg msg-bot';
  div.innerHTML = `
    <div class="msg-who">ANALYST</div>
    <div class="typing">
      <div class="dot"></div>
      <div class="dot"></div>
      <div class="dot"></div>
    </div>
  `;
  chat.appendChild(div);
  scrollToBottom();
  return div;
}

// ── Reset ─────────────────────────────────────────────────
btnReset.addEventListener('click', resetAll);

async function resetAll() {
  try {
    await fetch(`${API}/reset`, { method: 'POST' });
  } catch (e) { /* ignore */ }

  loaded = false;

  dropZone.style.display  = 'block';
  dropZone.style.opacity  = '1';
  fileChip.style.display  = 'none';
  statsSection.style.display = 'none';
  colsWrap.innerHTML      = '';
  suggestWrap.style.display = 'none';
  suggestBox.innerHTML    = '';
  fileInput.value         = '';

  queryInput.disabled     = true;
  queryInput.placeholder  = 'Upload a CSV to start…';
  sendBtn.disabled        = true;

  chat.innerHTML = `
    <div id="empty-state">
      <div class="empty-icon">📊</div>
      <h2>No data loaded</h2>
      <p>Upload a CSV file to start asking questions about your data.</p>
    </div>
  `;
}

// ── Helpers ───────────────────────────────────────────────
function scrollToBottom() {
  setTimeout(() => chat.scrollTop = chat.scrollHeight, 50);
}

function escHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatText(text) {
  return escHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:12px;font-family:monospace">$1</code>');
}