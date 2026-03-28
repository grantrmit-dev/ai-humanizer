// ── State ──
let analyzedParagraphs = [];
let humanizedParagraphs = [];

// ── DOM ──
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const pasteInput = document.getElementById('paste-input');
const pasteBtn = document.getElementById('paste-btn');
const uploadSection = document.getElementById('upload-section');
const analysisSection = document.getElementById('analysis-section');
const resultsSection = document.getElementById('results-section');
const paragraphsContainer = document.getElementById('paragraphs-container');
const meterFill = document.getElementById('meter-fill');
const meterValue = document.getElementById('meter-value');
const humanizeBtn = document.getElementById('humanize-btn');
const originalPanel = document.getElementById('original-panel');
const humanizedPanel = document.getElementById('humanized-panel');
const downloadTxt = document.getElementById('download-txt');
const downloadDocx = document.getElementById('download-docx');
const startOver = document.getElementById('start-over');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

// ── Upload Handlers ──
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

pasteBtn.addEventListener('click', () => {
  const text = pasteInput.value.trim();
  if (!text) return alert('Please paste some text first');
  analyzeText(text);
});

async function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['txt', 'docx', 'pdf'].includes(ext)) {
    return alert('Unsupported file type. Please use .txt, .docx, or .pdf');
  }

  showLoading('Extracting text from document...');
  try {
    const formData = new FormData();
    formData.append('document', file);

    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Upload failed');
    analyzeText(data.text);
  } catch (err) {
    hideLoading();
    alert('Error: ' + err.message);
  }
}

// ── Analysis ──
async function analyzeText(text) {
  showLoading('Analyzing text for AI-generated content...');
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');

    analyzedParagraphs = data.paragraphs;
    renderAnalysis(data.paragraphs, data.aiPercentage);
    uploadSection.classList.add('hidden');
    analysisSection.classList.remove('hidden');
    hideLoading();
  } catch (err) {
    hideLoading();
    alert('Error: ' + err.message);
  }
}

function renderAnalysis(paragraphs, aiPercentage) {
  // Update meter
  const color = aiPercentage > 60 ? 'var(--red)' :
                aiPercentage > 30 ? 'var(--yellow)' : 'var(--green)';
  meterFill.style.width = aiPercentage + '%';
  meterFill.style.background = color;
  meterValue.textContent = aiPercentage + '%';
  meterValue.style.color = color;

  // Render paragraphs
  paragraphsContainer.innerHTML = '';
  paragraphs.forEach((p, i) => {
    const cls = p.isAI ? 'ai' : 'human';
    const scorePercent = Math.round(p.aiScore * 100);
    const div = document.createElement('div');
    div.className = `para-item ${cls}`;
    div.innerHTML = `
      <div class="para-score ${cls}">
        ${scorePercent}%
        <div class="para-label ${cls}">${p.isAI ? '🤖 AI' : '✅ Human'}</div>
      </div>
      <div class="para-text">${escapeHtml(p.text)}</div>
    `;
    paragraphsContainer.appendChild(div);
  });
}

// ── Humanize ──
humanizeBtn.addEventListener('click', async () => {
  const style = document.querySelector('input[name="style"]:checked')?.value;
  if (!style) return alert('Please select a style');

  const aiCount = analyzedParagraphs.filter(p => p.isAI).length;
  if (aiCount === 0) {
    alert('No AI-generated content detected! Nothing to humanize.');
    return;
  }

  showLoading(`Humanizing ${aiCount} AI-detected paragraph${aiCount > 1 ? 's' : ''}...`);
  try {
    const res = await fetch('/api/humanize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphs: analyzedParagraphs, style })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Humanization failed');

    humanizedParagraphs = data.result;
    renderResults(data.result);
    analysisSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
    hideLoading();
  } catch (err) {
    hideLoading();
    alert('Error: ' + err.message);
  }
});

function renderResults(paragraphs) {
  originalPanel.innerHTML = '';
  humanizedPanel.innerHTML = '';

  paragraphs.forEach(p => {
    // Original side
    const origDiv = document.createElement('div');
    origDiv.className = `para-block ${p.isAI ? 'ai-highlight' : 'human-highlight'}`;
    origDiv.textContent = p.text;
    originalPanel.appendChild(origDiv);

    // Humanized side
    const humDiv = document.createElement('div');
    humDiv.className = `para-block ${p.isAI ? 'humanized-block' : 'human-highlight'}`;
    humDiv.textContent = p.humanized || p.text;
    humanizedPanel.appendChild(humDiv);
  });
}

// ── Downloads ──
downloadTxt.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/download/txt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphs: humanizedParagraphs })
    });
    const blob = await res.blob();
    downloadBlob(blob, 'humanized-document.txt');
  } catch (err) { alert('Download failed: ' + err.message); }
});

downloadDocx.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/download/docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphs: humanizedParagraphs })
    });
    const blob = await res.blob();
    downloadBlob(blob, 'humanized-document.docx');
  } catch (err) { alert('Download failed: ' + err.message); }
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Start Over ──
startOver.addEventListener('click', () => {
  analyzedParagraphs = [];
  humanizedParagraphs = [];
  resultsSection.classList.add('hidden');
  analysisSection.classList.add('hidden');
  uploadSection.classList.remove('hidden');
  pasteInput.value = '';
  fileInput.value = '';
});

// ── Helpers ──
function showLoading(text) {
  loadingText.textContent = text;
  loading.classList.remove('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
