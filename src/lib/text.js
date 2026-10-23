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

export const STICKERS = [
  { name: 'وجوه', items: ['😀', '😂', '🥹', '😍', '😎', '🤩', '😮', '😢', '😡', '🤔', '🥳', '😴', '🤯', '🫡', '🤫', '😇'] },
  { name: 'رموز', items: ['❤️', '🔥', '⭐', '✨', '💯', '✅', '❌', '⚡', '💥', '🎉', '👏', '👍', '👎', '🙏', '💪', '👀'] },
  { name: 'أسهم وإشارات', items: ['⬅️', '➡️', '⬆️', '⬇️', '↗️', '🔄', '📍', '🔔', '📢', '❓', '❗', '⚠️', '🆕', '🔝', '🎯', '💬'] },
  { name: 'مناسبات', items: ['🌙', '🕌', '🏮', '🎁', '🎂', '🎈', '🎊', '🪔', '🌟', '💐', '🕋', '📿', '☕', '🍰', '🎆', '🎇'] },
  { name: 'متنوع', items: ['🎬', '🎥', '📸', '🎵', '🎧', '🎮', '⚽', '🚗', '✈️', '🌍', '☀️', '🌈', '🌊', '🌸', '🍕', '💡'] },
];

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

// Lays out a text clip for a frame of size w×h. Font size is defined for a 1080px short side.
function layout(ctx, t, w, h) {
  const px = t.size * (Math.min(w, h) / 1080);
  ctx.font = fontCss(t, px);
  const lines = wrap(ctx, t.text, w * 0.9);
  const lh = px * 1.35;
  const textW = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const pad = t.bg ? px * 0.35 : 0;
  const stroke = t.stroke && t.strokeWidth ? t.strokeWidth * (px / 60) * 2 : 0;
  const boxW = textW + pad * 2 + stroke, boxH = lines.length * lh + pad * 0.8 + stroke;
  return { px, lines, lh, pad, boxW, boxH };
}

// Draws the text block centred on (cx, cy) in the current transform.
function drawBlock(ctx, t, L) {
  ctx.font = fontCss(t, L.px);
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (t.bg) {
    const bw = L.boxW, bh = L.lines.length * L.lh + L.pad * 0.8;
    ctx.fillStyle = t.bg;
    const r = Math.min(L.px * 0.3, bh / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-bw / 2, -bh / 2, bw, bh, r); else ctx.rect(-bw / 2, -bh / 2, bw, bh);
    ctx.fill();
  }
  const top = -(L.lines.length * L.lh) / 2;
  L.lines.forEach((line, i) => {
    const y = top + L.lh * (i + 0.5);
    if (t.stroke && t.strokeWidth) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = t.strokeWidth * (L.px / 60) * 2;
      ctx.strokeStyle = t.stroke;
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(line, 0, y);
  });
}

// Preview drawing on a w×h canvas with the clip's (possibly animated) transform `tr`.
// Returns the unrotated bounding box in canvas pixels, for hit testing.
export function drawText(ctx, t, w, h, tr, alpha = 1) {
  ctx.save();
  const L = layout(ctx, t, w, h);
  const cx = tr.x * w, cy = tr.y * h;
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha * tr.opacity));
  ctx.translate(cx, cy);
  ctx.rotate((tr.rotation * Math.PI) / 180);
  ctx.scale(tr.scale, tr.scale);
  drawBlock(ctx, t, L);
  ctx.restore();
  const bw = L.boxW * tr.scale, bh = L.boxH * tr.scale;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

// Export: renders the text tightly at scale 1 for a W×H frame; FFmpeg positions, scales and rotates it.
export function renderTextLayer(t, W, H) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const L = layout(ctx, t, W, H);
  c.width = Math.ceil(L.boxW + 8); c.height = Math.ceil(L.boxH + 8);
  ctx.translate(c.width / 2, c.height / 2);
  drawBlock(ctx, t, L);
  return { png: c.toDataURL('image/png'), w: c.width, h: c.height };
}

export function textAlpha(t, time) {
  if (t.animation !== 'fade') return 1;
  const fd = Math.min(0.3, t.duration / 3);
  const local = time - t.start;
  if (local < fd) return Math.max(0, local / fd);
  if (local > t.duration - fd) return Math.max(0, (t.duration - local) / fd);
  return 1;
}
