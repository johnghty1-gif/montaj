import { ASPECTS, mainLayout, clipDuration } from './project.js';
import { ensureFonts, renderTextLayer } from './text.js';
import { exportAnim } from './anim.js';

const even = (n) => Math.round(n / 2) * 2;

export function exportSize(project, res) {
  const a = ASPECTS[project.settings.aspect];
  const scale = res / Math.min(a.w, a.h);
  return { W: even(a.w * scale), H: even(a.h * scale) };
}

// Turns the project into the job electron/export.cjs renders. Text and stickers become PNGs here
// because the browser shapes Arabic text correctly.
export async function buildExportJob(project, mediaById, { outPath, res, fps, crf, preset }) {
  const { W, H } = exportSize(project, res);
  await ensureFonts(project.text);
  const clips = mainLayout(project).map(({ clip }) => {
    const m = mediaById[clip.mediaId];
    return { ...clip, path: m.path, type: m.type, hasAudio: m.hasAudio };
  });
  // Media layers first (bottom), then text and stickers on top, as in the preview.
  const layers = [];
  for (const c of project.layers) {
    const m = mediaById[c.mediaId];
    const fit = Math.min(W / (m.width || 1), H / (m.height || 1));
    layers.push({
      ...c, kind: m.type, path: m.path, hasAlpha: m.hasAlpha, hasAudio: m.hasAudio,
      end: c.start + clipDuration(c), baseW: (m.width || 1) * fit, baseH: (m.height || 1) * fit, anim: exportAnim(c, c.start),
    });
  }
  for (const t of project.text) {
    if (!t.text.trim()) continue;
    const r = renderTextLayer(t, W, H);
    layers.push({ kind: 'png', png: r.png, baseW: r.w, baseH: r.h, start: t.start, end: t.start + t.duration, fade: t.animation === 'fade', anim: exportAnim(t, t.start) });
  }
  const audio = project.audio.map((x) => ({ ...x, path: mediaById[x.mediaId].path }));
  return { outPath, width: W, height: H, fps, crf, preset, clips, audio, layers };
}
