const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { ffmpegPath } = require('./media.cjs');

const MODELS = {
  fast: 'onnx-community/whisper-base',
  accurate: 'onnx-community/whisper-small',
};

const MAX_WORDS = 7;

let transcriber = null;
let loadedModel = null;

// Decode a source segment to 16 kHz mono float32 PCM, the input Whisper expects.
function decodePcm(filePath, start, duration) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-ss', start.toFixed(3), '-t', duration.toFixed(3), '-i', filePath,
      '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1',
    ], { windowsHide: true });
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error('تعذر استخراج الصوت'));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
    });
  });
}

async function getTranscriber(quality, onProgress) {
  const model = MODELS[quality] || MODELS.fast;
  if (transcriber && loadedModel === model) return transcriber;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = path.join(app.getPath('userData'), 'models');
  const files = {};
  transcriber = await pipeline('automatic-speech-recognition', model, {
    dtype: 'q8',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        files[p.file] = p;
        const loaded = Object.values(files).reduce((s, f) => s + (f.loaded || 0), 0);
        const total = Object.values(files).reduce((s, f) => s + (f.total || 0), 0);
        onProgress({ stage: 'download', progress: total ? loaded / total : 0 });
      }
    },
  });
  loadedModel = model;
  return transcriber;
}

// job: { quality, language, segments: [{ path, in, out, speed, timelineStart }] }
// Returns caption cues in timeline time: [{ start, end, text }].
async function generate(job, onProgress) {
  onProgress({ stage: 'download', progress: 0 });
  const asr = await getTranscriber(job.quality, onProgress);
  const cues = [];
  for (let i = 0; i < job.segments.length; i++) {
    const s = job.segments[i];
    onProgress({ stage: 'transcribe', progress: i / job.segments.length });
    const pcm = await decodePcm(s.path, s.in, s.out - s.in);
    if (pcm.length < 1600) continue;
    const out = await asr(pcm, {
      language: job.language || 'arabic', task: 'transcribe',
      return_timestamps: true, chunk_length_s: 30, stride_length_s: 5,
    });
    for (const c of out.chunks || []) {
      const text = (c.text || '').trim();
      if (!text) continue;
      const [a, b] = c.timestamp;
      const srcEnd = Math.max(b == null ? s.out - s.in : b, a + 0.5);
      // Whisper segments can be whole sentences; split into short lines timed by character share.
      const words = text.split(/\s+/);
      const groups = [];
      for (let w = 0; w < words.length; w += MAX_WORDS) groups.push(words.slice(w, w + MAX_WORDS).join(' '));
      const totalChars = groups.reduce((n, g) => n + g.length, 0);
      let t = a;
      for (const g of groups) {
        const len = (srcEnd - a) * (g.length / totalChars);
        cues.push({ start: s.timelineStart + t / s.speed, end: s.timelineStart + (t + len) / s.speed, text: g });
        t += len;
      }
    }
  }
  onProgress({ stage: 'done', progress: 1 });
  return cues;
}

module.exports = { generate };
