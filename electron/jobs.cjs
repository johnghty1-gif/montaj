const { app } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ffmpegPath, cacheDir, derivedPath, probe } = require('./media.cjs');
const { clipAudioChain } = require('./audiofx.cjs');

const SEPARATION_MODEL_URL = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx';
const MATTING_MODEL = 'Xenova/modnet';

let active = null; // { procs: Set<ChildProcess>, canceled: boolean }

function canceled() { return !active || active.canceled; }
function checkCanceled() { if (canceled()) throw new Error('تم الإلغاء'); }

function track(proc) {
  if (active) active.procs.add(proc);
  proc.on('close', () => active && active.procs.delete(proc));
  return proc;
}

// Runs FFmpeg, reporting progress (0..1) against `duration` seconds of output.
function ffmpeg(args, { duration = 0, onProgress = () => {}, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const proc = track(spawn(ffmpegPath, ['-y', '-hide_banner', '-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true, cwd }));
    let err = '';
    proc.stdout.on('data', (d) => {
      const m = /out_time_ms=(\d+)/.exec(d.toString());
      if (m && duration) onProgress(Math.min(1, parseInt(m[1], 10) / 1e6 / duration));
    });
    proc.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (canceled()) reject(new Error('تم الإلغاء'));
      else if (code === 0) resolve();
      else reject(new Error(err || 'FFmpeg failed'));
    });
  });
}

async function download(url, dest, onProgress) {
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`تعذر تنزيل النموذج (${res.status})`);
  const total = parseInt(res.headers.get('content-length') || '0', 10);
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  for await (const chunk of res.body) {
    checkCanceled();
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    if (total) onProgress(got / total);
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(tmp, dest);
  return dest;
}

async function transformers() {
  const t = await import('@huggingface/transformers');
  t.env.cacheDir = path.join(app.getPath('userData'), 'models');
  return t;
}

// ---------- background removal ----------
let matting = null;
async function loadMatting(report) {
  if (matting) return matting;
  const { AutoModel, AutoProcessor, RawImage } = await transformers();
  const files = {};
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) {
      files[p.file] = p;
      const all = Object.values(files);
      report('تنزيل نموذج إزالة الخلفية (مرة واحدة)…', all.reduce((s, f) => s + f.loaded, 0) / all.reduce((s, f) => s + f.total, 0));
    }
  };
  const model = await AutoModel.from_pretrained(MATTING_MODEL, { dtype: 'fp32', progress_callback });
  const processor = await AutoProcessor.from_pretrained(MATTING_MODEL, { progress_callback });
  matting = { model, processor, RawImage };
  return matting;
}

async function alphaMask(m, rgb, w, h) {
  const image = new m.RawImage(rgb, w, h, 3);
  const { pixel_values } = await m.processor(image);
  const { output } = await m.model({ input: pixel_values });
  const mask = await m.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(w, h);
  return mask.data; // 1 byte per pixel
}

