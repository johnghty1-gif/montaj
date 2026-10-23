import React, { useEffect, useMemo, useRef, useState } from 'react';
import { mainLayout, transitionLen, spanOf } from '../lib/project.js';
import { keyframeTimes } from '../lib/anim.js';
import { fmt, clamp } from '../lib/time.js';

const ROW = 46;

// Greedy lane assignment so overlapping clips stack instead of hiding each other.
function lanes(items, startOf, endOf) {
  const ends = [];
  const out = {};
  [...items].sort((a, b) => startOf(a) - startOf(b)).forEach((it) => {
    let lane = ends.findIndex((e) => e <= startOf(it) + 1e-6);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = endOf(it);
    out[it.id] = lane;
  });
  return { map: out, count: Math.max(1, ends.length) };
}

function tickStep(zoom) {
  return [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * zoom >= 70) || 600;
}

const FREE_TRACKS = [
  { key: 'text', label: 'النصوص' },
  { key: 'layers', label: 'الطبقات' },
];

export default function Timeline({ project, mediaById, time, zoom, selection, onSelect, onSeek, update, dispatch, onDropMedia, total }) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const labelsRef = useRef(null);
  const [dropIndex, setDropIndex] = useState(null);
  const layout = useMemo(() => mainLayout(project), [project]);
  const width = (Math.max(total, 30) + 10) * zoom;

  const laneInfo = useMemo(() => {
    const out = {};
    for (const k of ['text', 'layers', 'audio']) out[k] = lanes(project[k], (c) => c.start, (c) => c.start + spanOf(k, c));
    return out;
  }, [project.text, project.layers, project.audio]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const x = time * zoom;
    if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.2);
  }, [time, zoom]);

  const timeAt = (clientX) => {
    const rect = contentRef.current.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / zoom);
  };

  // Generic drag: calls onMove(deltaSeconds) with the pre-drag project, records one undo step at the end.
  const drag = (e, onMove, onClick, onEnd) => {
    e.stopPropagation();
    e.preventDefault();
    const base = project;
    const x0 = e.clientX;
    let moved = false;
    const move = (ev) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true;
      if (moved) onMove((ev.clientX - x0) / zoom, base, ev);
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) onClick?.();
      else { onEnd?.(base, ev); dispatch({ type: 'commit', base }); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const setList = (key, id, fn) => update((pr) => ({ ...pr, [key]: pr[key].map((c) => (c.id === id ? fn(c) : c)) }), { transient: true });

  const insertIndexAt = (t) => {
    const i = layout.findIndex((l) => t < (l.start + l.end) / 2);
    return i < 0 ? layout.length : i;
  };

  // ---------- main track ----------
  const mainDown = (e, item) => {
    const id = item.clip.id;
    drag(e,
      (_dx, _base, ev) => setDropIndex(insertIndexAt(timeAt(ev.clientX))),
      () => onSelect({ kind: 'main', id }),
      (base, ev) => {
        const to = insertIndexAt(timeAt(ev.clientX));
        setDropIndex(null);
        update((pr) => {
          const from = pr.main.findIndex((c) => c.id === id);
          const main = [...pr.main];
          const [c] = main.splice(from, 1);
          main.splice(to > from ? to - 1 : to, 0, c);
          return { ...pr, main };
        }, { transient: true });
        onSelect({ kind: 'main', id });
      });
  };

  const maxOut = (m) => (m.type === 'image' ? 3600 : m.duration);

  const trimMain = (e, item, side) => {
    const c0 = item.clip;
    const m = mediaById[c0.mediaId];
    onSelect({ kind: 'main', id: c0.id });
    drag(e, (dx) => setList('main', c0.id, (c) => (side === 'start'
      ? { ...c, in: clamp(c0.in + dx * c0.speed, 0, c0.out - 0.1) }
      : { ...c, out: clamp(c0.out + dx * c0.speed, c0.in + 0.1, maxOut(m)) })));
  };

  // ---------- free tracks (text, layers, audio) ----------
  const moveFree = (e, key, c0) => {
    drag(e, (dx) => setList(key, c0.id, (c) => ({ ...c, start: Math.max(0, c0.start + dx) })), () => onSelect({ kind: key, id: c0.id }));
  };

  const trimFree = (e, key, c0, side) => {
    onSelect({ kind: key, id: c0.id });
    if (key === 'text') {
      drag(e, (dx) => setList('text', c0.id, (c) => {
        if (side === 'end') return { ...c, duration: Math.max(0.1, c0.duration + dx) };
        const d = clamp(dx, -c0.start, c0.duration - 0.1);
        return { ...c, start: c0.start + d, duration: c0.duration - d };
      }));
      return;
    }
    const m = mediaById[c0.mediaId];
    const sp = c0.speed || 1;
    drag(e, (dx) => setList(key, c0.id, (c) => {
      if (side === 'end') return { ...c, out: clamp(c0.out + dx * sp, c0.in + 0.1, maxOut(m)) };
      const d = clamp(dx, Math.max(-c0.in / sp, -c0.start), (c0.out - c0.in - 0.1) / sp);
      return { ...c, start: c0.start + d, in: c0.in + d * sp };
    }));
  };

  // ---------- seeking ----------
  const rulerDown = (e) => {
    onSeek(timeAt(e.clientX));
    const move = (ev) => onSeek(timeAt(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDrop = (e, track) => {
    e.preventDefault();
    setDropIndex(null);
    const m = mediaById[e.dataTransfer.getData('application/x-media')];
    if (!m) return;
    const t = timeAt(e.clientX);
    if (track === 'layers' && m.type !== 'audio') onDropMedia(m, { as: 'layer', start: t });
    else if (m.type === 'audio') onDropMedia(m, { start: t });
    else onDropMedia(m, { index: insertIndexAt(t) });
  };
  const onDragOver = (e, track) => {
    if (![...e.dataTransfer.types].includes('application/x-media')) return;
    e.preventDefault();
    if (track === 'main') setDropIndex(insertIndexAt(timeAt(e.clientX)));
  };

  const step = tickStep(zoom);
  const ticks = [];
  for (let t = 0; t * zoom < width; t += step) ticks.push(t);

  const isSel = (kind, id) => selection && selection.kind === kind && selection.id === id;
  const dropX = dropIndex == null ? null : dropIndex < layout.length ? layout[dropIndex].start * zoom : (layout.length ? layout[layout.length - 1].end : 0) * zoom;
  const deselect = (e) => { if (e.target === e.currentTarget) onSelect(null); };

  const diamonds = (c) => keyframeTimes(c).map((t) => (
    <span key={t} className="kf-dot" style={{ left: t * zoom - 4 }} title="إطار مفتاحي" />
  ));

  const freeClip = (key, c) => {
    const m = c.mediaId && mediaById[c.mediaId];
    if (key !== 'text' && !m) return null;
    const span = spanOf(key, c);
    const cls = key === 'text' ? (c.kind === 'sticker' ? 'sticker-clip' : c.isCaption ? 'text-clip caption' : 'text-clip')
      : key === 'layers' ? 'layer-clip' : 'audio-clip';
    const label = key === 'text' ? c.text
      : key === 'layers' ? `▣ ${m.name}` : `${c.muted ? '🔇' : '♪'} ${m.name}`;
    return (
      <div
        key={c.id} className={`clip ${cls}` + (isSel(key, c.id) ? ' sel' : '')}
        style={{
          left: c.start * zoom, width: Math.max(4, span * zoom), top: laneInfo[key].map[c.id] * ROW + 4,
          backgroundImage: key === 'layers' && m.thumb ? `url("${window.api.mediaUrl(m.thumb)}")` : undefined,
        }}
        onPointerDown={(e) => moveFree(e, key, c)}
      >
        <span className="handle h-start" onPointerDown={(e) => trimFree(e, key, c, 'start')} />
        <span className="clip-label" dir="rtl">{(c.speed || 1) !== 1 && <b>{c.speed}x </b>}{label}</span>
        <span className="handle h-end" onPointerDown={(e) => trimFree(e, key, c, 'end')} />
        {key !== 'audio' && diamonds(c)}
      </div>
    );
  };

  return (
    <div className="timeline" dir="ltr">
      <div className="tl-labels" ref={labelsRef}>
        <div className="lbl ruler-lbl" />
        {FREE_TRACKS.map((t) => <div key={t.key} className="lbl" style={{ height: laneInfo[t.key].count * ROW }}>{t.label}</div>)}
        <div className="lbl main-lbl" style={{ height: ROW + 14 }}>الفيديو</div>
        <div className="lbl" style={{ height: laneInfo.audio.count * ROW }}>الصوت</div>
      </div>
      <div className="tl-scroll" ref={scrollRef} onScroll={(e) => { if (labelsRef.current) labelsRef.current.scrollTop = e.currentTarget.scrollTop; }}>
        <div className="tl-content" ref={contentRef} style={{ width }}>
          <div className="ruler" onPointerDown={rulerDown}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: t * zoom }}><span>{fmt(t).slice(0, 5)}</span></div>
            ))}
          </div>

          {FREE_TRACKS.map(({ key }) => (
            <div
              key={key} className={`track ${key}-track`} style={{ height: laneInfo[key].count * ROW }} onPointerDown={deselect}
              onDragOver={(e) => onDragOver(e, key)} onDrop={(e) => onDrop(e, key)}
            >
              {key === 'layers' && !project.layers.length && <div className="track-hint" dir="rtl">اسحب صورة أو فيديو هنا لوضعه فوق الفيديو (صورة داخل صورة)</div>}
              {project[key].map((c) => freeClip(key, c))}
            </div>
          ))}

          <div
            className="track main-track" style={{ height: ROW + 14 }}
            onDragOver={(e) => onDragOver(e, 'main')} onDragLeave={() => setDropIndex(null)} onDrop={(e) => onDrop(e, 'main')}
            onPointerDown={deselect}
          >
            {!layout.length && <div className="track-hint" dir="rtl">اسحب الوسائط إلى هنا</div>}
            {layout.map((l) => {
              const m = mediaById[l.clip.mediaId];
              if (!m) return null;
              return (
                <div
                  key={l.clip.id} className={'clip main-clip' + (isSel('main', l.clip.id) ? ' sel' : '')}
                  style={{
                    left: l.start * zoom, width: Math.max(6, (l.end - l.start) * zoom), zIndex: l.index + 1,
                    backgroundImage: m.thumb ? `url("${window.api.mediaUrl(m.thumb)}")` : undefined,
                  }}
                  onPointerDown={(e) => mainDown(e, l)}
                >
                  <span className="handle h-start" onPointerDown={(e) => trimMain(e, l, 'start')} />
                  <span className="clip-label" dir="rtl">
                    {l.clip.speed !== 1 && <b>{l.clip.speed}x </b>}
                    {l.clip.muted && '🔇 '}{m.name}
                  </span>
                  <span className="handle h-end" onPointerDown={(e) => trimMain(e, l, 'end')} />
                </div>
              );
            })}
            {layout.slice(0, -1).map((l) => {
              const tl = transitionLen(project, l.index);
              const on = l.clip.transition && l.clip.transition.type !== 'none';
              return (
                <button
                  key={'tr' + l.clip.id} title="انتقال"
                  className={'transition-btn' + (on ? ' on' : '') + (isSel('transition', l.clip.id) ? ' sel' : '')}
                  style={{ left: (l.end - tl / 2) * zoom - 11 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onSelect({ kind: 'transition', id: l.clip.id })}
                >⋈</button>
              );
            })}
            {dropX != null && <div className="drop-indicator" style={{ left: dropX }} />}
          </div>

          <div
            className="track audio-track" style={{ height: laneInfo.audio.count * ROW }}
            onDragOver={(e) => onDragOver(e, 'audio')} onDrop={(e) => onDrop(e, 'audio')} onPointerDown={deselect}
          >
            {project.audio.map((a) => freeClip('audio', a))}
          </div>

          <div className="playhead" style={{ left: time * zoom }} />
        </div>
      </div>
    </div>
  );
}
