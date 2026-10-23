import React, { useEffect, useState } from 'react';
import { mainLayout, newTextClip } from '../lib/project.js';
import { CAPTION_STYLE } from '../lib/text.js';

const LANGS = [
  { id: 'arabic', name: 'العربية' },
  { id: 'english', name: 'الإنجليزية' },
  { id: 'french', name: 'الفرنسية' },
  { id: 'turkish', name: 'التركية' },
];

export default function CaptionsDialog({ project, mediaById, onClose, onDone }) {
  const [quality, setQuality] = useState('fast');
  const [language, setLanguage] = useState('arabic');
  const [replace, setReplace] = useState(true);
  const [state, setState] = useState({ phase: 'setup' });

  useEffect(() => window.api.onCaptionsProgress((p) => setState((s) => (s.phase === 'running' ? { ...s, ...p } : s))), []);

  const start = async () => {
    const segments = [];
    for (const l of mainLayout(project)) {
      const m = mediaById[l.clip.mediaId];
      if (m.type === 'video' && m.hasAudio && !l.clip.muted) {
        segments.push({ path: m.path, in: l.clip.in, out: l.clip.out, speed: l.clip.speed, timelineStart: l.start });
      }
    }
    for (const key of ['layers', 'audio']) {
      for (const c of project[key]) {
        const m = mediaById[c.mediaId];
        if (c.muted || !(m.type === 'audio' || (m.type === 'video' && m.hasAudio))) continue;
        segments.push({ path: m.path, in: c.in, out: c.out, speed: c.speed || 1, timelineStart: c.start });
      }
    }
    if (!segments.length) { setState({ phase: 'error', message: 'لا يوجد صوت في المشروع لتفريغه.' }); return; }
    setState({ phase: 'running', stage: 'download', progress: 0 });
    try {
      const cues = await window.api.generateCaptions({ quality, language, segments });
      onDone(cues.map((c) => newTextClip(c.start, { ...CAPTION_STYLE, text: c.text, duration: Math.max(0.3, c.end - c.start) })), replace);
      onClose();
    } catch (e) {
      setState({ phase: 'error', message: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
    }
  };

  const stageLabel = state.stage === 'download' ? 'تنزيل نموذج التعرف على الكلام (مرة واحدة فقط)…' : 'جارٍ تحويل الكلام إلى نص…';

  return (
    <div className="modal-back">
      <div className="modal">
        <h3>ترجمة تلقائية (تحويل الكلام إلى نص)</h3>
        {state.phase === 'setup' && (
          <>
            <p className="hint">يعمل التفريغ على جهازك دون رفع الفيديو إلى الإنترنت. يُنزَّل النموذج في أول استخدام فقط.</p>
            <label className="field"><span className="field-head"><span>لغة الكلام</span></span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="field"><span className="field-head"><span>الدقة</span></span>
              <div className="chips">
                <button className={'chip' + (quality === 'fast' ? ' on' : '')} onClick={() => setQuality('fast')}>سريع (≈ 80 ميغابايت)</button>
                <button className={'chip' + (quality === 'accurate' ? ' on' : '')} onClick={() => setQuality('accurate')}>دقيق (≈ 250 ميغابايت)</button>
              </div>
            </label>
            <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> استبدال الترجمات السابقة</label>
            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>إلغاء</button>
              <button className="btn primary" onClick={start}>إنشاء الترجمة</button>
            </div>
          </>
        )}
        {state.phase === 'running' && (
          <>
            <p>{stageLabel} {Math.round((state.progress || 0) * 100)}%</p>
            <div className="progress"><div style={{ width: `${(state.progress || 0) * 100}%` }} /></div>
          </>
        )}
        {state.phase === 'error' && (
          <>
            <p className="error">تعذر إنشاء الترجمة.</p>
            <pre className="log" dir="ltr">{state.message}</pre>
            <div className="modal-actions"><button className="btn" onClick={() => setState({ phase: 'setup' })}>رجوع</button></div>
          </>
        )}
      </div>
    </div>
  );
}