async function removeBackground({ path: src, type, in: tin = 0, out: tout, fps = 30 }, report) {
  const m = await loadMatting(report);
  const info = await probe(src);
  const scale = Math.min(1, 1280 / Math.max(info.width, info.height));
  const w = Math.max(2, Math.round((info.width * scale) / 2) * 2), h = Math.max(2, Math.round((info.height * scale) / 2) * 2);
  const frameBytes = w * h * 3;
  const isImage = type === 'image';
  const len = isImage ? 0 : tout - tin;
  const decodeArgs = isImage
    ? ['-i', src, '-frames:v', '1']
    : ['-ss', tin.toFixed(3), '-t', len.toFixed(3), '-i', src, '-r', String(fps)];
  const dec = track(spawn(ffmpegPath, ['-v', 'error', ...decodeArgs, '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true }));

  const outPath = derivedPath('cutout', isImage ? 'png' : 'webm');
  const encArgs = ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-framerate', String(fps), '-i', 'pipe:0'];
  if (isImage) encArgs.push('-frames:v', '1', outPath);
  else {
    encArgs.push('-ss', tin.toFixed(3), '-t', len.toFixed(3), '-i', src, '-map', '0:v', '-map', '1:a?',
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '30', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8',
      '-row-mt', '1', '-auto-alt-ref', '0', '-metadata:s:v:0', 'alpha_mode=1', '-c:a', 'libopus', '-b:a', '160k', '-shortest', outPath);
  }
  const enc = track(spawn(ffmpegPath, encArgs, { windowsHide: true }));
  let encErr = '';
  enc.stderr.on('data', (d) => { encErr = (encErr + d).slice(-3000); });
  const encDone = new Promise((resolve, reject) => enc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(encErr || 'encode failed')))));

  const totalFrames = isImage ? 1 : Math.max(1, Math.round(len * fps));
  let pending = Buffer.alloc(0);
  let done = 0;
  for await (const chunk of dec.stdout) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= frameBytes) {
      checkCanceled();
      const rgb = new Uint8ClampedArray(pending.buffer.slice(pending.byteOffset, pending.byteOffset + frameBytes));
      pending = pending.subarray(frameBytes);
      const a = await alphaMask(m, rgb, w, h);
      const rgba = Buffer.alloc(w * h * 4);
      for (let i = 0, j = 0; i < a.length; i++, j += 3) {
        const al = a[i];
        // Video cutouts are premultiplied so players that drop the alpha channel show black, not the old background.
        const k = isImage ? 1 : al / 255;
        rgba[i * 4] = rgb[j] * k; rgba[i * 4 + 1] = rgb[j + 1] * k; rgba[i * 4 + 2] = rgb[j + 2] * k; rgba[i * 4 + 3] = al;
      }
      if (!enc.stdin.write(rgba)) await new Promise((r) => enc.stdin.once('drain', r));
      done++;
      report('جارٍ إزالة الخلفية…', Math.min(0.99, done / totalFrames));
    }
  }
  enc.stdin.end();
  await encDone;
  checkCanceled();
  return { path: outPath };
}

// ---------- stabilization (vid.stab, two passes) ----------
async function stabilize({ path: src, in: tin, out: tout, strength = 2 }, report) {
  const len = tout - tin;
  const shakiness = [4, 7, 10][strength - 1] || 7;
  const smoothing = [10, 20, 40][strength - 1] || 20;
  const work = fs.mkdtempSync(path.join(cacheDir('job-tmp'), 'stab-'));
  try {
    const seg = ['-ss', tin.toFixed(3), '-t', len.toFixed(3), '-i', src];
    // The transforms file is referenced relative to cwd: Windows drive colons break filter option parsing.
    await ffmpeg([...seg, '-vf', `vidstabdetect=shakiness=${shakiness}:accuracy=15:result=transforms.trf`, '-f', 'null', '-'],
      { duration: len, cwd: work, onProgress: (p) => report('تحليل الاهتزاز…', p * 0.5) });
    const outPath = derivedPath('stable', 'mp4');
    await ffmpeg([...seg, '-vf', `vidstabtransform=input=transforms.trf:smoothing=${smoothing}:optzoom=1:interpol=bicubic,unsharp=5:5:0.6:3:3:0.3`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', outPath],
    { duration: len, cwd: work, onProgress: (p) => report('تثبيت الفيديو…', 0.5 + p * 0.5) });
    return { path: outPath };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------- vocal / music separation ----------
let separationSession = null;
function decodeStereo(src, tin, len) {
  return new Promise((resolve, reject) => {
    const proc = track(spawn(ffmpegPath, ['-v', 'error', '-ss', tin.toFixed(3), '-t', len.toFixed(3), '-i', src, '-vn', '-ac', '2', '-ar', '44100', '-f', 'f32le', 'pipe:1'], { windowsHide: true }));
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error('تعذر قراءة الصوت'));
      const buf = Buffer.concat(chunks);
      const all = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
      const n = all.length / 2, l = new Float32Array(n), r = new Float32Array(n);
      for (let i = 0; i < n; i++) { l[i] = all[2 * i]; r[i] = all[2 * i + 1]; }
      resolve([l, r]);
    });
  });
}

