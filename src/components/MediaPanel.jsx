import React, { useState } from 'react';
import { fmt } from '../lib/time.js';
import { TEXT_PRESETS } from '../lib/text.js';

const TYPE_LABEL = { video: 'فيديو', audio: 'صوت', image: 'صورة' };

export default function MediaPanel({ media, importing, onImport, onAdd, onRemove, onAddText }) {
  const [tab, setTab] = useState('media');
  const [filter, setFilter] = useState('all');
  const shown = media.filter((m) => filter === 'all' || m.type === filter);

  return (
    <aside className="panel media-panel">
      <div className="tabs">
        <button className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}>الوسائط</button>
        <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>النصوص</button>
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
                <div className="thumb">
                  {m.thumb ? <img src={window.api.mediaUrl(m.thumb)} alt="" /> : <div className="audio-thumb">♪</div>}
                  <span className="badge">{m.type === 'image' ? TYPE_LABEL.image : fmt(m.duration)}</span>
                  <button className="add" onClick={() => onAdd(m)} title="إضافة إلى الخط الزمني">+</button>
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
    </aside>
  );
}
