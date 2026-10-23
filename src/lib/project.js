export const uid = () => Math.random().toString(36).slice(2, 10);

export const ASPECTS = {
  '16:9': { label: 'أفقي 16:9 (يوتيوب)', w: 1920, h: 1080 },
  '9:16': { label: 'عمودي 9:16 (تيك توك / ريلز)', w: 1080, h: 1920 },
  '1:1': { label: 'مربع 1:1 (إنستغرام)', w: 1080, h: 1080 },
  '4:5': { label: 'عمودي 4:5', w: 1080, h: 1350 },
};

// Track keys in the project. `main` is magnetic; the others hold freely positioned clips.
export const TRACKS = ['text', 'layers', 'main', 'audio'];

export function emptyProject() {
  return {
    version: 2,
    settings: { aspect: '16:9', fps: 30 },
    media: [],
    main: [],
    layers: [],
    audio: [],
    text: [],
  };
}

const AUDIO_DEFAULTS = { volume: 1, muted: false, fadeIn: 0, fadeOut: 0, audioFx: 'none', speed: 1 };
const LOOK_DEFAULTS = { filter: 'none', adjust: { brightness: 0, contrast: 1, saturation: 1 } };
const TRANSFORM_DEFAULTS = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, kf: {} };

// Fills fields added in later versions so older .montaj files keep working.
export function migrate(p) {
  const base = { ...emptyProject(), ...p, settings: { ...emptyProject().settings, ...(p.settings || {}) } };
  return {
    ...base,
    version: 2,
    main: base.main.map((c) => ({ ...AUDIO_DEFAULTS, ...LOOK_DEFAULTS, transition: { type: 'none', duration: 0.5 }, ...c })),
    layers: base.layers.map((c) => ({ ...AUDIO_DEFAULTS, ...LOOK_DEFAULTS, ...TRANSFORM_DEFAULTS, scale: 0.5, ...c })),
    audio: base.audio.map((c) => ({ ...AUDIO_DEFAULTS, ...c })),
    text: base.text.map((c) => ({ kind: 'text', ...TRANSFORM_DEFAULTS, ...c })),
  };
}

export const clipDuration = (c) => (c.out - c.in) / (c.speed || 1);

// Timeline duration of any clip on any track.
export const spanOf = (kind, c) => (kind === 'text' ? c.duration : clipDuration(c));

export function transitionLen(project, i) {
  const a = project.main[i], b = project.main[i + 1];
  if (!a || !b || !a.transition || a.transition.type === 'none') return 0;
  return Math.min(a.transition.duration, clipDuration(a) / 2, clipDuration(b) / 2);
}

// Timeline start of each main-track clip (the main track is magnetic: clips sit back to back, transitions overlap).
export function mainLayout(project) {
  let t = 0;
  return project.main.map((c, i) => {
    const start = t;
    const dur = clipDuration(c);
    t += dur - transitionLen(project, i);
    return { clip: c, start, end: start + dur, index: i };
  });
}

export function mainEnd(project) {
  const lay = mainLayout(project);
  return lay.length ? lay[lay.length - 1].end : 0;
}

export function totalDuration(project) {
  const ends = [mainEnd(project)];
  for (const k of ['layers', 'audio', 'text']) for (const c of project[k]) ends.push(c.start + spanOf(k, c));
  return Math.max(0, ...ends);
}

// Where a clip sits on the timeline, for any track.
export function clipStart(project, kind, id) {
  if (kind === 'main') return mainLayout(project).find((l) => l.clip.id === id)?.start ?? 0;
  return project[kind].find((c) => c.id === id)?.start ?? 0;
}

export function newMainClip(m) {
  return {
    id: uid(), mediaId: m.id, in: 0, out: m.duration, ...AUDIO_DEFAULTS, ...LOOK_DEFAULTS,
    adjust: { ...LOOK_DEFAULTS.adjust }, transition: { type: 'none', duration: 0.5 },
  };
}

export function newLayerClip(m, start) {
  return {
    id: uid(), mediaId: m.id, start, in: 0, out: m.duration, ...AUDIO_DEFAULTS, ...LOOK_DEFAULTS,
    adjust: { ...LOOK_DEFAULTS.adjust }, ...TRANSFORM_DEFAULTS, kf: {}, scale: 0.5, x: 0.7, y: 0.3,
  };
}

export function newAudioClip(m, start, extra = {}) {
  return { id: uid(), mediaId: m.id, start, in: 0, out: m.duration, ...AUDIO_DEFAULTS, ...extra };
}

export function newTextClip(start, preset = {}) {
  return {
    id: uid(), kind: 'text', start, duration: 3, text: 'اكتب نصك هنا',
    font: 'Cairo', size: 72, weight: 700, color: '#ffffff', stroke: '#000000', strokeWidth: 4,
    bg: '', animation: 'fade', isCaption: false, ...TRANSFORM_DEFAULTS, kf: {},
    ...preset,
  };
}

export function newSticker(start, emoji) {
  return newTextClip(start, {
    kind: 'sticker', text: emoji, font: 'Segoe UI Emoji', size: 220, weight: 400, stroke: '', strokeWidth: 0,
    bg: '', animation: 'none', x: 0.5, y: 0.5,
  });
}

// ---------- undo / redo ----------
export function historyInit(project) {
  return { past: [], present: project, future: [], dirty: false };
}

export function historyReducer(state, action) {
  switch (action.type) {
    case 'set': {
      const next = typeof action.update === 'function' ? action.update(state.present) : action.update;
      if (next === state.present) return state;
      if (action.transient) return { ...state, present: next, dirty: true };
      return { past: [...state.past.slice(-99), action.base || state.present], present: next, future: [], dirty: true };
    }
    case 'commit':
      // Ends a drag: record the pre-drag project once, after transient updates.
      if (!action.base || action.base === state.present) return state;
      return { past: [...state.past.slice(-99), action.base], present: state.present, future: [], dirty: true };
    case 'undo':
      if (!state.past.length) return state;
      return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future], dirty: true };
    case 'redo':
      if (!state.future.length) return state;
      return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1), dirty: true };
    case 'load':
      return historyInit(migrate(action.project));
    case 'saved':
      return { ...state, dirty: false };
    default:
      return state;
  }
}