function writeWav(file, [l, r], rate) {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

async function separateAudio({ path: src, in: tin, out: tout }, report) {
  const modelPath = path.join(app.getPath('userData'), 'models', 'uvr', 'Kim_Vocal_2.onnx');
  await download(SEPARATION_MODEL_URL, modelPath, (p) => report('تنزيل نموذج فصل الصوت (مرة واحدة)…', p));
  if (!separationSession) {
    const ort = require('onnxruntime-node');
    separationSession = await ort.InferenceSession.create(modelPath, { intraOpNumThreads: Math.max(1, os.cpus().length - 1) });
  }
  report('قراءة الصوت…', 0);
  const [l, r] = await decodeStereo(src, tin, tout - tin);
  const { separate, SAMPLE_RATE } = require('./separate.cjs');
  const res = await separate(separationSession, l, r, (p) => report('فصل الصوت البشري عن الموسيقى…', p), canceled);
  const vocals = derivedPath('vocals', 'wav'), music = derivedPath('music', 'wav');
  writeWav(vocals, res.vocals, SAMPLE_RATE);
  writeWav(music, res.music, SAMPLE_RATE);
  return { vocals, music };
}

// ---------- text to speech (Windows OneCore voices) ----------
const TTS_SCRIPT = String.raw`param([string]$Mode, [string]$TextFile, [string]$Voice, [double]$Rate, [double]$Pitch, [string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
if ($Mode -eq 'list') {
  [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object {
    [pscustomobject]@{ id = $_.Id; name = $_.DisplayName; lang = $_.Language; gender = [string]$_.Gender }
  } | ConvertTo-Json -Compress
  exit 0
}
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$text = [IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8)
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Id -eq $Voice } | Select-Object -First 1
if ($v) { $synth.Voice = $v }
$synth.Options.SpeakingRate = $Rate
$synth.Options.AudioPitch = $Pitch
$stream = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
$size = [uint32]$stream.Size
$null = Await ($reader.LoadAsync($size)) ([uint32])
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[IO.File]::WriteAllBytes($Out, $bytes)
`;

function powershell(args) {
  const script = path.join(cacheDir('scripts'), 'tts.ps1');
  fs.writeFileSync(script, '﻿' + TTS_SCRIPT, 'utf8');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

async function listVoices() {
  const out = await powershell(['-Mode', 'list']);
  const list = JSON.parse(out.trim() || '[]');
  return (Array.isArray(list) ? list : [list]).sort((a, b) => (b.lang.startsWith('ar') - a.lang.startsWith('ar')) || a.name.localeCompare(b.name));
}

async function tts({ text, voice, rate = 1, pitch = 1 }, report) {
  report('توليد الصوت…', 0.3);
  const textFile = path.join(cacheDir('job-tmp'), `tts-${Date.now()}.txt`);
  fs.writeFileSync(textFile, text, 'utf8');
  const out = derivedPath('speech', 'wav');
  try {
    await powershell(['-Mode', 'speak', '-TextFile', textFile, '-Voice', voice || '', '-Rate', String(rate), '-Pitch', String(pitch), '-Out', out]);
  } finally {
    fs.rmSync(textFile, { force: true });
  }
  return { path: out };
}

// ---------- short audio preview with effects applied ----------
async function previewAudio({ path: src, from, length = 8, clip }, report) {
  report('تجهيز المعاينة…', 0.2);
  const out = path.join(cacheDir('job-tmp'), `preview-${Date.now()}.wav`);
  const srcLen = length * (clip.speed || 1);
  await ffmpeg(['-ss', from.toFixed(3), '-t', srcLen.toFixed(3), '-i', src, '-vn', '-af', clipAudioChain({ ...clip, fadeIn: 0, fadeOut: 0 }, length), out]);
  return { path: out };
}

const KINDS = { removeBackground, stabilize, separate: separateAudio, tts, previewAudio };

async function run(kind, args, onProgress) {
  if (active) throw new Error('هناك عملية أخرى قيد التنفيذ');
  active = { procs: new Set(), canceled: false };
  const report = (label, progress) => onProgress({ kind, label, progress });
  try {
    return await KINDS[kind](args, report);
  } catch (e) {
    if (active && active.canceled) throw new Error('تم الإلغاء');
    throw e;
  } finally {
    active = null;
  }
}

function cancel() {
  if (!active) return;
  active.canceled = true;
  for (const p of active.procs) p.kill('SIGKILL');
}

module.exports = { run, cancel, listVoices };
