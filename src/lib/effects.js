// Filter ids must match FILTERS in electron/export.cjs; `css` is the live-preview approximation.
export const FILTERS = [
  { id: 'none', name: 'بدون', css: '' },
  { id: 'vivid', name: 'حيوي', css: 'saturate(1.5) contrast(1.1)' },
  { id: 'warm', name: 'دافئ', css: 'sepia(0.25) saturate(1.2)' },
  { id: 'cool', name: 'بارد', css: 'hue-rotate(12deg) saturate(1.1) brightness(1.02)' },
  { id: 'bw', name: 'أبيض وأسود', css: 'grayscale(1)' },
  { id: 'sepia', name: 'بني قديم', css: 'sepia(1)' },
  { id: 'vintage', name: 'كلاسيكي', css: 'sepia(0.45) contrast(1.1) saturate(0.9)' },
  { id: 'fade', name: 'باهت', css: 'contrast(0.85) brightness(1.05) saturate(0.8)' },
  { id: 'drama', name: 'درامي', css: 'contrast(1.35) saturate(0.9)' },
];

export function cssFilter(clip) {
  const f = FILTERS.find((x) => x.id === clip.filter);
  const a = clip.adjust || {};
  const parts = [f ? f.css : ''];
  if (a.brightness) parts.push(`brightness(${(1 + a.brightness * 0.5).toFixed(2)})`);
  if ((a.contrast ?? 1) !== 1) parts.push(`contrast(${a.contrast})`);
  if ((a.saturation ?? 1) !== 1) parts.push(`saturate(${a.saturation})`);
  return parts.filter(Boolean).join(' ') || 'none';
}

// Values are FFmpeg xfade transition names.
export const TRANSITIONS = [
  { id: 'none', name: 'بدون' },
  { id: 'fade', name: 'تلاشي' },
  { id: 'dissolve', name: 'ذوبان' },
  { id: 'fadeblack', name: 'تلاشي للأسود' },
  { id: 'fadewhite', name: 'تلاشي للأبيض' },
  { id: 'wipeleft', name: 'مسح لليسار' },
  { id: 'wiperight', name: 'مسح لليمين' },
  { id: 'slideleft', name: 'انزلاق لليسار' },
  { id: 'slideright', name: 'انزلاق لليمين' },
  { id: 'circleopen', name: 'دائرة تتسع' },
  { id: 'circleclose', name: 'دائرة تضيق' },
  { id: 'radial', name: 'دوران' },
  { id: 'smoothleft', name: 'ناعم لليسار' },
  { id: 'pixelize', name: 'بكسلة' },
  { id: 'zoomin', name: 'تكبير' },
];

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
