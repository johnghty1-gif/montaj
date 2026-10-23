import React, { useState } from 'react';
import { fmt } from '../lib/time.js';
import { TEXT_PRESETS, STICKERS } from '../lib/text.js';
import { TEMPLATES } from '../lib/templates.js';

const TYPE_LABEL = { video: 'فيديو', audio: 'صوت', image: 'صورة' };

export default function MediaPanel({ media, importing, onImport, onAdd, onRemove, onAddText, onAddSticker, onImportSticker, onApplyTemplate, hasClips }) {
  const [tab, setTab] = useState('media');
  const [filter, setFilter] = useState('all');
  const shown = media.filter((m) => filter === 'all' || m.type === filter);

  return (
    <aside className="panel media-panel">
      <div className="tabs">
        {[['media', 'الوسائط'], ['text', 'النصوص'], ['stickers', 'الملصقات'], ['templates', 'القوالب']].map(([id, l]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{l}</button>
        ))}
      </div>

      {tab === 'media' && (
        <>
          <button className="btn primary wide" onClick={onImport} disabled={importing}>
            {importing ? 'جارٍ الاستيراد…' : '+ استيراد ملفات'}
          </button>
          <div className="chips">
            {[['all', 'الكل'], ['video', 'فيديو'], ['image', 'صور'], ['audio', 'صوت']].map(([id, label]) => (
              <button key={id} className={'chip' + (filter === id ? ' on' : '')} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
          {!media.length && <p className="empty">استورد مقاطع فيديو أو صورًا أو ملفات صوتية، ثم اسحبها إلى الخط الزمني أو اضغط +.</p>}
          <div className="media-grid">
            {shown.map((m) => (
              <div
                key={m.id} className="media-item" draggable
                onDragStart={(e) => { e.dataTransfer.setData('application/x-media', m.id); e.dataTransfer.effectAllowed = 'copy'; }}
                onDoubleClick={() => onAdd(m)}
                title={m.name}
              >
                <div className={'thumb' + (m.hasAlpha ? ' checker' : '')}>
                  {m.thumb ? <img src={window.api.mediaUrl(m.thumb)} alt="" /> : <div className="audio-thumb">♪</div>}
                  <span className="badge">{m.type === 'image' ? TYPE_LABEL.image : fmt(m.duration)}</span>
                  <div className="item-actions">
                    <button className="add" onClick={() => onAdd(m)} title={m.type === 'audio' ? 'إضافة إلى مسار الصوت' : 'إضافة إلى المسار الرئيسي'}>+</button>
                    {m.type !== 'audio' && <button className="add layer" onClick={() => onAdd(m, { as: 'layer' })} title="إضافة كطبقة فوق الفيديو (صورة داخل صورة)">▣</button>}
                  </div>
                  <button className="remove" onClick={() => onRemove(m.id)} title="إزالة من المشروع">×</button>
                </div>
                <div className="name">{m.name}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'text' && (
        <div className="preset-list">
          <p className="hint">اختر نمطًا لإضافة نص عند موضع المؤشر.</p>
          {TEXT_PRESETS.map((p) => (
            <button
              key={p.name} className="text-preset" onClick={() => onAddText(p.style)}
              style={{
                fontFamily: p.style.font || 'Cairo', fontWeight: p.style.weight, color: p.style.color,
                background: p.style.bg || '#23252c',
                WebkitTextStroke: p.style.strokeWidth ? `1px ${p.style.stroke}` : undefined,
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {tab === 'stickers' && (
        <>
          <button className="btn wide" onClick={onImportSticker}>+ استيراد ملصق من صورة (PNG)</button>
          {STICKERS.map((g) => (
            <div key={g.name} className="sticker-group">
              <h5>{g.name}</h5>
              <div className="sticker-grid">
                {g.items.map((s) => <button key={s} className="sticker" onClick={() => onAddSticker(s)} title="إضافة عند المؤشر">{s}</button>)}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'templates' && (
        <div className="template-list">
          <p className="hint">
            {hasClips ? 'يطبق القالب المقاس والألوان والانتقالات والعناوين المتحركة على المقاطع الموجودة.' : 'أضف مقاطعك إلى الخط الزمني أولًا، ثم اختر قالبًا.'}
          </p>
          {TEMPLATES.map((t) => (
            <button key={t.id} className="template-card" disabled={!hasClips} onClick={() => onApplyTemplate(t)}>
              <span className="template-swatch" style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}>{t.aspect}</span>
              <span className="template-text"><b>{t.name}</b><small>{t.desc}</small></span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
