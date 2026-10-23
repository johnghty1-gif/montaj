import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ASPECTS, mainLayout } from '../lib/project.js';
import { cssFilter } from '../lib/effects.js';
import { drawText, ensureFonts, textAlpha } from '../lib/text.js';
import { clamp } from '../lib/time.js';

function syncMediaElement(el, src, target, rate, volume, playing) {
  if (el.dataset.src !== src) { el.dataset.src = src; el.src = src; }
  el.playbackRate = rate;
  el.volume = clamp(volume, 0, 1);
  if (el.readyState < 1) return;
  if (playing) {
    if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = target;
    if (el.paused) el.play().catch(() => {});
  } else {
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
  }
}

export default function Preview({ project, mediaById, time, playing, selection, onSelect, update, dispatch }) {
  const aspect = ASPECTS[project.settings.aspect];
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRefs = [useRef(null), useRef(null)];
  const audioRefs = useRef({});
  const boxesRef = useRef([]);
  const [size, setSize] = useState({ w: 640, h: 360 });
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  // Fit the stage inside the available area while keeping the project aspect ratio.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth - 16, H = el.clientHeight - 16;
      const r = aspect.w / aspect.h;
      setSize(W / H > r ? { w: Math.floor(H * r), h: Math.floor(H) } : { w: Math.floor(W), h: Math.floor(W / r) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect.w, aspect.h]);

  const layout = useMemo(() => mainLayout(project), [project]);
  let visible = layout.filter((l) => time >= l.start && time < l.end);
  if (!visible.length && layout.length && time >= layout[layout.length - 1].end - 0.001) visible = [layout[layout.length - 1]];

  const slotItems = [0, 1].map((s) => visible.find((l) => l.index % 2 === s) || null);
  let fadeIn = null;
  if (visible.length === 2) {
    const [a, b] = visible[0].index < visible[1].index ? visible : [visible[1], visible[0]];
    fadeIn = { index: b.index, p: clamp((time - b.start) / Math.max(0.001, a.end - b.start), 0, 1) };
  }

  // Keep the <video>/<audio> elements in step with the timeline clock.
  useEffect(() => {
    slotItems.forEach((item, s) => {
      const v = videoRefs[s].current;
      if (!v) return;
      const m = item && mediaById[item.clip.mediaId];
      if (!m || m.type !== 'video') { if (!v.paused) v.pause(); return; }
      const c = item.clip;
      const target = c.in + (time - item.start) * c.speed;
      syncMediaElement(v, window.api.mediaUrl(m.path), target, c.speed, c.muted ? 0 : c.volume, playing);
    });
    for (const a of project.audio) {
      const el = audioRefs.current[a.id];
      const m = mediaById[a.mediaId];
      if (!el || !m) continue;
      const active = time >= a.start && time < a.start + (a.out - a.in);
      if (!active) { if (!el.paused) el.pause(); continue; }
      syncMediaElement(el, window.api.mediaUrl(m.path), a.in + time - a.start, 1, a.volume, playing);
    }
  });

  // Text overlays, drawn with the same code that renders the export PNGs.
  const activeTexts = project.text.filter((t) => time >= t.start && time < t.start + t.duration);
  useEffect(() => { ensureFonts(project.text).then(rerender); }, [project.text.map((t) => t.font + t.weight).join()]);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    boxesRef.current = activeTexts.map((t) => {
      const box = drawText(ctx, t, cv.width, cv.height, textAlpha(t, time));
      if (selection?.kind === 'text' && selection.id === t.id) {
        ctx.save();
        ctx.setLineDash([8 * dpr, 6 * dpr]); ctx.strokeStyle = '#4cc9f0'; ctx.lineWidth = 2 * dpr;
        ctx.strokeRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
        ctx.restore();
      }
      return { id: t.id, x: box.x / cv.width, y: box.y / cv.height, w: box.w / cv.width, h: box.h / cv.height };
    });
  });

  const onPointerDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width, py = (e.clientY - rect.top) / rect.height;
    const hit = [...boxesRef.current].reverse().find((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
    if (!hit) {
      const item = visible[visible.length - 1];
      onSelect(item ? { kind: 'main', id: item.clip.id } : null);
      return;
    }
    onSelect({ kind: 'text', id: hit.id });
    const t0 = project.text.find((t) => t.id === hit.id);
    const base = project;
    const startX = e.clientX, startY = e.clientY;
    const move = (ev) => {
      const nx = clamp(t0.x + (ev.clientX - startX) / rect.width, 0, 1);
      const ny = clamp(t0.y + (ev.clientY - startY) / rect.height, 0, 1);
      update((pr) => ({ ...pr, text: pr.text.map((t) => (t.id === hit.id ? { ...t, x: nx, y: ny } : t)) }), { transient: true });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dispatch({ type: 'commit', base });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="preview-wrap" ref={wrapRef}>
      <div className="stage" style={{ width: size.w, height: size.h }}>
        {slotItems.map((item, s) => {
          const m = item && mediaById[item.clip.mediaId];
          const style = {
            opacity: item && fadeIn && fadeIn.index === item.index ? fadeIn.p : 1,
            zIndex: item ? item.index : 0,
            filter: item ? cssFilter(item.clip) : 'none',
          };
          return (
            <React.Fragment key={s}>
              <video
                ref={videoRefs[s]} className="layer" preload="auto" playsInline
                onLoadedMetadata={rerender}
                style={{ ...style, display: m && m.type === 'video' ? 'block' : 'none' }}
              />
              {m && m.type === 'image' && <img className="layer" src={window.api.mediaUrl(m.path)} style={style} alt="" />}
            </React.Fragment>
          );
        })}
        {!layout.length && <div className="stage-empty">أضف مقطع فيديو أو صورة إلى الخط الزمني للبدء</div>}
        <canvas ref={canvasRef} className="layer text-layer" onPointerDown={onPointerDown} />
      </div>
      {project.audio.map((a) => (
        <audio key={a.id} ref={(el) => { if (el) audioRefs.current[a.id] = el; else delete audioRefs.current[a.id]; }} preload="auto" onLoadedMetadata={rerender} />
      ))}
    </div>
  );
}
