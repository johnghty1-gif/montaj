const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ffmpegPath, cacheDir } = require('./media.cjs');

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

function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}

function buildArgs(job, tmp) {
  const { width: W, height: H, fps, clips, audio = [], overlays = [] } = job;
  if (!clips.length) throw new Error('أضف مقطعًا واحدًا على الأقل إلى المسار الرئيسي');
  const args = ['-y', '-hide_banner'];
  const filters = [];
  let idx = 0;

  const durs = clips.map((c) => (c.out - c.in) / c.speed);

  clips.forEach((c, i) => {
    const len = c.out - c.in;
    if (c.type === 'image') args.push('-loop', '1', '-t', len.toFixed(3), '-i', c.path);
    else args.push('-ss', c.in.toFixed(3), '-t', len.toFixed(3), '-i', c.path);
    const n = idx++;
    // Color filters run before scale/pad so the letterbox bars stay black.
    const vf = [`setpts=(PTS-STARTPTS)/${c.speed}`, 'format=yuv420p'];
    if (FILTERS[c.filter]) vf.push(FILTERS[c.filter]);
    const adj = c.adjust || {};
    if (adj.brightness || (adj.contrast ?? 1) !== 1 || (adj.saturation ?? 1) !== 1) {
      vf.push(`eq=brightness=${((adj.brightness || 0) * 0.25).toFixed(3)}:contrast=${(adj.contrast ?? 1).toFixed(3)}:saturation=${(adj.saturation ?? 1).toFixed(3)}`);
    }
    vf.push(
      `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`,
      'setsar=1', `fps=${fps}`, 'format=yuv420p', 'settb=AVTB',
    );
    filters.push(`[${n}:v]${vf.join(',')}[v${i}]`);
    if (c.type === 'video' && c.hasAudio && !c.muted) {
      filters.push(`[${n}:a]asetpts=PTS-STARTPTS,${atempoChain(c.speed)},volume=${c.volume ?? 1},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${durs[i].toFixed(3)}[a${i}]`);
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${durs[i].toFixed(3)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    }
  });

  // Join the main track: xfade/acrossfade where a transition is set, plain concat otherwise.
  let curV = 'v0', curA = 'a0', total = durs[0];
  for (let i = 1; i < clips.length; i++) {
    const t = clips[i - 1].transition;
    const td = t && t.type !== 'none' ? Math.min(t.duration, durs[i - 1] / 2, durs[i] / 2) : 0;
    const nv = `vj${i}`, na = `aj${i}`;
    if (td > 0.05) {
      filters.push(`[${curV}][v${i}]xfade=transition=${t.type}:duration=${td.toFixed(3)}:offset=${(total - td).toFixed(3)}[${nv}]`);
      filters.push(`[${curA}][a${i}]acrossfade=d=${td.toFixed(3)}[${na}]`);
      total += durs[i] - td;
    } else {
      filters.push(`[${curV}][${curA}][v${i}][a${i}]concat=n=2:v=1:a=1[${nv}][${na}]`);
      total += durs[i];
    }
    curV = nv; curA = na;
  }

  // Text and caption overlays are pre-rendered PNGs (the renderer shapes Arabic text correctly).
  overlays.forEach((o, i) => {
    const png = path.join(tmp, `ov${i}.png`);
    fs.writeFileSync(png, Buffer.from(o.png.split(',')[1], 'base64'));
    args.push('-loop', '1', '-t', total.toFixed(3), '-i', png);
    const n = idx++;
    let chain = `[${n}:v]format=rgba`;
    if (o.fade) {
      const fd = Math.min(0.3, (o.end - o.start) / 3).toFixed(3);
      chain += `,fade=t=in:st=${o.start.toFixed(3)}:d=${fd}:alpha=1,fade=t=out:st=${(o.end - fd).toFixed(3)}:d=${fd}:alpha=1`;
    }
    filters.push(`${chain}[ov${i}]`);
    const nv = `vo${i}`;
    filters.push(`[${curV}][ov${i}]overlay=0:0:enable='between(t,${o.start.toFixed(3)},${o.end.toFixed(3)})':eof_action=pass[${nv}]`);
    curV = nv;
  });

  // Extra audio track (music, voiceover).
  const mixIns = [`[${curA}]`];
  audio.forEach((a, i) => {
    if (a.start >= total) return;
    const len = Math.min(a.out - a.in, total - a.start);
    args.push('-ss', a.in.toFixed(3), '-t', len.toFixed(3), '-i', a.path);
    const n = idx++;
    const ms = Math.round(a.start * 1000);
    filters.push(`[${n}:a]asetpts=PTS-STARTPTS,volume=${a.volume ?? 1},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${ms}|${ms}[ax${i}]`);
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
    '-t', total.toFixed(3), '-progress', 'pipe:1', '-nostats', job.outPath,
  );
  return { args, total };
}

function run(job, onProgress) {
  return new Promise((resolve, reject) => {
    const tmp = fs.mkdtempSync(path.join(cacheDir('export-tmp'), 'job-'));
    let built;
    try { built = buildArgs(job, tmp); } catch (e) { reject(e); return; }
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

module.exports = { run, cancel, buildArgs };
