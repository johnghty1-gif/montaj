import React, { useEffect, useState } from 'react';
import { ASPECTS, mainLayout, mainEnd } from '../lib/project.js';
import { ensureFonts, renderTextPng } from '../lib/text.js';
import { fmt } from '../lib/time.js';

const RES = [
  { id: 720, name: '720p' },
  { id: 1080, name: '1080p (موصى به)' },
  { id: 1440, name: '2K' },
  { id: 2160, name: '4K' },
];
const QUALITY = [
  { id: 'high', name: 'عالية', crf: 18, preset: 'slow' },
  { id: 'medium', name: 'متوسطة', crf: 22, preset: 'medium' },
  { id: 'low', name: 'حجم صغير', crf: 28, preset: 'fast' },
];

const even = (n) => Math.round(n / 2) * 2;

export default function ExportDialog({ project, mediaById, onClose }) {
  const [res, setRes] = useState(1080);
  const [quality, setQuality] = useState('medium');
  const [fps, setFps] = useState(project.settings.fps);
  const [state, setState] = useState({ phase: 'setup' }); // setup | running | done | error

  useEffect(() => window.api.onExportProgress((p) => setState((s) => (s.phase === 'running' ? { ...s, progress: p } : s))), []);

  const a = ASPECTS[project.settings.aspect];
  const scale = res / Math.min(a.w, a.h);
  const W = even(a.w * scale), H = even(a.h * scale);
  const duration = mainEnd(project);

  const start = async () => {
    const outPath = await window.api.chooseExportFile();
    if (!outPath) return;
    setState({ phase: 'running', progress: 0 });
    try {
      await ensureFonts(project.text);
      const q = QUALITY.find((x) => x.id === quality);
      const clips = mainLayout(project).map(({ clip }) => {
        const m = mediaById[clip.mediaId];
        return { ...clip, path: m.path, type: m.type, hasAudio: m.hasAudio };
      });
      const overlays = project.text
        .filter((t) => t.start < duration && t.text.trim())
        .map((t) => ({ png: renderTextPng(t, W, H), start: t.start, end: Math.min(duration, t.start + t.duration), fade: t.animation === 'fade' }));
      const audio = project.audio.map((x) => ({ ...x, path: mediaById[x.mediaId].path }));
      const out = await window.api.startExport({ outPath, width: W, height: H, fps, crf: q.crf, preset: q.preset, clips, audio, overlays });
      setState({ phase: 'done', outPath: out });
    } catch (e) {
      setState({ phase: 'error', message: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
    }
  };

  return (
    <div className="modal-back">
      <div className="modal">
        <h3>تصدير الفيديو</h3>
        {state.phase === 'setup' && (
          <>
            <label className="field"><span className="field-head"><span>الدقة</span><span className="val">{W}×{H}</span></span>
              <div className="chips">{RES.map((r) => <button key={r.id} className={'chip' + (res === r.id ? ' on' : '')} onClick={() => setRes(r.id)}>{r.name}</button>)}</div>
            </label>
            <label className="field"><span className="field-head"><span>الجودة</span></span>
              <div className="chips">{QUALITY.map((q) => <button key={q.id} className={'chip' + (quality === q.id ? ' on' : '')} onClick={() => setQuality(q.id)}>{q.name}</button>)}</div>
            </label>
            <label className="field"><span className="field-head"><span>معدل الإطارات</span></span>
              <div className="chips">{[24, 25, 30, 50, 60].map((f) => <button key={f} className={'chip' + (fps === f ? ' on' : '')} onClick={() => setFps(f)}>{f}</button>)}</div>
            </label>
            <div className="info-row"><span>المدة</span><b>{fmt(duration)}</b></div>
            <div className="info-row"><span>الصيغة</span><b>MP4 (H.264 + AAC)</b></div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>إلغاء</button>
              <button className="btn primary" onClick={start}>تصدير</button>
            </div>
          </>
        )}
        {state.phase === 'running' && (
          <>
            <p>جارٍ التصدير… {Math.round((state.progress || 0) * 100)}%</p>
            <div className="progress"><div style={{ width: `${(state.progress || 0) * 100}%` }} /></div>
            <div className="modal-actions"><button className="btn danger" onClick={() => window.api.cancelExport()}>إيقاف</button></div>
          </>
        )}
        {state.phase === 'done' && (
          <>
            <p>✅ تم التصدير بنجاح.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => window.api.revealFile(state.outPath)}>فتح المجلد</button>
              <button className="btn primary" onClick={onClose}>تم</button>
            </div>
          </>
        )}
        {state.phase === 'error' && (
          <>
            <p className="error">تعذر التصدير.</p>
            <pre className="log" dir="ltr">{state.message}</pre>
            <div className="modal-actions"><button className="btn" onClick={() => setState({ phase: 'setup' })}>رجوع</button></div>
          </>
        )}
      </div>
    </div>
  );
}
