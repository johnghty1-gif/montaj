import React, { useState } from 'react';
import { ASPECTS, clipDuration, clipStart } from '../lib/project.js';
import { FILTERS, TRANSITIONS, SPEEDS, AUDIO_FX, cssFilter } from '../lib/effects.js';
import { FONTS, TEXT_PRESETS } from '../lib/text.js';
import { transformAt, keyframeTimes, isKeyframeAt, MOTION_PRESETS } from '../lib/anim.js';
import { fmt } from '../lib/time.js';

function Slider({ label, value, min, max, step, onChange, format = (v) => v, hot }) {
  return (
    <label className={'field' + (hot ? ' hot' : '')}>
      <span className="field-head"><span>{label}{hot && <i className="kf-mark" title="متحرك بإطارات مفتاحية">◆</i>}</span><span className="val">{format(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

function Tabs({ tabs, tab, setTab }) {
  return (
    <div className="tabs small">
      {tabs.map(([id, l]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{l}</button>)}
    </div>
  );
}

const pct = (v) => Math.round(v * 100) + '%';

// ---------- audio ----------
function AudioPanel({ clip, kind, media, set, actions }) {
  const hasAudio = kind === 'audio' || (media.type === 'video' && media.hasAudio);
  if (!hasAudio) return <p className="hint">لا يحتوي هذا المقطع على صوت.</p>;
  if (clip.audioRemoved) {
    return (
      <div className="notice">
        <p>تمت إزالة صوت هذا المقطع.</p>
        <button className="btn wide" onClick={() => set({ audioRemoved: false, muted: false })}>استعادة الصوت</button>
      </div>
    );
  }
  const vol = clip.volume;
  return (
    <>
      <div className="field">
        <span className="field-head"><span>مستوى الصوت</span><span className="val">{pct(vol)}</span></span>
        <div className="vol-row">
          <button className="btn icon" title="خفض الصوت" onClick={() => set({ volume: Math.max(0, +(vol - 0.1).toFixed(2)) })}>−</button>
          <input type="range" min={0} max={4} step={0.05} value={vol} onChange={(e) => set({ volume: +e.target.value })} />
          <button className="btn icon" title="رفع الصوت" onClick={() => set({ volume: Math.min(4, +(vol + 0.1).toFixed(2)) })}>+</button>
        </div>
      </div>
      <div className="btn-row">
        <button className={'btn' + (clip.muted ? ' on' : '')} onClick={() => set({ muted: !clip.muted })}>{clip.muted ? '🔊 إلغاء الكتم' : '🔇 كتم'}</button>
        <button className="btn danger" onClick={() => (kind === 'audio' ? actions.deleteClip(kind, clip.id) : set({ audioRemoved: true, muted: true }))}>🗑 حذف الصوت</button>
      </div>
      {kind !== 'audio' && (
        <button className="btn wide" onClick={() => actions.detachAudio(kind, clip.id)}>⤓ فصل الصوت عن المقطع</button>
      )}
      <div className="row2">
        <Slider label="ظهور تدريجي" value={clip.fadeIn} min={0} max={5} step={0.1} format={(v) => v.toFixed(1) + ' ث'} onChange={(v) => set({ fadeIn: v })} />
        <Slider label="اختفاء تدريجي" value={clip.fadeOut} min={0} max={5} step={0.1} format={(v) => v.toFixed(1) + ' ث'} onChange={(v) => set({ fadeOut: v })} />
      </div>
      {kind === 'audio' && (
        <div className="field">
          <span className="field-head"><span>السرعة</span><span className="val">{clip.speed}x</span></span>
          <div className="chips">{SPEEDS.map((s) => <button key={s} className={'chip' + (clip.speed === s ? ' on' : '')} onClick={() => set({ speed: s })}>{s}x</button>)}</div>
        </div>
      )}
      <div className="field">
        <span className="field-head"><span>تأثيرات الصوت</span></span>
        <div className="filter-grid tight3">
          {AUDIO_FX.map((f) => (
            <button key={f.id} className={'chip block' + (clip.audioFx === f.id ? ' on' : '')} onClick={() => set({ audioFx: f.id })}>{f.name}</button>
          ))}
        </div>
        {clip.audioFx !== 'none' && (
          <>
            <button className="btn wide" onClick={() => actions.previewAudio(kind, clip.id)}>🎧 استمع للتأثير (8 ثوانٍ)</button>
            <p className="hint">التأثير يُطبَّق في الفيديو المُصدَّر. استخدم زر الاستماع لسماعه الآن.</p>
          </>
        )}
      </div>
      <div className="field">
        <span className="field-head"><span>عزل الصوت البشري عن الموسيقى</span></span>
        <div className="btn-col">
          <button className="btn" onClick={() => actions.separate(kind, clip.id, 'vocals')}>🗣 إبقاء الكلام فقط</button>
          <button className="btn" onClick={() => actions.separate(kind, clip.id, 'music')}>🎵 إبقاء الموسيقى فقط</button>
          <button className="btn" onClick={() => actions.separate(kind, clip.id, 'both')}>⇅ فصلهما في مسارين</button>
        </div>
        <p className="hint">يعمل بالذكاء الاصطناعي على جهازك. يُنزَّل النموذج (≈ 67 ميغابايت) في أول استخدام.</p>
      </div>
    </>
  );
}

// ---------- look ----------
function FiltersPanel({ clip, media, set }) {
  return (
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
  );
}

function AdjustPanel({ clip, set }) {
  return (
    <>
      <Slider label="السطوع" value={clip.adjust.brightness} min={-1} max={1} step={0.05} onChange={(v) => set({ adjust: { ...clip.adjust, brightness: v } })} />
      <Slider label="التباين" value={clip.adjust.contrast} min={0.5} max={2} step={0.05} onChange={(v) => set({ adjust: { ...clip.adjust, contrast: v } })} />
      <Slider label="التشبع" value={clip.adjust.saturation} min={0} max={2} step={0.05} onChange={(v) => set({ adjust: { ...clip.adjust, saturation: v } })} />
      <button className="btn ghost wide" onClick={() => set({ adjust: { brightness: 0, contrast: 1, saturation: 1 } })}>إعادة الضبط</button>
    </>
  );
}

function SmartPanel({ clip, kind, media, actions }) {
  const [strength, setStrength] = useState(2);
  return (
    <>
      <div className="tool-card">
        <h4>✂ إزالة الخلفية</h4>
        <p className="hint">يزيل الخلفية تلقائيًا ويُبقي الشخص. يعمل أفضل مع الأشخاص. ضع المقطع في «الطبقات» ليظهر فوق فيديو آخر.</p>
        <button className="btn primary wide" onClick={() => actions.removeBackground(kind, clip.id)}>إزالة الخلفية</button>
      </div>
      {media.type === 'video' && (
        <div className="tool-card">
          <h4>🎯 تثبيت الفيديو</h4>
          <p className="hint">يزيل اهتزاز الكاميرا. يُنشئ نسخة ثابتة من المقطع.</p>
          <div className="chips">
            {[[1, 'خفيف'], [2, 'متوسط'], [3, 'قوي']].map(([v, l]) => (
              <button key={v} className={'chip' + (strength === v ? ' on' : '')} onClick={() => setStrength(v)}>{l}</button>
            ))}
          </div>
          <button className="btn primary wide" onClick={() => actions.stabilize(kind, clip.id, strength)}>تثبيت الفيديو</button>
        </div>
      )}
    </>
  );
}

// ---------- motion / keyframes ----------
function MotionPanel({ clip, kind, time, actions }) {
  const start = clip.start;
  const local = Math.max(0, time - start);
  const inClip = time >= start && time <= start + (kind === 'text' ? clip.duration : clipDuration(clip));
  const tr = transformAt(clip, local);
  const kts = keyframeTimes(clip);
  const at = isKeyframeAt(clip, local);
  const animated = (p) => !!(clip.kf && clip.kf[p] && clip.kf[p].length);
  const set = (patch) => actions.transform(kind, clip.id, patch);
  return (
    <>
      <div className="kf-bar">
        <button className={'btn kf-btn' + (at ? ' on' : '')} disabled={!inClip} onClick={() => actions.toggleKeyframe(kind, clip.id)}>
          ◆ {at ? 'حذف الإطار المفتاحي' : 'إضافة إطار مفتاحي'}
        </button>
        {!!kts.length && <button className="btn ghost" onClick={() => actions.clearKeyframes(kind, clip.id)}>مسح الكل</button>}
      </div>
      {!inClip && <p className="hint">حرّك المؤشر داخل المقطع لإضافة إطارات مفتاحية.</p>}
      {!!kts.length && (
        <div className="kf-list">
          {kts.map((t) => (
            <button key={t} className={'chip' + (Math.abs(t - local) < 1 / 60 ? ' on' : '')} onClick={() => actions.seek(start + t)}>◆ {fmt(t)}</button>
          ))}
        </div>
      )}
      <Slider label="الموضع الأفقي" hot={animated('x')} value={tr.x} min={-0.5} max={1.5} step={0.005} format={pct} onChange={(v) => set({ x: v })} />
      <Slider label="الموضع الرأسي" hot={animated('y')} value={tr.y} min={-0.5} max={1.5} step={0.005} format={pct} onChange={(v) => set({ y: v })} />
      <Slider label="الحجم" hot={animated('scale')} value={tr.scale} min={0.05} max={3} step={0.01} format={pct} onChange={(v) => set({ scale: v })} />
      <Slider label="الدوران" hot={animated('rotation')} value={tr.rotation} min={-360} max={360} step={1} format={(v) => Math.round(v) + '°'} onChange={(v) => set({ rotation: v })} />
      <Slider label="الشفافية" hot={animated('opacity')} value={tr.opacity} min={0} max={1} step={0.01} format={pct} onChange={(v) => set({ opacity: v })} />
      <div className="field">
        <span className="field-head"><span>حركات جاهزة</span></span>
        <div className="chips">
          {MOTION_PRESETS.map((m) => <button key={m.id} className="chip" onClick={() => actions.applyMotion(kind, clip.id, m.id)}>{m.name}</button>)}
        </div>
      </div>
      <p className="hint">بعد إضافة إطار مفتاحي، يُنشئ أي تعديل إطارًا جديدًا عند موضع المؤشر، ويتحرك العنصر بينها تلقائيًا.</p>
    </>
  );
}

// ---------- clip panels ----------
function MainClipProps({ clip, media, set, actions }) {
  const [tab, setTab] = useState('edit');
  return (
    <>
      <Tabs tab={tab} setTab={setTab} tabs={[['edit', 'تعديل'], ['audio', 'الصوت'], ['filters', 'فلاتر'], ['adjust', 'ألوان'], ['smart', 'ذكي']]} />
      {tab === 'edit' && (
        <>
          <div className="info-row"><span>الملف</span><b title={media.name}>{media.name}</b></div>
          <div className="info-row"><span>المدة على الخط الزمني</span><b>{fmt(clipDuration(clip))}</b></div>
          <div className="info-row"><span>من المصدر</span><b>{fmt(clip.in)} ← {fmt(clip.out)}</b></div>
          <div className="field">
            <span className="field-head"><span>السرعة</span><span className="val">{clip.speed}x</span></span>
            <div className="chips">{SPEEDS.map((s) => <button key={s} className={'chip' + (clip.speed === s ? ' on' : '')} onClick={() => set({ speed: s })}>{s}x</button>)}</div>
          </div>
          {media.type === 'image' && (
            <Slider label="مدة الصورة (ثانية)" value={clip.out - clip.in} min={0.5} max={30} step={0.5} onChange={(v) => set({ out: clip.in + v })} />
          )}
        </>
      )}
      {tab === 'audio' && <AudioPanel clip={clip} kind="main" media={media} set={set} actions={actions} />}
      {tab === 'filters' && <FiltersPanel clip={clip} media={media} set={set} />}
      {tab === 'adjust' && <AdjustPanel clip={clip} set={set} />}
      {tab === 'smart' && <SmartPanel clip={clip} kind="main" media={media} actions={actions} />}
    </>
  );
}

function LayerProps({ clip, media, set, actions, time }) {
  const [tab, setTab] = useState('motion');
  return (
    <>
      <Tabs tab={tab} setTab={setTab} tabs={[['motion', 'الحركة'], ['audio', 'الصوت'], ['filters', 'فلاتر'], ['adjust', 'ألوان'], ['smart', 'ذكي']]} />
      {tab === 'motion' && (
        <>
          <MotionPanel clip={clip} kind="layers" time={time} actions={actions} />
          <div className="field">
            <span className="field-head"><span>السرعة</span><span className="val">{clip.speed}x</span></span>
            <div className="chips">{SPEEDS.map((s) => <button key={s} className={'chip' + (clip.speed === s ? ' on' : '')} onClick={() => set({ speed: s })}>{s}x</button>)}</div>
          </div>
          {media.type === 'image' && (
            <Slider label="المدة (ثانية)" value={clip.out - clip.in} min={0.5} max={60} step={0.5} onChange={(v) => set({ out: clip.in + v })} />
          )}
        </>
      )}
      {tab === 'audio' && <AudioPanel clip={clip} kind="layers" media={media} set={set} actions={actions} />}
      {tab === 'filters' && <FiltersPanel clip={clip} media={media} set={set} />}
      {tab === 'adjust' && <AdjustPanel clip={clip} set={set} />}
      {tab === 'smart' && <SmartPanel clip={clip} kind="layers" media={media} actions={actions} />}
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
        <Slider label="مدة الانتقال" value={tr.duration} min={0.2} max={2} step={0.1} format={(v) => v.toFixed(1) + ' ث'} onChange={(v) => set({ transition: { ...tr, duration: v } })} />
      )}
      <p className="hint">يُطبَّق الانتقال بين هذا المقطع والمقطع التالي. المعاينة تعرض تلاشيًا تقريبيًا، والتصدير يطبق الانتقال كاملًا.</p>
    </>
  );
}

function TextProps({ t, set, actions, time }) {
  const [tab, setTab] = useState('text');
  const sticker = t.kind === 'sticker';
  return (
    <>
      <Tabs tab={tab} setTab={setTab} tabs={sticker ? [['motion', 'الحركة'], ['text', 'الملصق']] : [['text', 'النص'], ['motion', 'الحركة']]} />
      {tab === 'motion' && <MotionPanel clip={t} kind="text" time={time} actions={actions} />}
      {tab === 'text' && sticker && (
        <>
          <Slider label="الحجم الأساسي" value={t.size} min={40} max={600} step={10} onChange={(v) => set({ size: v })} />
          <Slider label="المدة" value={t.duration} min={0.3} max={60} step={0.1} format={(v) => v.toFixed(1) + ' ث'} onChange={(v) => set({ duration: v })} />
        </>
      )}
      {tab === 'text' && !sticker && (
        <>
          <label className="field">
            <span className="field-head"><span>النص</span></span>
            <textarea rows={3} dir="rtl" value={t.text} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <button className="btn wide" onClick={() => actions.openTTS(t.text, t.start)}>🗣 تحويل هذا النص إلى كلام</button>
          <div className="chips">{TEXT_PRESETS.map((p) => <button key={p.name} className="chip" onClick={() => set(p.style)}>{p.name}</button>)}</div>
          <label className="field">
            <span className="field-head"><span>الخط</span></span>
            <select value={t.font} onChange={(e) => set({ font: e.target.value })}>
              {FONTS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <Slider label="حجم الخط" value={t.size} min={16} max={240} step={2} onChange={(v) => set({ size: v })} />
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
          <Slider label="المدة" value={t.duration} min={0.3} max={60} step={0.1} format={(v) => v.toFixed(1) + ' ث'} onChange={(v) => set({ duration: v })} />
          <label className="field">
            <span className="field-head"><span>ظهور النص</span></span>
            <select value={t.animation} onChange={(e) => set({ animation: e.target.value })}>
              <option value="none">بدون</option><option value="fade">ظهور واختفاء تدريجي</option>
            </select>
          </label>
          <p className="hint">اسحب النص مباشرة في المعاينة، أو حرّكه بالإطارات المفتاحية من تبويب «الحركة».</p>
        </>
      )}
    </>
  );
}

function ProjectProps({ project, update, actions }) {
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
      <button className="btn wide" onClick={() => actions.addText()}>T إضافة نص</button>
      <button className="btn wide" onClick={() => actions.openTTS('', null)}>🗣 تحويل النص إلى كلام</button>
      <div className="shortcuts">
        <h4>اختصارات لوحة المفاتيح</h4>
        <div><kbd>مسافة</kbd> تشغيل / إيقاف</div>
        <div><kbd>S</kbd> تقسيم عند المؤشر</div>
        <div><kbd>K</kbd> إطار مفتاحي للعنصر المحدد</div>
        <div><kbd>Delete</kbd> حذف المحدد</div>
        <div><kbd>Ctrl+D</kbd> تكرار</div>
        <div><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> تراجع / إعادة</div>
        <div><kbd>← →</kbd> إطار واحد (مع Shift: ثانية)</div>
        <div><kbd>Ctrl+S</kbd> حفظ · <kbd>Ctrl+E</kbd> تصدير</div>
      </div>
    </>
  );
}

export default function Inspector({ project, mediaById, selection, update, time, actions }) {
  const setIn = (key, id) => (patch) => update((pr) => ({ ...pr, [key]: pr[key].map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  let title = 'إعدادات المشروع';
  let body = <ProjectProps project={project} update={update} actions={actions} />;

  if (selection) {
    const { kind, id } = selection;
    if (kind === 'main' || kind === 'transition') {
      const clip = project.main.find((c) => c.id === id);
      if (clip && kind === 'main') { title = 'المقطع'; body = <MainClipProps key={id} clip={clip} media={mediaById[clip.mediaId]} set={setIn('main', id)} actions={actions} />; }
      if (clip && kind === 'transition') { title = 'الانتقال'; body = <TransitionProps clip={clip} set={setIn('main', id)} />; }
    } else if (kind === 'layers') {
      const c = project.layers.find((x) => x.id === id);
      if (c) { title = 'طبقة (صورة داخل صورة)'; body = <LayerProps key={id} clip={c} media={mediaById[c.mediaId]} set={setIn('layers', id)} actions={actions} time={time} />; }
    } else if (kind === 'audio') {
      const a = project.audio.find((c) => c.id === id);
      if (a) {
        title = 'الصوت';
        body = (
          <>
            <div className="info-row"><span>الملف</span><b>{mediaById[a.mediaId]?.name}</b></div>
            <div className="info-row"><span>يبدأ عند</span><b>{fmt(clipStart(project, 'audio', id))}</b></div>
            <AudioPanel key={id} clip={a} kind="audio" media={mediaById[a.mediaId]} set={setIn('audio', id)} actions={actions} />
          </>
        );
      }
    } else if (kind === 'text') {
      const t = project.text.find((c) => c.id === id);
      if (t) {
        title = t.kind === 'sticker' ? 'الملصق' : t.isCaption ? 'سطر الترجمة' : 'النص';
        body = <TextProps key={id} t={t} set={setIn('text', id)} actions={actions} time={time} />;
      }
    }
  }

  return (
    <aside className="panel inspector">
      <h3>{title}</h3>
      <div className="inspector-body">{body}</div>
    </aside>
  );
}
