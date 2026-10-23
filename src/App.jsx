import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  emptyProject, historyInit, historyReducer, mainLayout, totalDuration, uid, spanOf, clipStart,
  newMainClip, newAudioClip, newTextClip, newLayerClip, newSticker,
} from './lib/project.js';
import { setAnimated, toggleKeyframe, clearKeyframes, splitKeyframes, MOTION_PRESETS } from './lib/anim.js';
import { applyTemplate } from './lib/templates.js';
import { buildExportJob } from './lib/exportJob.js';
import MediaPanel from './components/MediaPanel.jsx';
import Preview from './components/Preview.jsx';
import Timeline from './components/Timeline.jsx';
import Inspector from './components/Inspector.jsx';
import ExportDialog from './components/ExportDialog.jsx';
import CaptionsDialog from './components/CaptionsDialog.jsx';
import TTSDialog from './components/TTSDialog.jsx';
import JobOverlay from './components/JobOverlay.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';
import appIcon from '../build/icon.png';
import { fmt } from './lib/time.js';

const errText = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export default function App() {
  const [hist, dispatch] = useReducer(historyReducer, emptyProject(), historyInit);
  const project = hist.present;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState(null); // { kind: 'main'|'layers'|'audio'|'text'|'transition', id }
  const [filePath, setFilePath] = useState(null);
  const [dialog, setDialog] = useState(null); // { type: 'export'|'captions'|'tts', ... }
  const [job, setJob] = useState(null);
  const [toast, setToast] = useState(null);
  const [zoom, setZoom] = useState(60); // px per second
  const [importing, setImporting] = useState(false);

  const total = useMemo(() => totalDuration(project), [project]);
  const mediaById = useMemo(() => Object.fromEntries(project.media.map((m) => [m.id, m])), [project.media]);

  const update = useCallback((fn, opts = {}) => dispatch({ type: 'set', update: fn, ...opts }), []);
  const notify = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 4500); }, []);
  const projectRef = useRef(project);
  projectRef.current = project;

  // ---------- playback clock ----------
  const timeRef = useRef(time);
  timeRef.current = time;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf;
    const tick = (now) => {
      const next = timeRef.current + (now - last) / 1000;
      last = now;
      if (next >= total) { setTime(total); setPlaying(false); return; }
      setTime(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const togglePlay = useCallback(() => {
    if (!total) return;
    if (!playing && timeRef.current >= total - 0.05) setTime(0);
    setPlaying((p) => !p);
  }, [playing, total]);

  const seek = useCallback((t) => setTime(Math.max(0, Math.min(t, total))), [total]);

  // ---------- jobs ----------
  useEffect(() => window.api.onJobProgress((p) => setJob((j) => (j ? { ...j, label: p.label, progress: p.progress } : j))), []);
  const runJob = useCallback(async (title, kind, args) => {
    setPlaying(false);
    setJob({ title, label: null, progress: 0 });
    try {
      return await window.api.runJob(kind, args);
    } catch (e) {
      const msg = errText(e);
      notify(msg.includes('الإلغاء') ? 'تم الإلغاء' : `تعذر إكمال العملية: ${msg.slice(0, 200)}`);
      return null;
    } finally {
      setJob(null);
    }
  }, [notify]);

  // ---------- media ----------
  const probeMedia = useCallback(async (p) => ({ id: uid(), ...(await window.api.probe(p)) }), []);

  const importMedia = useCallback(async () => {
    const paths = await window.api.importMedia();
    if (!paths.length) return;
    setImporting(true);
    const added = [];
    for (const p of paths) {
      if (projectRef.current.media.some((m) => m.path === p)) continue;
      try { added.push(await probeMedia(p)); }
      catch (e) { notify(`تعذر استيراد ${p.split(/[\\/]/).pop()}: ${errText(e)}`); }
    }
    setImporting(false);
    if (added.length) update((pr) => ({ ...pr, media: [...pr.media, ...added] }));
  }, [update, notify, probeMedia]);

  const addToTimeline = useCallback((m, opts = {}) => {
    const start = opts.start ?? timeRef.current;
    if (opts.as === 'layer' && m.type !== 'audio') {
      const c = newLayerClip(m, start);
      update((pr) => ({ ...pr, layers: [...pr.layers, c] }));
      setSelection({ kind: 'layers', id: c.id });
    } else if (m.type === 'audio') {
      const c = newAudioClip(m, start);
      update((pr) => ({ ...pr, audio: [...pr.audio, c] }));
      setSelection({ kind: 'audio', id: c.id });
    } else {
      const clip = newMainClip(m);
      update((pr) => {
        const main = [...pr.main];
        main.splice(opts.index ?? main.length, 0, clip);
        return { ...pr, main };
      });
      setSelection({ kind: 'main', id: clip.id });
    }
  }, [update]);

  const removeMedia = useCallback((id) => {
    update((pr) => ({
      ...pr,
      media: pr.media.filter((m) => m.id !== id),
      main: pr.main.filter((c) => c.mediaId !== id),
      layers: pr.layers.filter((c) => c.mediaId !== id),
      audio: pr.audio.filter((c) => c.mediaId !== id),
    }));
  }, [update]);

  const addText = useCallback((preset) => {
    const t = newTextClip(timeRef.current, preset);
    update((pr) => ({ ...pr, text: [...pr.text, t] }));
    setSelection({ kind: 'text', id: t.id });
  }, [update]);

  const addSticker = useCallback((emoji) => {
    const t = newSticker(timeRef.current, emoji);
    update((pr) => ({ ...pr, text: [...pr.text, t] }));
    setSelection({ kind: 'text', id: t.id });
  }, [update]);

  const importSticker = useCallback(async () => {
    const paths = await window.api.importImages();
    const layers = [];
    const media = [];
    for (const p of paths) {
      try {
        const m = await probeMedia(p);
        media.push(m);
        layers.push({ ...newLayerClip(m, timeRef.current), out: 3, scale: 0.35, x: 0.5, y: 0.5 });
      } catch (e) { notify(errText(e)); }
    }
    if (!layers.length) return;
    update((pr) => ({ ...pr, media: [...pr.media, ...media], layers: [...pr.layers, ...layers] }));
    setSelection({ kind: 'layers', id: layers[layers.length - 1].id });
  }, [update, notify, probeMedia]);

  const onApplyTemplate = useCallback((tpl) => {
    update((pr) => applyTemplate(pr, tpl, MOTION_PRESETS));
    notify(`تم تطبيق قالب «${tpl.name}». يمكنك تعديل العناوين من الخط الزمني.`);
  }, [update, notify]);

  // ---------- editing ----------
  const splitAtPlayhead = useCallback(() => {
    const t = timeRef.current;
    const sel = selection;
    update((pr) => {
      if (sel && ['audio', 'text', 'layers'].includes(sel.kind)) {
        const key = sel.kind;
        const list = pr[key];
        const i = list.findIndex((c) => c.id === sel.id);
        if (i < 0) return pr;
        const c = list[i];
        const span = spanOf(key, c);
        if (t <= c.start + 0.05 || t >= c.start + span - 0.05) return pr;
        const local = t - c.start;
        let a, b;
        if (key === 'text') {
          a = { ...c, duration: local };
          b = { ...c, id: uid(), start: t, duration: c.duration - local };
        } else {
          const cut = c.in + local * (c.speed || 1);
          a = { ...c, out: cut, fadeOut: 0 };
          b = { ...c, id: uid(), start: t, in: cut, fadeIn: 0 };
        }
        if (key !== 'audio' && c.kf) {
          const [ka, kb] = splitKeyframes(c, local);
          a.kf = ka; b.kf = kb;
        }
        const next = [...list]; next.splice(i, 1, a, b);
        return { ...pr, [key]: next };
      }
      const item = mainLayout(pr).find((l) => t > l.start + 0.05 && t < l.end - 0.05);
      if (!item) return pr;
      const c = item.clip;
      const cut = c.in + (t - item.start) * c.speed;
      const a = { ...c, out: cut, fadeOut: 0, transition: { type: 'none', duration: c.transition.duration } };
      const b = { ...c, id: uid(), in: cut, fadeIn: 0 };
      const main = [...pr.main]; main.splice(item.index, 1, a, b);
      return { ...pr, main };
    });
  }, [selection, update]);

  const deleteClip = useCallback((kind, id) => {
    update((pr) => ({ ...pr, [kind]: pr[kind].filter((c) => c.id !== id) }));
    setSelection(null);
  }, [update]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    const { kind, id } = selection;
    if (kind === 'transition') {
      update((pr) => ({ ...pr, main: pr.main.map((c) => (c.id === id ? { ...c, transition: { ...c.transition, type: 'none' } } : c)) }));
      setSelection(null);
    } else deleteClip(kind, id);
  }, [selection, update, deleteClip]);

  const duplicateSelection = useCallback(() => {
    if (!selection || selection.kind === 'transition') return;
    const { kind, id } = selection;
    update((pr) => {
      const list = pr[kind];
      const i = list.findIndex((c) => c.id === id);
      if (i < 0) return pr;
      const c = list[i];
      const copy = { ...c, id: uid() };
      if (kind !== 'main') copy.start = c.start + spanOf(kind, c);
      const next = [...list]; next.splice(i + 1, 0, copy);
      return { ...pr, [kind]: next };
    });
  }, [selection, update]);

  // ---------- transform + keyframes ----------
  const mapClip = (kind, id, fn, opts) => update((pr) => ({ ...pr, [kind]: pr[kind].map((c) => (c.id === id ? fn(c) : c)) }), opts);

  const transform = useCallback((kind, id, patch, opts) => {
    mapClip(kind, id, (c) => setAnimated(c, patch, Math.max(0, timeRef.current - c.start)), opts);
  }, [update]);

  const toggleKf = useCallback((kind, id) => {
    mapClip(kind, id, (c) => toggleKeyframe(c, Math.max(0, timeRef.current - c.start)));
  }, [update]);

  const actions = {
    seek, addText, deleteClip,
    transform,
    toggleKeyframe: toggleKf,
    clearKeyframes: (kind, id) => mapClip(kind, id, (c) => clearKeyframes(c, Math.max(0, timeRef.current - c.start))),
    applyMotion: (kind, id, presetId) => mapClip(kind, id, (c) => {
      const preset = MOTION_PRESETS.find((m) => m.id === presetId);
      return { ...c, kf: { ...(c.kf || {}), ...preset.make(c, spanOf(kind, c)) } };
    }),

    detachAudio: (kind, id) => {
      const pr = projectRef.current;
      const c = pr[kind].find((x) => x.id === id);
      const a = newAudioClip(mediaById[c.mediaId], clipStart(pr, kind, id), {
        in: c.in, out: c.out, speed: c.speed, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut, audioFx: c.audioFx,
      });
      update((p) => ({ ...p, audio: [...p.audio, a], [kind]: p[kind].map((x) => (x.id === id ? { ...x, muted: true } : x)) }));
      setSelection({ kind: 'audio', id: a.id });
      notify('تم فصل الصوت إلى مسار الصوت. يمكنك الآن تعديله أو حذفه بشكل مستقل.');
    },

    separate: async (kind, id, mode) => {
      const c = projectRef.current[kind].find((x) => x.id === id);
      const m = mediaById[c.mediaId];
      const r = await runJob('عزل الصوت البشري عن الموسيقى', 'separate', { path: m.path, in: c.in, out: c.out });
      if (!r) return;
      const vm = { ...(await probeMedia(r.vocals)), name: `كلام — ${m.name}` };
      const mm = { ...(await probeMedia(r.music)), name: `موسيقى — ${m.name}` };
      const start = clipStart(projectRef.current, kind, id);
      const base = { speed: c.speed, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut };
      const make = (media) => newAudioClip(media, start, { ...base, out: media.duration });
      const added = mode === 'vocals' ? [make(vm)] : mode === 'music' ? [make(mm)] : [make(vm), make(mm)];
      update((p) => ({
        ...p,
        media: [...p.media, vm, mm],
        audio: [...(kind === 'audio' ? p.audio.filter((x) => x.id !== id) : p.audio), ...added],
        ...(kind !== 'audio' ? { [kind]: p[kind].map((x) => (x.id === id ? { ...x, muted: true } : x)) } : {}),
      }));
      setSelection({ kind: 'audio', id: added[0].id });
      notify(mode === 'both' ? 'تم فصل الكلام والموسيقى في مسارين.' : mode === 'vocals' ? 'تم إبقاء الكلام فقط.' : 'تم إبقاء الموسيقى فقط.');
    },

    removeBackground: async (kind, id) => {
      const c = projectRef.current[kind].find((x) => x.id === id);
      const m = mediaById[c.mediaId];
      const r = await runJob('إزالة الخلفية', 'removeBackground', { path: m.path, type: m.type, in: c.in, out: c.out, fps: projectRef.current.settings.fps });
      if (!r) return;
      const nm = { ...(await probeMedia(r.path)), name: `بدون خلفية — ${m.name}` };
      update((p) => ({
        ...p, media: [...p.media, nm],
        [kind]: p[kind].map((x) => (x.id === id ? { ...x, mediaId: nm.id, ...(m.type === 'video' ? { in: 0, out: nm.duration } : {}) } : x)),
      }));
      notify(kind === 'main' ? 'تمت إزالة الخلفية. في المسار الرئيسي تظهر الخلفية سوداء؛ انقل المقطع إلى «الطبقات» ليظهر فوق فيديو آخر.' : 'تمت إزالة الخلفية.');
    },

    stabilize: async (kind, id, strength) => {
      const c = projectRef.current[kind].find((x) => x.id === id);
      const m = mediaById[c.mediaId];
      const r = await runJob('تثبيت الفيديو', 'stabilize', { path: m.path, in: c.in, out: c.out, strength });
      if (!r) return;
      const nm = { ...(await probeMedia(r.path)), name: `ثابت — ${m.name}` };
      update((p) => ({ ...p, media: [...p.media, nm], [kind]: p[kind].map((x) => (x.id === id ? { ...x, mediaId: nm.id, in: 0, out: nm.duration } : x)) }));
      notify('تم تثبيت الفيديو.');
    },

    previewAudio: async (kind, id) => {
      const pr = projectRef.current;
      const c = pr[kind].find((x) => x.id === id);
      const start = clipStart(pr, kind, id);
      const sp = c.speed || 1;
      const local = timeRef.current >= start && timeRef.current < start + spanOf(kind, c) ? timeRef.current - start : 0;
      const from = c.in + local * sp;
      const length = Math.max(0.5, Math.min(8, (c.out - from) / sp));
      const r = await runJob('تجهيز معاينة التأثير', 'previewAudio', { path: mediaById[c.mediaId].path, from, length, clip: { speed: sp, audioFx: c.audioFx, volume: c.volume } });
      if (r) new Audio(window.api.mediaUrl(r.path)).play();
    },

    openTTS: (text, start) => setDialog({ type: 'tts', text, start }),
  };

  const createSpeech = useCallback(async ({ text, voice, rate, pitch }) => {
    const start = dialog.start ?? timeRef.current;
    setDialog(null);
    const r = await runJob('تحويل النص إلى كلام', 'tts', { text, voice, rate, pitch });
    if (!r) return;
    const m = { ...(await probeMedia(r.path)), name: `كلام: ${text.slice(0, 24)}` };
    const a = newAudioClip(m, start);
    update((p) => ({ ...p, media: [...p.media, m], audio: [...p.audio, a] }));
    setSelection({ kind: 'audio', id: a.id });
    notify('تمت إضافة الصوت إلى مسار الصوت.');
  }, [dialog, runJob, probeMedia, update, notify]);

  // ---------- project files ----------
  const confirmDiscard = () => !hist.dirty || window.confirm('هناك تغييرات غير محفوظة. هل تريد المتابعة دون حفظ؟');

  const saveProject = useCallback(async (saveAs = false) => {
    const p = await window.api.saveProject({ filePath, data: project, saveAs });
    if (p) { setFilePath(p); dispatch({ type: 'saved' }); notify('تم حفظ المشروع'); }
  }, [filePath, project, notify]);

  const openProject = useCallback(async () => {
    if (!confirmDiscard()) return;
    const r = await window.api.openProject();
    if (!r) return;
    dispatch({ type: 'load', project: r.data });
    setFilePath(r.filePath); setSelection(null); setTime(0); setPlaying(false);
  }, [hist.dirty]);

  const newProject = useCallback(() => {
    if (!confirmDiscard()) return;
    dispatch({ type: 'load', project: emptyProject() });
    setFilePath(null); setSelection(null); setTime(0); setPlaying(false);
  }, [hist.dirty]);

  // ---------- menu + keyboard ----------
  const handlers = useRef({});
  handlers.current = {
    new: newProject, open: openProject, save: () => saveProject(false), saveAs: () => saveProject(true),
    import: importMedia, export: () => setDialog({ type: 'export' }),
    undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
    requestClose: () => { if (confirmDiscard()) window.api.confirmClose(); },
  };
  useEffect(() => window.api.onMenu((cmd) => handlers.current[cmd]?.()), []);
  // Used by the MONTAJ_SELFTEST screenshot run in electron/main.cjs.
  useEffect(() => {
    window.__montajTest = { load: (p) => dispatch({ type: 'load', project: p }), seek: setTime, select: setSelection };
  }, []);
  useEffect(() => {
    window.__montajTest.exportTo = async (outPath) => {
      const pr = projectRef.current;
      const byId = Object.fromEntries(pr.media.map((m) => [m.id, m]));
      return window.api.startExport(await buildExportJob(pr, byId, { outPath, res: 720, fps: pr.settings.fps, crf: 26, preset: 'veryfast' }));
    };
  });

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || job) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'KeyS' && !e.ctrlKey) splitAtPlayhead();
      else if (e.code === 'KeyK' && selection && ['text', 'layers'].includes(selection.kind)) toggleKf(selection.kind, selection.id);
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
      else if (e.ctrlKey && e.code === 'KeyD') { e.preventDefault(); duplicateSelection(); }
      else if (e.key === 'ArrowLeft') seek(timeRef.current - (e.shiftKey ? 1 : 1 / project.settings.fps));
      else if (e.key === 'ArrowRight') seek(timeRef.current + (e.shiftKey ? 1 : 1 / project.settings.fps));
      else if (e.key === 'Home') seek(0);
      else if (e.key === 'End') seek(total);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, splitAtPlayhead, deleteSelection, duplicateSelection, seek, total, project.settings.fps, selection, toggleKf, job]);

  const captionsAdded = useCallback((cues, replace) => {
    update((pr) => ({ ...pr, text: [...(replace ? pr.text.filter((t) => !t.isCaption) : pr.text), ...cues] }));
    notify(`تمت إضافة ${cues.length} سطر ترجمة`);
  }, [update, notify]);

  const title = (filePath ? filePath.split(/[\\/]/).pop().replace(/\.montaj$/, '') : 'مشروع جديد') + (hist.dirty ? ' •' : '');
  const hasAudio = project.main.length || project.audio.length || project.layers.length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><img className="logo" src={appIcon} alt="" /> مونتاج</div>
        <div className="project-title">{title}</div>
        <div className="top-actions">
          <button className="btn ghost" onClick={() => dispatch({ type: 'undo' })} disabled={!hist.past.length} title="تراجع (Ctrl+Z)">↶ تراجع</button>
          <button className="btn ghost" onClick={() => dispatch({ type: 'redo' })} disabled={!hist.future.length} title="إعادة (Ctrl+Y)">↷ إعادة</button>
          <button className="btn ghost" onClick={() => saveProject(false)} title="حفظ (Ctrl+S)">💾 حفظ</button>
          <button className="btn" onClick={() => actions.openTTS('', null)}>🗣 نص إلى كلام</button>
          <button className="btn" onClick={() => setDialog({ type: 'captions' })} disabled={!hasAudio}>💬 ترجمة تلقائية</button>
          <button className="btn primary" onClick={() => setDialog({ type: 'export' })} disabled={!project.main.length}>⬆ تصدير</button>
        </div>
      </header>
      <div><UpdateBanner /></div>

      <div className="workspace">
        <MediaPanel
          media={project.media} importing={importing} onImport={importMedia}
          onAdd={addToTimeline} onRemove={removeMedia} onAddText={addText}
          onAddSticker={addSticker} onImportSticker={importSticker} onApplyTemplate={onApplyTemplate}
          hasClips={project.main.length > 0}
        />
        <section className="center">
          <Preview
            project={project} mediaById={mediaById} time={time} playing={playing}
            selection={selection} onSelect={setSelection} onTransform={transform} dispatch={dispatch}
          />
          <div className="transport">
            <span className="tc">{fmt(time)} / {fmt(total)}</span>
            <div className="transport-btns">
              <button className="btn icon" onClick={() => seek(0)} title="البداية (Home)">⏮</button>
              <button className="btn icon" onClick={() => seek(time - 1 / project.settings.fps)} title="إطار للخلف">◂</button>
              <button className="btn icon play" onClick={togglePlay} title="تشغيل/إيقاف (مسافة)">{playing ? '⏸' : '▶'}</button>
              <button className="btn icon" onClick={() => seek(time + 1 / project.settings.fps)} title="إطار للأمام">▸</button>
              <button className="btn icon" onClick={() => seek(total)} title="النهاية (End)">⏭</button>
            </div>
            <span className="aspect-chip">{project.settings.aspect}</span>
          </div>
        </section>
        <Inspector project={project} mediaById={mediaById} selection={selection} update={update} time={time} actions={actions} />
      </div>

      <div className="tools">
        <button className="btn" onClick={splitAtPlayhead} title="تقسيم عند المؤشر (S)">✂ تقسيم</button>
        <button className="btn" onClick={duplicateSelection} disabled={!selection || selection.kind === 'transition'} title="تكرار (Ctrl+D)">⧉ تكرار</button>
        <button className="btn danger" onClick={deleteSelection} disabled={!selection} title="حذف (Delete)">🗑 حذف</button>
        <button className="btn" onClick={() => addText()}>T إضافة نص</button>
        {selection && ['text', 'layers'].includes(selection.kind) && (
          <button className="btn" onClick={() => toggleKf(selection.kind, selection.id)} title="إطار مفتاحي (K)">◆ إطار مفتاحي</button>
        )}
        <div className="spacer" />
        <label className="zoom">تكبير الخط الزمني
          <input type="range" min="10" max="300" value={zoom} onChange={(e) => setZoom(+e.target.value)} />
        </label>
      </div>
      <Timeline
        project={project} mediaById={mediaById} time={time} zoom={zoom} selection={selection}
        onSelect={setSelection} onSeek={seek} update={update} dispatch={dispatch} onDropMedia={addToTimeline}
        total={total}
      />

      {dialog?.type === 'export' && <ExportDialog project={project} mediaById={mediaById} onClose={() => setDialog(null)} />}
      {dialog?.type === 'captions' && (
        <CaptionsDialog project={project} mediaById={mediaById} onClose={() => setDialog(null)} onDone={captionsAdded} />
      )}
      {dialog?.type === 'tts' && <TTSDialog initialText={dialog.text} onClose={() => setDialog(null)} onCreate={createSpeech} />}
      <JobOverlay job={job} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
