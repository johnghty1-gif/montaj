// Keyframe animation for layers, text and stickers.
// clip.kf[prop] = [[localTime, value], ...] sorted by time; localTime is seconds from the clip's start.
// A property with no keyframes uses its static value clip[prop].

export const ANIM_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'];
const EPS = 1 / 60;

export function valueAt(clip, prop, local) {
  const k = clip.kf && clip.kf[prop];
  if (!k || !k.length) return clip[prop];
  if (local <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) {
    const [t0, v0] = k[i], [t1, v1] = k[i + 1];
    if (local < t1) return v0 + ((v1 - v0) * (local - t0)) / Math.max(1e-6, t1 - t0);
  }
  return k[k.length - 1][1];
}

export function transformAt(clip, local) {
  const out = {};
  for (const p of ANIM_PROPS) out[p] = valueAt(clip, p, local);
  return out;
}

export const hasKeyframes = (clip) => !!clip.kf && ANIM_PROPS.some((p) => clip.kf[p] && clip.kf[p].length);

// All distinct keyframe times of a clip (for timeline diamonds and navigation).
export function keyframeTimes(clip) {
  const ts = [];
  for (const p of ANIM_PROPS) for (const [t] of (clip.kf && clip.kf[p]) || []) if (!ts.some((x) => Math.abs(x - t) < EPS)) ts.push(t);
  return ts.sort((a, b) => a - b);
}

function upsert(list, t, v) {
  const next = (list || []).filter(([kt]) => Math.abs(kt - t) >= EPS);
  next.push([t, v]);
  return next.sort((a, b) => a[0] - b[0]);
}

// Apply a property change at the playhead. Animated properties get a keyframe; static ones change directly.
export function setAnimated(clip, patch, local) {
  const next = { ...clip, kf: { ...(clip.kf || {}) } };
  for (const [p, v] of Object.entries(patch)) {
    if (ANIM_PROPS.includes(p) && next.kf[p] && next.kf[p].length) next.kf[p] = upsert(next.kf[p], local, v);
    else next[p] = v;
  }
  return next;
}

export const isKeyframeAt = (clip, local) => keyframeTimes(clip).some((t) => Math.abs(t - local) < EPS);

// Toggle a keyframe for every animatable property at the playhead.
export function toggleKeyframe(clip, local) {
  const kf = { ...(clip.kf || {}) };
  if (isKeyframeAt(clip, local)) {
    for (const p of ANIM_PROPS) {
      if (!kf[p]) continue;
      kf[p] = kf[p].filter(([t]) => Math.abs(t - local) >= EPS);
      if (!kf[p].length) delete kf[p];
    }
    // When the last keyframe goes, keep the value it showed as the static value.
    const next = { ...clip, kf };
    for (const p of ANIM_PROPS) if (!kf[p] && clip.kf && clip.kf[p]) next[p] = valueAt(clip, p, local);
    return next;
  }
  for (const p of ANIM_PROPS) kf[p] = upsert(kf[p], local, valueAt(clip, p, local));
  return { ...clip, kf };
}

export function clearKeyframes(clip, local) {
  const next = { ...clip, kf: {} };
  for (const p of ANIM_PROPS) next[p] = valueAt(clip, p, local);
  return next;
}

// Shift or trim keyframes when a clip is split at local time `cut`.
export function splitKeyframes(clip, cut) {
  const a = {}, b = {};
  for (const p of ANIM_PROPS) {
    const k = clip.kf && clip.kf[p];
    if (!k || !k.length) continue;
    const at = valueAt(clip, p, cut);
    a[p] = upsert(k.filter(([t]) => t < cut), cut, at);
    b[p] = upsert(k.filter(([t]) => t > cut).map(([t, v]) => [t - cut, v]), 0, at);
  }
  return [a, b];
}

// Absolute-time keyframes for export: number when static, [[t, v], ...] when animated.
export function exportAnim(clip, start) {
  const out = {};
  for (const p of ANIM_PROPS) {
    const k = clip.kf && clip.kf[p];
    out[p] = k && k.length > 1 ? k.map(([t, v]) => [start + t, v]) : k && k.length === 1 ? k[0][1] : clip[p];
  }
  return out;
}

// Ready-made motion presets, written as keyframes over the clip's duration.
export const MOTION_PRESETS = [
  { id: 'zoomIn', name: 'تكبير تدريجي', make: (c, d) => ({ scale: [[0, c.scale * 0.8], [d, c.scale * 1.15]] }) },
  { id: 'zoomOut', name: 'تصغير تدريجي', make: (c, d) => ({ scale: [[0, c.scale * 1.2], [d, c.scale * 0.9]] }) },
  { id: 'slideIn', name: 'دخول من اليمين', make: (c, d) => ({ x: [[0, 1.3], [Math.min(0.6, d / 2), c.x]] }) },
  { id: 'slideUp', name: 'صعود من الأسفل', make: (c, d) => ({ y: [[0, 1.2], [Math.min(0.6, d / 2), c.y]] }) },
  { id: 'spin', name: 'دوران', make: (c, d) => ({ rotation: [[0, 0], [d, 360]] }) },
  { id: 'pop', name: 'قفزة', make: (c, d) => ({ scale: [[0, 0], [Math.min(0.25, d / 4), c.scale * 1.15], [Math.min(0.4, d / 3), c.scale]] }) },
  { id: 'fadeInOut', name: 'ظهور واختفاء', make: (c, d) => ({ opacity: [[0, 0], [Math.min(0.5, d / 4), 1], [Math.max(d - 0.5, (3 * d) / 4), 1], [d, 0]] }) },
];
