const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ffmpegPath, cacheDir } = require('./media.cjs');
const { clipAudioChain } = require('./audiofx.cjs');

// Must stay in sync with the ids in src/lib/effects.js (the renderer holds the CSS preview equivalents).
const FILTERS = {
  none: '',
  bw: 'hue=s=0',
  warm: 'colorbalance=rs=0.12:gs=0.02:bs=-0.12',
  cool: 'colorbalance=rs=-0.1:gs=0:bs=0.12',
  vintage: 'curves=preset=vintage',
  vivid: 'eq=saturation=1.5:contrast=1.1',
  fade: 'eq=contrast=0.85:brightness=0.05:saturation=0.8',
  drama: 'eq=contrast=1.35:saturation=0.9',
  sepia: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
};

let current = null;

const f3 = (n) => Number(n).toFixed(3);

function colorChain(c) {
  const out = [];
  if (FILTERS[c.filter]) out.push(FILTERS[c.filter]);
  const adj = c.adjust || {};
  if (adj.brightness || (adj.contrast ?? 1) !== 1 || (adj.saturation ?? 1) !== 1) {
    out.push(`eq=brightness=${f3((adj.brightness || 0) * 0.25)}:contrast=${f3(adj.contrast ?? 1)}:saturation=${f3(adj.saturation ?? 1)}`);
  }
  return out;
}

// Piecewise-linear keyframe expression in the time variable `tv` (absolute timeline seconds).
// `v` is either a number or [[time, value], ...].
function animExpr(v, tv = 't') {
  if (!Array.isArray(v)) return f3(v);
  const k = [...v].sort((a, b) => a[0] - b[0]);
  if (k.length === 1) return f3(k[0][1]);
  let e = f3(k[k.length - 1][1]);
  for (let i = k.length - 2; i >= 0; i--) {
    const [t0, v0] = k[i], [t1, v1] = k[i + 1];
    const seg = t1 - t0 > 1e-6 ? `${f3(v0)}+(${f3(v1 - v0)})*(${tv}-${f3(t0)})/${f3(t1 - t0)}` : f3(v1);
    e = `if(lt(${tv},${f3(t1)}),${seg},${e})`;
  }
  return `if(lt(${tv},${f3(k[0][0])}),${f3(k[0][1])},${e})`;
}
const isAnimated = (v) => Array.isArray(v) && v.length > 1;
const maxOf = (v) => (Array.isArray(v) ? Math.max(...v.map((k) => k[1])) : v);

