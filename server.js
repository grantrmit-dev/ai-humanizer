const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Multer config
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.docx', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

app.use(express.static('public'));
app.use(express.json({ limit: '5mb' }));

// ── Extract text from uploaded file ──
app.post('/api/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded or unsupported format' });

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let text = '';

    if (ext === '.txt') {
      text = fs.readFileSync(filePath, 'utf-8');
    } else if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    } else if (ext === '.pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      text = data.text;
    }

    // Cleanup uploaded file
    fs.unlinkSync(filePath);

    if (!text.trim()) return res.status(400).json({ error: 'Could not extract text from file' });

    res.json({ text: text.trim() });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

// ── Analyze text for AI writing ──
app.post('/api/analyze', (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });

    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    const analyzed = paragraphs.map(para => {
      const score = computeAIScore(para.trim());
      return { text: para.trim(), aiScore: score, isAI: score > 0.55 };
    });

    const aiCount = analyzed.filter(p => p.isAI).length;
    const aiPercentage = paragraphs.length ? Math.round((aiCount / paragraphs.length) * 100) : 0;

    res.json({ paragraphs: analyzed, aiPercentage });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// ── Heuristic AI detection scoring ──
function computeAIScore(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 5) return 0.1;

  let score = 0;
  let factors = 0;

  // 1. Sentence length uniformity (AI tends toward uniform length)
  const sentLengths = sentences.map(s => s.split(/\s+/).length);
  const avgLen = sentLengths.reduce((a, b) => a + b, 0) / sentLengths.length;
  const variance = sentLengths.reduce((a, l) => a + (l - avgLen) ** 2, 0) / sentLengths.length;
  const cv = avgLen > 0 ? Math.sqrt(variance) / avgLen : 0;
  // Low CV = uniform = more AI-like
  if (cv < 0.25) score += 0.85;
  else if (cv < 0.4) score += 0.6;
  else if (cv < 0.6) score += 0.35;
  else score += 0.15;
  factors++;

  // 2. Vocabulary diversity (type-token ratio)
  const lowerWords = words.map(w => w.toLowerCase().replace(/[^a-z']/g, '')).filter(Boolean);
  const uniqueWords = new Set(lowerWords);
  const ttr = lowerWords.length > 0 ? uniqueWords.size / lowerWords.length : 1;
  // AI often has moderate-high TTR but avoids very low or very high
  if (ttr > 0.55 && ttr < 0.75) score += 0.7;
  else if (ttr > 0.45 && ttr < 0.85) score += 0.45;
  else score += 0.2;
  factors++;

  // 3. Common AI filler phrases
  const aiPhrases = [
    'it is important to note', 'it\'s worth noting', 'in conclusion',
    'furthermore', 'moreover', 'additionally', 'in today\'s',
    'it is essential', 'plays a crucial role', 'in the realm of',
    'navigating the', 'leverage', 'utilize', 'facilitate',
    'comprehensive', 'robust', 'seamless', 'streamline',
    'cutting-edge', 'innovative', 'groundbreaking', 'paradigm',
    'holistic', 'synergy', 'ecosystem', 'landscape',
    'delve', 'delving', 'tapestry', 'multifaceted',
    'pivotal', 'nuanced', 'underscores', 'underscoring',
    'in this article', 'let\'s explore', 'in summary',
    'overarching', 'intricate', 'intricacies'
  ];
  const lower = text.toLowerCase();
  const phraseHits = aiPhrases.filter(p => lower.includes(p)).length;
  if (phraseHits >= 3) score += 0.95;
  else if (phraseHits >= 2) score += 0.8;
  else if (phraseHits >= 1) score += 0.55;
  else score += 0.15;
  factors++;

  // 4. Average word length (AI tends toward 5-6 char avg)
  const avgWordLen = lowerWords.reduce((a, w) => a + w.length, 0) / (lowerWords.length || 1);
  if (avgWordLen >= 4.8 && avgWordLen <= 6.2) score += 0.65;
  else score += 0.25;
  factors++;

  // 5. Transition word density
  const transitions = ['however', 'therefore', 'consequently', 'nevertheless',
    'furthermore', 'moreover', 'additionally', 'subsequently',
    'conversely', 'nonetheless', 'accordingly', 'hence'];
  const transHits = transitions.filter(t => lower.includes(t)).length;
  const transDensity = transHits / (sentences.length || 1);
  if (transDensity > 0.3) score += 0.8;
  else if (transDensity > 0.15) score += 0.55;
  else score += 0.2;
  factors++;

  // 6. Contractions usage (humans use more contractions)
  const contractions = (text.match(/\b\w+'\w+\b/g) || []).length;
  const contractionRate = contractions / (words.length || 1);
  if (contractionRate < 0.01) score += 0.7;
  else if (contractionRate < 0.03) score += 0.45;
  else score += 0.15;
  factors++;

  // 7. Paragraph length (AI tends medium-length, well-structured)
  if (words.length >= 40 && words.length <= 120) score += 0.6;
  else score += 0.25;
  factors++;

  return Math.min(0.99, Math.max(0.01, score / factors));
}

// ── Humanize text via Claude API ──
app.post('/api/humanize', async (req, res) => {
  try {
    const { paragraphs, style } = req.body;
    if (!paragraphs || !style) return res.status(400).json({ error: 'Missing paragraphs or style' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

    const client = new Anthropic({ apiKey });

    const styleGuides = {
      academic: `Rewrite in an academic scholarly tone. Use complex sentence structures, field-appropriate terminology, hedging language ("suggests", "appears to"), passive voice where appropriate, and citation-ready phrasing. Vary sentence rhythm like a real academic writer — mix long analytical sentences with shorter declarative ones. Include occasional first-person hedges ("we argue", "our analysis suggests"). Avoid robotic uniformity.`,
      professional: `Rewrite in a professional and formal business tone. Use clear, structured language appropriate for reports, memos, or professional communication. Be direct but polished. Vary paragraph rhythm. Use active voice predominantly. Include occasional industry-natural phrasing. Avoid buzzwords and AI-typical filler. Sound like a competent human professional, not a template.`,
      natural: `Rewrite in a natural, conversational but polished tone. Use everyday language that flows easily. Mix sentence lengths freely — some short, some longer. Use contractions naturally. Occasionally start sentences with "And" or "But". Include the kind of small imperfections real humans have — minor asides, natural emphasis, varied rhythm. Sound like a thoughtful person writing, not a machine.`,
      speaking: `Rewrite in casual spoken English style. Use contractions freely, informal phrasing, and the rhythms of natural speech. Include filler-like phrases ("you know", "basically", "the thing is"), sentence fragments, and casual transitions. Vary tone — sometimes emphatic, sometimes throwaway. It should read like someone talking, transcribed. Not sloppy, but definitely casual and human.`
    };

    const aiParagraphs = paragraphs.filter(p => p.isAI);
    if (aiParagraphs.length === 0) {
      return res.json({ result: paragraphs.map(p => ({ ...p, humanized: p.text })) });
    }

    const prompt = `You are a writing style converter. Rewrite ONLY the text provided below. Do not add introductions, conclusions, or commentary. Return ONLY the rewritten paragraphs separated by "---SEPARATOR---".

Style instruction: ${styleGuides[style] || styleGuides.natural}

IMPORTANT: Preserve the original meaning and information. Only change the writing style. Make each paragraph sound genuinely human-written — vary rhythm, word choice, and structure naturally.

Paragraphs to rewrite (each separated by ---SEPARATOR---):

${aiParagraphs.map(p => p.text).join('\n---SEPARATOR---\n')}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;
    const rewritten = responseText.split('---SEPARATOR---').map(s => s.trim());

    let rewriteIdx = 0;
    const result = paragraphs.map(p => {
      if (p.isAI && rewriteIdx < rewritten.length) {
        return { ...p, humanized: rewritten[rewriteIdx++] };
      }
      return { ...p, humanized: p.text };
    });

    res.json({ result });
  } catch (err) {
    console.error('Humanize error:', err);
    res.status(500).json({ error: 'Humanization failed: ' + err.message });
  }
});

// ── Download as .docx ──
app.post('/api/download/docx', async (req, res) => {
  try {
    const { paragraphs } = req.body;
    if (!paragraphs) return res.status(400).json({ error: 'No content' });

    const doc = new Document({
      sections: [{
        children: paragraphs.map(p => new Paragraph({
          children: [new TextRun({ text: p.humanized || p.text, size: 24 })],
          spacing: { after: 200 }
        }))
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': 'attachment; filename="humanized-document.docx"'
    });
    res.send(buffer);
  } catch (err) {
    console.error('DOCX error:', err);
    res.status(500).json({ error: 'Failed to generate DOCX' });
  }
});

// ── Download as .txt ──
app.post('/api/download/txt', (req, res) => {
  const { paragraphs } = req.body;
  if (!paragraphs) return res.status(400).json({ error: 'No content' });

  const text = paragraphs.map(p => p.humanized || p.text).join('\n\n');
  res.set({
    'Content-Type': 'text/plain',
    'Content-Disposition': 'attachment; filename="humanized-document.txt"'
  });
  res.send(text);
});

app.listen(PORT, () => {
  console.log(`AI Writing Humanizer running at http://localhost:${PORT}`);
});
