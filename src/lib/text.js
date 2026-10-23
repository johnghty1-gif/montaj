export const FONTS = [
  { id: 'Cairo', name: 'القاهرة (Cairo)' },
  { id: 'Tajawal', name: 'تجوال (Tajawal)' },
  { id: 'Amiri', name: 'أميري (Amiri)' },
  { id: 'Lalezar', name: 'لاله‌زار (Lalezar)' },
];

export const TEXT_PRESETS = [
  { name: 'عنوان', style: { size: 110, weight: 800, color: '#ffffff', stroke: '#000000', strokeWidth: 6, bg: '' } },
  { name: 'نص عادي', style: { size: 64, weight: 600, color: '#ffffff', stroke: '#000000', strokeWidth: 3, bg: '' } },
  { name: 'شريط أسود', style: { size: 56, weight: 700, color: '#ffffff', stroke: '', strokeWidth: 0, bg: 'rgba(0,0,0,0.65)' } },
  { name: 'أصفر بارز', style: { size: 80, weight: 800, color: '#ffd60a', stroke: '#000000', strokeWidth: 6, bg: '' } },
  { name: 'خط أميري', style: { size: 84, weight: 700, font: 'Amiri', color: '#ffffff', stroke: '#3a2a10', strokeWidth: 4, bg: '' } },
];

export const CAPTION_STYLE = {
  size: 54, weight: 700, color: '#ffffff', stroke: '#000000', strokeWidth: 4,
  bg: 'rgba(0,0,0,0.55)', x: 0.5, y: 0.85, animation: 'none', isCaption: true, font: 'Cairo',
};

export function fontCss(t, px) {
  return `${t.weight || 700} ${px}px "${t.font || 'Cairo'}"`;
}

export async function ensureFonts(texts) {
  const wanted = new Set(texts.map((t) => `${t.weight || 700} 40px "${t.font || 'Cairo'}"`));
  await Promise.all([...wanted].map((f) => document.fonts.load(f, 'أب').catch(() => {})));
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

// Draws one text clip onto a canvas of size w×h. Font size is defined for a 1080px short side.
// Used for both the live preview and the exported PNG overlays, so they match.
export function drawText(ctx, t, w, h, alpha = 1) {
  const px = t.size * (Math.min(w, h) / 1080);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = fontCss(t, px);
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, t.text, w * 0.9);
  const lh = px * 1.35;
  const cx = t.x * w;
  const top = t.y * h - (lines.length * lh) / 2;
  let box = null;
  if (t.bg) {
    const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const pad = px * 0.35;
    box = { x: cx - maxW / 2 - pad, y: top - pad * 0.4, w: maxW + pad * 2, h: lines.length * lh + pad * 0.8 };
    ctx.fillStyle = t.bg;
    const r = Math.min(px * 0.3, box.h / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, r); else ctx.rect(box.x, box.y, box.w, box.h);
    ctx.fill();
  }
  lines.forEach((line, i) => {
    const y = top + lh * (i + 0.5);
    if (t.stroke && t.strokeWidth) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = t.strokeWidth * (px / 60) * 2;
      ctx.strokeStyle = t.stroke;
      ctx.strokeText(line, cx, y);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(line, cx, y);
  });
  ctx.restore();
  const maxW = Math.max(...lines.map((l) => { ctx.font = fontCss(t, px); return ctx.measureText(l).width; }));
  return box || { x: cx - maxW / 2, y: top, w: maxW, h: lines.length * lh };
}

export function renderTextPng(t, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  drawText(c.getContext('2d'), t, w, h);
  return c.toDataURL('image/png');
}

export function textAlpha(t, time) {
  if (t.animation !== 'fade') return 1;
  const fd = Math.min(0.3, t.duration / 3);
  const local = time - t.start;
  if (local < fd) return Math.max(0, local / fd);
  if (local > t.duration - fd) return Math.max(0, (t.duration - local) / fd);
  return 1;
}
