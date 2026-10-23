import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  emptyProject, historyInit, historyReducer, mainLayout, totalDuration, uid,
  newMainClip, newAudioClip, newTextClip,
} from './lib/project.js';
import MediaPanel from './components/MediaPanel.jsx';
import Preview from './components/Preview.jsx';
import Timeline from './components/Timeline.jsx';
import Inspector from './components/Inspector.jsx';
import ExportDialog from './components/ExportDialog.jsx';
import CaptionsDialog from './components/CaptionsDialog.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';
import { fmt } from './lib/time.js';

export default function App() {
  const [hist, dispatch] = useReducer(historyReducer, emptyProject(), historyInit);
  const project = hist.present;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState(null); // { kind: 'main'|'audio'|'text'|'transition', id }
  const [filePath, setFilePath] = useState(null);
  const [dialog, setDialog] = useState(null); // 'export' | 'captions'
  const [toast, setToast] = useState(null);
  const [zoom, setZoom] = useState(60); // px per second
  const [importing, setImporting] = useState(false);

  const total = useMemo(() => totalDuration(project), [project]);
  const mediaById = useMemo(() => Object.fromEntries(project.media.map((m) => [m.id, m])), [project.media]);

  const update = useCallback((fn, opts = {}) => dispatch({ type: 'set', update: fn, ...opts }), []);
  const notify = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); }, []);

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

  // ---------- media ----------
  const importMedia = useCallback(async () => {
    const paths = await window.api.importMedia();
    if (!paths.length) return;
    setImporting(true);
    const added = [];
    for (const p of paths) {
      if (project.media.some((m) => m.path === p)) continue;
      try { added.push({ id: uid(), ...(await window.api.probe(p)) }); }
      catch (e) { notify(`تعذر استيراد ${p.split(/[\\/]/).pop()}: ${e.message}`); }
    }
    setImporting(false);
    if (added.length) update((pr) => ({ ...pr, media: [...pr.media, ...added] }));
  }, [project.media, update, notify]);

  const addToTimeline = useCallback((m, opts = {}) => {
    if (m.type === 'audio') {
      const start = opts.start ?? timeRef.current;
      update((pr) => ({ ...pr, audio: [...pr.audio, newAudioClip(m, start)] }));
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
      audio: pr.audio.filter((c) => c.mediaId !== id),
    }));
  }, [update]);

  const addText = useCallback((preset) => {
    const t = newTextClip(timeRef.current, preset);
    update((pr) => ({ ...pr, text: [...pr.text, t] }));
    setSelection({ kind: 'text', id: t.id });
  }, [update]);

  // ---------- editing ----------
  const splitAtPlayhead = useCallback(() => {
    const t = timeRef.current;
    const sel = selection;
    update((pr) => {
      if (sel?.kind === 'audio' || sel?.kind === 'text') {
        const key = sel.kind;
        const list = pr[key];
        const i = list.findIndex((c) => c.id === sel.id);
        if (i < 0) return pr;
        const c = list[i];
        const end = key === 'audio' ? c.start + (c.out - c.in) : c.start + c.duration;
        if (t <= c.start + 0.05 || t >= end - 0.05) return pr;
        const local = t - c.start;
        const a = key === 'audio' ? { ...c, out: c.in + local } : { ...c, duration: local };
        const b = key === 'audio' ? { ...c, id: uid(), start: t, in: c.in + local } : { ...c, id: uid(), start: t, duration: c.duration - local };
        const next = [...list]; next.splice(i, 1, a, b);
        return { ...pr, [key]: next };
      }
      const item = mainLayout(pr).find((l) => t > l.start + 0.05 && t < l.end - 0.05);
      if (!item) return pr;
      const c = item.clip;
      const cut = c.in + (t - item.start) * c.speed;
      const a = { ...c, out: cut, transition: { type: 'none', duration: c.transition.duration } };
      const b = { ...c, id: uid(), in: cut };
      const main = [...pr.main]; main.splice(item.index, 1, a, b);
      return { ...pr, main };
    });
  }, [selection, update]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    const { kind, id } = selection;
    if (kind === 'transition') {
      update((pr) => ({ ...pr, main: pr.main.map((c) => (c.id === id ? { ...c, transition: { ...c.transition, type: 'none' } } : c)) }));
    } else {
      update((pr) => ({ ...pr, [kind]: pr[kind].filter((c) => c.id !== id) }));
    }
    setSelection(null);
  }, [selection, update]);

  const duplicateSelection = useCallback(() => {
    if (!selection || selection.kind === 'transition') return;
    const { kind, id } = selection;
    update((pr) => {
      const list = pr[kind];
      const i = list.findIndex((c) => c.id === id);
      if (i < 0) return pr;
      const c = list[i];
      const copy = { ...c, id: uid() };
      if (kind === 'audio') copy.start = c.start + (c.out - c.in);
      if (kind === 'text') copy.start = c.start + c.duration;
      const next = [...list]; next.splice(i + 1, 0, copy);
      return { ...pr, [kind]: next };
    });
  }, [selection, update]);

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
    dispatch({ type: 'load', project: { ...emptyProject(), ...r.data } });
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
    import: importMedia, export: () => setDialog('export'),
    undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
    requestClose: () => { if (confirmDiscard()) window.api.confirmClose(); },
  };
  useEffect(() => window.api.onMenu((cmd) => handlers.current[cmd]?.()), []);
  // Used by the MONTAJ_SELFTEST screenshot run in electron/main.cjs.
  useEffect(() => {
    window.__montajTest = { load: (p) => dispatch({ type: 'load', project: p }), seek: setTime, select: setSelection };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 's' || e.key === 'S' || e.key === 'س') { if (!e.ctrlKey) splitAtPlayhead(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
      else if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSelection(); }
      else if (e.key === 'ArrowLeft') seek(timeRef.current - (e.shiftKey ? 1 : 1 / project.settings.fps));
      else if (e.key === 'ArrowRight') seek(timeRef.current + (e.shiftKey ? 1 : 1 / project.settings.fps));
      else if (e.key === 'Home') seek(0);
      else if (e.key === 'End') seek(total);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, splitAtPlayhead, deleteSelection, duplicateSelection, seek, total, project.settings.fps]);

  const captionsAdded = useCallback((cues, replace) => {
    update((pr) => ({ ...pr, text: [...(replace ? pr.text.filter((t) => !t.isCaption) : pr.text), ...cues] }));
    notify(`تمت إضافة ${cues.length} سطر ترجمة`);
  }, [update, notify]);

  const title = (filePath ? filePath.split(/[\\/]/).pop().replace(/\.montaj$/, '') : 'مشروع جديد') + (hist.dirty ? ' •' : '');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo">م</span> مونتاج</div>
        <div className="project-title">{title}</div>
        <div className="top-actions">
          <button className="btn ghost" onClick={() => dispatch({ type: 'undo' })} disabled={!hist.past.length} title="تراجع (Ctrl+Z)">↶ تراجع</button>
          <button className="btn ghost" onClick={() => dispatch({ type: 'redo' })} disabled={!hist.future.length} title="إعادة (Ctrl+Y)">↷ إعادة</button>
          <button className="btn ghost" onClick={() => saveProject(false)} title="حفظ (Ctrl+S)">💾 حفظ</button>
          <button className="btn" onClick={() => setDialog('captions')} disabled={!project.main.length && !project.audio.length}>💬 ترجمة تلقائية</button>
          <button className="btn primary" onClick={() => setDialog('export')} disabled={!project.main.length}>⬆ تصدير</button>
        </div>
      </header>
      <div><UpdateBanner /></div>

      <div className="workspace">
        <MediaPanel
          media={project.media} importing={importing} onImport={importMedia}
          onAdd={addToTimeline} onRemove={removeMedia} onAddText={addText}
        />
        <section className="center">
          <Preview
            project={project} mediaById={mediaById} time={time} playing={playing}
            selection={selection} onSelect={setSelection} update={update} dispatch={dispatch}
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
        <Inspector
          project={project} mediaById={mediaById} selection={selection} update={update}
          onAddText={addText}
        />
      </div>

      <div className="tools">
        <button className="btn" onClick={splitAtPlayhead} title="تقسيم عند المؤشر (S)">✂ تقسيم</button>
        <button className="btn" onClick={duplicateSelection} disabled={!selection || selection.kind === 'transition'} title="تكرار (Ctrl+D)">⧉ تكرار</button>
        <button className="btn danger" onClick={deleteSelection} disabled={!selection} title="حذف (Delete)">🗑 حذف</button>
        <button className="btn" onClick={() => addText()}>T إضافة نص</button>
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

      {dialog === 'export' && <ExportDialog project={project} mediaById={mediaById} onClose={() => setDialog(null)} />}
      {dialog === 'captions' && (
        <CaptionsDialog project={project} mediaById={mediaById} onClose={() => setDialog(null)} onDone={captionsAdded} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
