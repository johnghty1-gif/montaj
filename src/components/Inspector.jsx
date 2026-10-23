import React, { useState } from 'react';
import { ASPECTS, clipDuration } from '../lib/project.js';
import { FILTERS, TRANSITIONS, SPEEDS, cssFilter } from '../lib/effects.js';
import { FONTS, TEXT_PRESETS } from '../lib/text.js';
import { fmt } from '../lib/time.js';

function Slider({ label, value, min, max, step, onChange, format = (v) => v }) {
  return (
    <label className="field">
      <span className="field-head"><span>{label}</span><span className="val">{format(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

function MainClipProps({ clip, media, set }) {
  const [tab, setTab] = useState('edit');
  return (
    <>
      <div className="tabs small">
        {[['edit', 'تعديل'], ['filters', 'فلاتر'], ['adjust', 'ضبط الألوان']].map(([id, l]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{l}</button>
        ))}
      </div>
      {tab === 'edit' && (
        <>
          <div className="info-row"><span>الملف</span><b title={media.name}>{media.name}</b></div>
          <div className="info-row"><span>المدة على الخط الزمني</span><b>{fmt(clipDuration(clip))}</b></div>
          <div className="info-row"><span>من المصدر</span><b>{fmt(clip.in)} ← {fmt(clip.out)}</b></div>
          <div className="field">
            <span className="field-head"><span>السرعة</span><span className="val">{clip.speed}x</span></span>
            <div className="chips">
              {SPEEDS.map((s) => (
                <button key={s} className={'chip' + (clip.speed === s ? ' on' : '')} onClick={() => set({ speed: s })}>{s}x</button>
              ))}
            </div>
          </div>
          {media.type === 'video' && media.hasAudio && (
            <>
              <Slider label="مستوى الصوت" value={clip.volume} min={0} max={2} step={0.05}
                format={(v) => Math.round(v * 100) + '%'} onChange={(v) => set({ volume: v })} />
              <label className="check"><input type="checkbox" checked={clip.muted} onChange={(e) => set({ muted: e.target.checked })} /> كتم صوت المقطع</label>
            </>
          )}
          {media.type === 'image' && (
            <Slider label="مدة الصورة (ثانية)" value={clip.out - clip.in} min={0.5} max={30} step={0.5}
              onChange={(v) => set({ out: clip.in + v })} />
          )}
        </>
      )}
      {tab === 'filters' && (
        <div className="filter-grid">
          {FILTERS.map((f) => (
            <button key={f.id} className={'filter-item' + (clip.filter === f.id ? ' on' : '')} onClick={() => set({ filter: f.id })}>
              {media.thumb
                ? <img src={window.api.mediaUrl(media.thumb)} style={{ filter: cssFilter({ filter: f.id, adjust: {} }) }} alt="" />
                : <div className="filter-swatch" />}
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      )}
      {tab === 'adjust' && (
        <>
          <Slider label="السطوع" value={clip.adjust.brightness} min={-1} max={1} step={0.05}
            onChange={(v) => set({ adjust: { ...clip.adjust, brightness: v } })} />
          <Slider label="التباين" value={clip.adjust.contrast} min={0.5} max={2} step={0.05}
            onChange={(v) => set({ adjust: { ...clip.adjust, contrast: v } })} />
          <Slider label="التشبع" value={clip.adjust.saturation} min={0} max={2} step={0.05}
            onChange={(v) => set({ adjust: { ...clip.adjust, saturation: v } })} />
          <button className="btn ghost wide" onClick={() => set({ adjust: { brightness: 0, contrast: 1, saturation: 1 } })}>إعادة الضبط</button>
        </>
      )}
    </>
  );
}

function TransitionProps({ clip, set }) {
  const tr = clip.transition;
  return (
    <>
      <div className="filter-grid tight">
        {TRANSITIONS.map((t) => (
          <button key={t.id} className={'chip block' + (tr.type === t.id ? ' on' : '')} onClick={() => set({ transition: { ...tr, type: t.id } })}>{t.name}</button>
        ))}
      </div>
      {tr.type !== 'none' && (
        <Slider label="مدة الانتقال" value={tr.duration} min={0.2} max={2} step={0.1}
          format={(v) => v.toFixed(1) + ' ث'} onChange={(v) => set({ transition: { ...tr, duration: v } })} />
      )}
      <p className="hint">يُطبَّق الانتقال بين هذا المقطع والمقطع التالي. المعاينة تعرض تلاشيًا تقريبيًا، والتصدير يطبق الانتقال كاملًا.</p>
    </>
  );
}

function TextProps({ t, set }) {
  return (
    <>
      <label className="field">
        <span className="field-head"><span>النص</span></span>
        <textarea rows={3} dir="rtl" value={t.text} onChange={(e) => set({ text: e.target.value })} />
      </label>
      <div className="chips">
        {TEXT_PRESETS.map((p) => (
          <button key={p.name} className="chip" onClick={() => set(p.style)}>{p.name}</button>
        ))}
      </div>
      <label className="field">
        <span className="field-head"><span>الخط</span></span>
        <select value={t.font} onChange={(e) => set({ font: e.target.value })}>
          {FONTS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <Slider label="الحجم" value={t.size} min={16} max={240} step={2} onChange={(v) => set({ size: v })} />
      <label className="field">
        <span className="field-head"><span>السُمك</span></span>
        <select value={t.weight} onChange={(e) => set({ weight: +e.target.value })}>
          <option value={400}>عادي</option><option value={600}>متوسط</option><option value={700}>عريض</option><option value={800}>عريض جدًا</option>
        </select>
      </label>
      <div className="row2">
        <label className="field"><span className="field-head"><span>اللون</span></span>
          <input type="color" value={t.color} onChange={(e) => set({ color: e.target.value })} /></label>
        <label className="field"><span className="field-head"><span>لون الحد</span></span>
          <input type="color" value={t.stroke || '#000000'} onChange={(e) => set({ stroke: e.target.value })} /></label>
      </div>
      <Slider label="سُمك الحد" value={t.strokeWidth} min={0} max={12} step={1} onChange={(v) => set({ strokeWidth: v })} />
      <label className="check">
        <input type="checkbox" checked={!!t.bg} onChange={(e) => set({ bg: e.target.checked ? 'rgba(0,0,0,0.6)' : '' })} /> خلفية خلف النص
      </label>
      <Slider label="الموضع الأفقي" value={t.x} min={0} max={1} step={0.01} format={(v) => Math.round(v * 100) + '%'} onChange={(v) => set({ x: v })} />
      <Slider label="الموضع الرأسي" value={t.y} min={0} max={1} step={0.01} format={(v) => Math.round(v * 100) + '%'} onChange={(v) => set({ y: v })} />
      <Slider label="المدة" value={t.duration} min={0.3} max={60} step={0.1} format={(v) => v.toFixed(1) + ' ث'} onChange={(v) => set({ duration: v })} />
      <label className="field">
        <span className="field-head"><span>الحركة</span></span>
        <select value={t.animation} onChange={(e) => set({ animation: e.target.value })}>
          <option value="none">بدون</option><option value="fade">ظهور واختفاء تدريجي</option>
        </select>
      </label>
      <p className="hint">يمكنك أيضًا سحب النص مباشرة في نافذة المعاينة.</p>
    </>
  );
}

function ProjectProps({ project, update, onAddText }) {
  return (
    <>
      <label className="field">
        <span className="field-head"><span>مقاس الفيديو</span></span>
        <select value={project.settings.aspect} onChange={(e) => update((pr) => ({ ...pr, settings: { ...pr.settings, aspect: e.target.value } }))}>
          {Object.entries(ASPECTS).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="field-head"><span>معدل الإطارات</span></span>
        <select value={project.settings.fps} onChange={(e) => update((pr) => ({ ...pr, settings: { ...pr.settings, fps: +e.target.value } }))}>
          {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} إطار/ث</option>)}
        </select>
      </label>
      <button className="btn wide" onClick={() => onAddText()}>T إضافة نص</button>
      <div className="shortcuts">
        <h4>اختصارات لوحة المفاتيح</h4>
        <div><kbd>مسافة</kbd> تشغيل / إيقاف</div>
        <div><kbd>S</kbd> تقسيم عند المؤشر</div>
        <div><kbd>Delete</kbd> حذف المحدد</div>
        <div><kbd>Ctrl+D</kbd> تكرار</div>
        <div><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> تراجع / إعادة</div>
        <div><kbd>← →</kbd> إطار واحد (مع Shift: ثانية)</div>
        <div><kbd>Ctrl+S</kbd> حفظ · <kbd>Ctrl+E</kbd> تصدير</div>
      </div>
    </>
  );
}

export default function Inspector({ project, mediaById, selection, update, onAddText }) {
  const setIn = (key, id) => (patch) => update((pr) => ({ ...pr, [key]: pr[key].map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  let title = 'إعدادات المشروع';
  let body = <ProjectProps project={project} update={update} onAddText={onAddText} />;

  if (selection) {
    const { kind, id } = selection;
    if (kind === 'main' || kind === 'transition') {
      const clip = project.main.find((c) => c.id === id);
      if (clip && kind === 'main') { title = 'المقطع'; body = <MainClipProps clip={clip} media={mediaById[clip.mediaId]} set={setIn('main', id)} />; }
      if (clip && kind === 'transition') { title = 'الانتقال'; body = <TransitionProps clip={clip} set={setIn('main', id)} />; }
    } else if (kind === 'audio') {
      const a = project.audio.find((c) => c.id === id);
      if (a) {
        title = 'الصوت';
        body = (
          <>
            <div className="info-row"><span>الملف</span><b>{mediaById[a.mediaId]?.name}</b></div>
            <div className="info-row"><span>يبدأ عند</span><b>{fmt(a.start)}</b></div>
            <Slider label="مستوى الصوت" value={a.volume} min={0} max={2} step={0.05}
              format={(v) => Math.round(v * 100) + '%'} onChange={(v) => setIn('audio', id)({ volume: v })} />
          </>
        );
      }
    } else if (kind === 'text') {
      const t = project.text.find((c) => c.id === id);
      if (t) { title = t.isCaption ? 'سطر الترجمة' : 'النص'; body = <TextProps t={t} set={setIn('text', id)} />; }
    }
  }

  return (
    <aside className="panel inspector">
      <h3>{title}</h3>
      <div className="inspector-body">{body}</div>
    </aside>
  );
}
