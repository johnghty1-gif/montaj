import React, { useEffect, useMemo, useRef, useState } from 'react';
import { mainLayout, transitionLen } from '../lib/project.js';
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

export default function Timeline({ project, mediaById, time, zoom, selection, onSelect, onSeek, update, dispatch, onDropMedia, total }) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const [dropIndex, setDropIndex] = useState(null);
  const layout = useMemo(() => mainLayout(project), [project]);
  const width = (Math.max(total, 30) + 10) * zoom;

  const textLanes = useMemo(() => lanes(project.text, (t) => t.start, (t) => t.start + t.duration), [project.text]);
  const audioLanes = useMemo(() => lanes(project.audio, (a) => a.start, (a) => a.start + a.out - a.in), [project.audio]);

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

  const trimMain = (e, item, side) => {
    const c0 = item.clip;
    const m = mediaById[c0.mediaId];
    const maxOut = m.type === 'image' ? 3600 : m.duration;
    onSelect({ kind: 'main', id: c0.id });
    drag(e, (dx) => setList('main', c0.id, (c) => (side === 'start'
      ? { ...c, in: clamp(c0.in + dx * c0.speed, 0, c0.out - 0.1) }
      : { ...c, out: clamp(c0.out + dx * c0.speed, c0.in + 0.1, maxOut) })));
  };

  // ---------- audio + text ----------
  const moveFree = (e, key, c0) => {
    drag(e, (dx) => setList(key, c0.id, (c) => ({ ...c, start: Math.max(0, c0.start + dx) })), () => onSelect({ kind: key, id: c0.id }));
  };

  const trimAudio = (e, c0, side) => {
    const m = mediaById[c0.mediaId];
    onSelect({ kind: 'audio', id: c0.id });
    drag(e, (dx) => setList('audio', c0.id, (c) => {
      if (side === 'end') return { ...c, out: clamp(c0.out + dx, c0.in + 0.1, m.duration) };
      const d = clamp(dx, Math.max(-c0.in, -c0.start), c0.out - c0.in - 0.1);
      return { ...c, start: c0.start + d, in: c0.in + d };
    }));
  };

  const trimText = (e, c0, side) => {
    onSelect({ kind: 'text', id: c0.id });
    drag(e, (dx) => setList('text', c0.id, (c) => {
      if (side === 'end') return { ...c, duration: Math.max(0.1, c0.duration + dx) };
      const d = clamp(dx, -c0.start, c0.duration - 0.1);
      return { ...c, start: c0.start + d, duration: c0.duration - d };
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
    if (m.type === 'audio') onDropMedia(m, { start: track === 'audio' ? t : t });
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

  return (
    <div className="timeline" dir="ltr">
      <div className="tl-labels">
        <div className="lbl ruler-lbl" />
        <div className="lbl" style={{ height: textLanes.count * ROW }}>النصوص</div>
        <div className="lbl main-lbl" style={{ height: ROW + 14 }}>الفيديو</div>
        <div className="lbl" style={{ height: audioLanes.count * ROW }}>الصوت</div>
      </div>
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-content" ref={contentRef} style={{ width }}>
          <div className="ruler" onPointerDown={rulerDown}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: t * zoom }}><span>{fmt(t).slice(0, 5)}</span></div>
            ))}
          </div>

          <div className="track text-track" style={{ height: textLanes.count * ROW }} onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
            {project.text.map((t) => (
              <div
                key={t.id} className={'clip text-clip' + (t.isCaption ? ' caption' : '') + (isSel('text', t.id) ? ' sel' : '')}
                style={{ left: t.start * zoom, width: Math.max(4, t.duration * zoom), top: textLanes.map[t.id] * ROW + 4 }}
                onPointerDown={(e) => moveFree(e, 'text', t)}
              >
                <span className="handle h-start" onPointerDown={(e) => trimText(e, t, 'start')} />
                <span className="clip-label" dir="rtl">{t.text}</span>
                <span className="handle h-end" onPointerDown={(e) => trimText(e, t, 'end')} />
              </div>
            ))}
          </div>

          <div
            className="track main-track" style={{ height: ROW + 14 }}
            onDragOver={(e) => onDragOver(e, 'main')} onDragLeave={() => setDropIndex(null)} onDrop={(e) => onDrop(e, 'main')}
            onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
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
            className="track audio-track" style={{ height: audioLanes.count * ROW }}
            onDragOver={(e) => onDragOver(e, 'audio')} onDrop={(e) => onDrop(e, 'audio')}
            onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
          >
            {project.audio.map((a) => {
              const m = mediaById[a.mediaId];
              if (!m) return null;
              return (
                <div
                  key={a.id} className={'clip audio-clip' + (isSel('audio', a.id) ? ' sel' : '')}
                  style={{ left: a.start * zoom, width: Math.max(4, (a.out - a.in) * zoom), top: audioLanes.map[a.id] * ROW + 4 }}
                  onPointerDown={(e) => moveFree(e, 'audio', a)}
                >
                  <span className="handle h-start" onPointerDown={(e) => trimAudio(e, a, 'start')} />
                  <span className="clip-label" dir="rtl">♪ {m.name}</span>
                  <span className="handle h-end" onPointerDown={(e) => trimAudio(e, a, 'end')} />
                </div>
              );
            })}
          </div>

          <div className="playhead" style={{ left: time * zoom }} />
        </div>
      </div>
    </div>
  );
}