function buildArgs(job, tmp) {
  const { width: W, height: H, fps, clips, audio = [], layers = [] } = job;
  if (!clips.length) throw new Error('أضف مقطعًا واحدًا على الأقل إلى المسار الرئيسي');
  const args = ['-y', '-hide_banner'];
  const filters = [];
  let idx = 0;
  const durs = clips.map((c) => (c.out - c.in) / c.speed);

  // ---------- main track ----------
  clips.forEach((c, i) => {
    const len = c.out - c.in;
    if (c.type === 'image') args.push('-loop', '1', '-t', f3(len), '-i', c.path);
    else args.push('-ss', f3(c.in), '-t', f3(len), '-i', c.path);
    const n = idx++;
    // Color filters run before scale/pad so the letterbox bars stay black.
    const vf = [`setpts=(PTS-STARTPTS)/${c.speed}`, 'format=yuv420p', ...colorChain(c),
      `scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`,
      'setsar=1', `fps=${fps}`, 'format=yuv420p', 'settb=AVTB'];
    filters.push(`[${n}:v]${vf.join(',')}[v${i}]`);
    if (c.type === 'video' && c.hasAudio && !c.muted) {
      filters.push(`[${n}:a]${clipAudioChain(c, durs[i])},apad,atrim=0:${f3(durs[i])}[a${i}]`);
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${f3(durs[i])},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    }
  });

  let curV = 'v0', curA = 'a0', total = durs[0];
  for (let i = 1; i < clips.length; i++) {
    const t = clips[i - 1].transition;
    const td = t && t.type !== 'none' ? Math.min(t.duration, durs[i - 1] / 2, durs[i] / 2) : 0;
    const nv = `vj${i}`, na = `aj${i}`;
    if (td > 0.05) {
      filters.push(`[${curV}][v${i}]xfade=transition=${t.type}:duration=${f3(td)}:offset=${f3(total - td)}[${nv}]`);
      filters.push(`[${curA}][a${i}]acrossfade=d=${f3(td)}[${na}]`);
      total += durs[i] - td;
    } else {
      filters.push(`[${curV}][${curA}][v${i}][a${i}]concat=n=2:v=1:a=1[${nv}][${na}]`);
      total += durs[i];
    }
    curV = nv; curA = na;
  }

  const mixIns = [`[${curA}]`];

  // ---------- layers (picture-in-picture media, cutouts, stickers, text), bottom to top ----------
  layers.forEach((L, i) => {
    if (L.start >= total) return;
    const end = Math.min(L.end, total);
    let n;
    if (L.kind === 'png') {
      const png = path.join(tmp, `layer${i}.png`);
      fs.writeFileSync(png, Buffer.from(L.png.split(',')[1], 'base64'));
      args.push('-loop', '1', '-t', f3(total), '-i', png);
      n = idx++;
    } else if (L.kind === 'image') {
      args.push('-loop', '1', '-t', f3(total), '-i', L.path);
      n = idx++;
    } else {
      const len = Math.min(L.out - L.in, (end - L.start) * L.speed);
      // FFmpeg's built-in VP9 decoder drops transparency; libvpx keeps it.
      if (L.hasAlpha) args.push('-c:v', 'libvpx-vp9');
      args.push('-ss', f3(L.in), '-t', f3(len), '-i', L.path);
      n = idx++;
      if (L.hasAudio && !L.muted) {
        const dur = len / L.speed;
        const ms = Math.round(L.start * 1000);
        filters.push(`[${n}:a]${clipAudioChain(L, dur)},adelay=${ms}|${ms}[la${i}]`);
        mixIns.push(`[la${i}]`);
      }
    }

    const chain = [];
    if (L.kind === 'video') chain.push(`setpts=(PTS-STARTPTS)/${L.speed}+${f3(L.start)}/TB`);
    chain.push('format=rgba', ...colorChain(L));
    const a = L.anim;
    const bw = Math.max(2, Math.round(L.baseW)), bh = Math.max(2, Math.round(L.baseH));
    if (isAnimated(a.scale)) {
      const s = animExpr(a.scale);
      chain.push(`scale=w='max(2,trunc(${bw}*(${s})/2)*2)':h='max(2,trunc(${bh}*(${s})/2)*2)':eval=frame`);
    } else {
      const s = maxOf(a.scale);
      chain.push(`scale=${Math.max(2, Math.round((bw * s) / 2) * 2)}:${Math.max(2, Math.round((bh * s) / 2) * 2)}`);
    }
    if (isAnimated(a.rotation) || Math.abs(maxOf(a.rotation)) > 0.01) {
      const d = Math.ceil(Math.hypot(bw, bh) * Math.max(0.01, maxOf(a.scale)) / 2) * 2 + 4;
      chain.push(`rotate=a='(${animExpr(a.rotation)})*PI/180':c=none:ow=${d}:oh=${d}`);
    }
    if (isAnimated(a.opacity)) {
      chain.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${animExpr(a.opacity, 'T')},0,1)'`);
    } else if (maxOf(a.opacity) < 0.999) {
      chain.push(`colorchannelmixer=aa=${f3(maxOf(a.opacity))}`);
    }
    if (L.fade) {
      const fd = Math.min(0.3, (end - L.start) / 3);
      chain.push(`fade=t=in:st=${f3(L.start)}:d=${f3(fd)}:alpha=1`, `fade=t=out:st=${f3(end - fd)}:d=${f3(fd)}:alpha=1`);
    }
    filters.push(`[${n}:v]${chain.join(',')}[ly${i}]`);
    const nv = `vl${i}`;
    filters.push(`[${curV}][ly${i}]overlay=x='(${animExpr(a.x)})*W-w/2':y='(${animExpr(a.y)})*H-h/2':enable='between(t,${f3(L.start)},${f3(end)})':eof_action=pass[${nv}]`);
    curV = nv;
  });

  // ---------- audio track ----------
  audio.forEach((c, i) => {
    if (c.start >= total || c.muted) return;
    const speed = c.speed || 1;
    const len = Math.min(c.out - c.in, (total - c.start) * speed);
    args.push('-ss', f3(c.in), '-t', f3(len), '-i', c.path);
    const n = idx++;
    const ms = Math.round(c.start * 1000);
    filters.push(`[${n}:a]${clipAudioChain(c, len / speed)},adelay=${ms}|${ms}[ax${i}]`);
    mixIns.push(`[ax${i}]`);
  });
  if (mixIns.length > 1) {
    filters.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
    curA = 'aout';
  }

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', `[${curV}]`, '-map', `[${curA}]`,
    '-c:v', 'libx264', '-preset', job.preset || 'medium', '-crf', String(job.crf ?? 20), '-pix_fmt', 'yuv420p',
    '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    '-t', f3(total), '-progress', 'pipe:1', '-nostats', job.outPath,
  );
  return { args, total };
}

function run(job, onProgress) {
  return new Promise((resolve, reject) => {
    const tmp = fs.mkdtempSync(path.join(cacheDir('export-tmp'), 'job-'));
    let built;
    try { built = buildArgs(job, tmp); } catch (e) { reject(e); return; }
    // Long filter graphs can exceed the Windows command-line limit, so pass the graph through a script file.
    const fcIndex = built.args.indexOf('-filter_complex');
    const scriptFile = path.join(tmp, 'graph.txt');
    fs.writeFileSync(scriptFile, built.args[fcIndex + 1]);
    built.args.splice(fcIndex, 2, '-filter_complex_script', scriptFile);
    const proc = spawn(ffmpegPath, built.args, { windowsHide: true });
    current = proc;
    let stderr = '';
    proc.stdout.on('data', (d) => {
      const m = /out_time_ms=(\d+)/.exec(d.toString());
      if (m) onProgress(Math.min(1, parseInt(m[1], 10) / 1e6 / built.total));
    });
    proc.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });
    proc.on('close', (code) => {
      current = null;
      fs.rmSync(tmp, { recursive: true, force: true });
      if (proc.__canceled) reject(new Error('تم إلغاء التصدير'));
      else if (code === 0) { onProgress(1); resolve(job.outPath); }
      else reject(new Error('فشل التصدير:\n' + stderr));
    });
  });
}

function cancel() {
  if (current) { current.__canceled = true; current.kill('SIGKILL'); }
}

module.exports = { run, cancel, buildArgs, animExpr };
