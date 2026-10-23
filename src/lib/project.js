export const uid = () => Math.random().toString(36).slice(2, 10);

export const ASPECTS = {
  '16:9': { label: 'أفقي 16:9 (يوتيوب)', w: 1920, h: 1080 },
  '9:16': { label: 'عمودي 9:16 (تيك توك / ريلز)', w: 1080, h: 1920 },
  '1:1': { label: 'مربع 1:1 (إنستغرام)', w: 1080, h: 1080 },
  '4:5': { label: 'عمودي 4:5', w: 1080, h: 1350 },
};

export function emptyProject() {
  return {
    version: 1,
    settings: { aspect: '16:9', fps: 30 },
    media: [],
    main: [],
    audio: [],
    text: [],
  };
}

export const clipDuration = (c) => (c.out - c.in) / c.speed;

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

export function totalDuration(project) {
  const lay = mainLayout(project);
  const mainEnd = lay.length ? lay[lay.length - 1].end : 0;
  const ends = [mainEnd, ...project.audio.map((a) => a.start + (a.out - a.in)), ...project.text.map((t) => t.start + t.duration)];
  return Math.max(0, ...ends);
}

export function mainEnd(project) {
  const lay = mainLayout(project);
  return lay.length ? lay[lay.length - 1].end : 0;
}

export function newMainClip(m) {
  return {
    id: uid(), mediaId: m.id, in: 0, out: m.duration, speed: 1, volume: 1, muted: false,
    filter: 'none', adjust: { brightness: 0, contrast: 1, saturation: 1 },
    transition: { type: 'none', duration: 0.5 },
  };
}

export function newAudioClip(m, start) {
  return { id: uid(), mediaId: m.id, start, in: 0, out: m.duration, volume: 1 };
}

export function newTextClip(start, preset = {}) {
  return {
    id: uid(), start, duration: 3, text: 'اكتب نصك هنا',
    font: 'Cairo', size: 72, weight: 700, color: '#ffffff', stroke: '#000000', strokeWidth: 4,
    bg: '', x: 0.5, y: 0.5, animation: 'fade', isCaption: false,
    ...preset,
  };
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
      return historyInit(action.project);
    case 'saved':
      return { ...state, dirty: false };
    default:
      return state;
  }
}
