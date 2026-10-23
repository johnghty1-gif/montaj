import React, { useEffect, useState } from 'react';

export default function TTSDialog({ initialText, onClose, onCreate }) {
  const [text, setText] = useState(initialText || '');
  const [voices, setVoices] = useState(null);
  const [voice, setVoice] = useState('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [error, setError] = useState(null);

  useEffect(() => {
    window.api.ttsVoices()
      .then((v) => { setVoices(v); setVoice((v.find((x) => x.lang.startsWith('ar')) || v[0] || {}).id || ''); })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  const hasArabic = voices && voices.some((v) => v.lang.startsWith('ar'));

  return (
    <div className="modal-back">
      <div className="modal">
        <h3>تحويل النص إلى كلام</h3>
        <label className="field">
          <span className="field-head"><span>النص</span><span className="val">{text.length} حرف</span></span>
          <textarea rows={5} dir="rtl" value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب النص الذي تريد تحويله إلى صوت…" />
        </label>
        <label className="field">
          <span className="field-head"><span>الصوت</span></span>
          <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={!voices}>
            {!voices && <option>جارٍ تحميل الأصوات…</option>}
            {voices && voices.map((v) => (
              <option key={v.id} value={v.id}>{v.name} — {v.gender === 'Female' ? 'أنثى' : 'ذكر'} ({v.lang})</option>
            ))}
          </select>
        </label>
        {voices && !hasArabic && (
          <p className="hint">لا توجد أصوات عربية على هذا الجهاز. أضفها من: الإعدادات ← الوقت واللغة ← الكلام ← إضافة أصوات ← العربية.</p>
        )}
        <div className="row2">
          <label className="field"><span className="field-head"><span>السرعة</span><span className="val">{rate.toFixed(1)}x</span></span>
            <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => setRate(+e.target.value)} /></label>
          <label className="field"><span className="field-head"><span>طبقة الصوت</span><span className="val">{pitch.toFixed(1)}</span></span>
            <input type="range" min={0} max={2} step={0.1} value={pitch} onChange={(e) => setPitch(+e.target.value)} /></label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={!text.trim() || !voice} onClick={() => onCreate({ text: text.trim(), voice, rate, pitch })}>إنشاء الصوت وإضافته</button>
        </div>
      </div>
    </div>
  );
}
