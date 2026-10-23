import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ASPECTS, mainLayout, clipDuration } from '../lib/project.js';
import { cssFilter } from '../lib/effects.js';
import { drawText, ensureFonts, textAlpha } from '../lib/text.js';
import { transformAt } from '../lib/anim.js';
import { clamp } from '../lib/time.js';

// Web Audio routing so preview volume can go above 100% and follow fades.
let audioCtx = null;
const gains = new WeakMap();
function gainFor(el) {
  if (!audioCtx) audioCtx = new AudioContext();
  let g = gains.get(el);
  if (!g) {
    g = audioCtx.createGain();
    audioCtx.createMediaElementSource(el).connect(g).connect(audioCtx.destination);
    gains.set(el, g);
  }
  return g;
}

function fadeFactor(c, local, dur) {
  let f = 1;
  if (c.fadeIn > 0) f = Math.min(f, local / c.fadeIn);
  if (c.fadeOut > 0) f = Math.min(f, (dur - local) / c.fadeOut);
  return clamp(f, 0, 1);
}

function syncMediaElement(el, src, target, rate, gain, playing) {
  if (el.dataset.src !== src) { el.crossOrigin = 'anonymous'; el.dataset.src = src; el.src = src; }
  el.playbackRate = rate;
  try { gainFor(el).gain.value = Math.max(0, gain); el.volume = 1; } catch { el.volume = clamp(gain, 0, 1); }
  if (el.readyState < 1) return;
  if (playing) {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = target;
    if (el.paused) el.play().catch(() => {});
  } else {
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
  }
}

const pauseEl = (el) => { if (el && !el.paused) el.pause(); };

export default function Preview({ project, mediaById, time, playing, selection, onSelect, onTransform, dispatch }) {
  const aspect = ASPECTS[project.settings.aspect];
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRefs = [useRef(null), useRef(null)];
  const audioRefs = useRef({});
  const layerRefs = useRef({});
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

  const isActive = (c, kind) => time >= c.start && time < c.start + (kind === 'text' ? c.duration : clipDuration(c));
  const activeLayers = project.layers.filter((c) => isActive(c, 'layers'));
  const activeTexts = project.text.filter((t) => isActive(t, 'text'));

  // Keep every <video>/<audio> element in step with the timeline clock.
  useEffect(() => {
    slotItems.forEach((item, s) => {
      const v = videoRefs[s].current;
      if (!v) return;
      const m = item && mediaById[item.clip.mediaId];
      if (!m || m.type !== 'video') { pauseEl(v); return; }
      const c = item.clip;
      const local = time - item.start;
      const gain = c.muted ? 0 : c.volume * fadeFactor(c, local, item.end - item.start);
      syncMediaElement(v, window.api.mediaUrl(m.path), c.in + local * c.speed, c.speed, gain, playing);
    });
    for (const c of project.layers) {
      const el = layerRefs.current[c.id];
      const m = mediaById[c.mediaId];
      if (!el || !m || m.type !== 'video') continue;
      if (!isActive(c, 'layers')) { pauseEl(el); continue; }
      const local = time - c.start;
      const gain = c.muted ? 0 : c.volume * fadeFactor(c, local, clipDuration(c));
      syncMediaElement(el, window.api.mediaUrl(m.path), c.in + local * c.speed, c.speed, gain, playing);
    }
    for (const a of project.audio) {
      const el = audioRefs.current[a.id];
      const m = mediaById[a.mediaId];
      if (!el || !m) continue;
      if (!isActive(a, 'audio')) { pauseEl(el); continue; }
      const local = time - a.start;
      const gain = a.muted ? 0 : a.volume * fadeFactor(a, local, clipDuration(a));
      syncMediaElement(el, window.api.mediaUrl(m.path), a.in + local * a.speed, a.speed, gain, playing);
    }
  });

  // Base on-stage size of a media layer at scale 1: the media fitted inside the frame.
  const layerBox = (c) => {
    const m = mediaById[c.mediaId];
    const mw = m.width || 1, mh = m.height || 1;
    const fit = Math.min(size.w / mw, size.h / mh);
    return { w: mw * fit, h: mh * fit };
  };

  // Text overlays (drawn with the same layout code as the export PNGs) and selection outlines.
  useEffect(() => { ensureFonts(project.text).then(rerender); }, [project.text.map((t) => t.font + t.weight).join()]);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const boxes = [];
    for (const c of activeLayers) {
      const tr = transformAt(c, time - c.start);
      const b = layerBox(c);
      const w = b.w * tr.scale * dpr, h = b.h * tr.scale * dpr;
      boxes.push({ kind: 'layers', id: c.id, x: (tr.x * cv.width - w / 2) / cv.width, y: (tr.y * cv.height - h / 2) / cv.height, w: w / cv.width, h: h / cv.height });
    }
    for (const t of activeTexts) {
      const box = drawText(ctx, t, cv.width, cv.height, transformAt(t, time - t.start), textAlpha(t, time));
      boxes.push({ kind: 'text', id: t.id, x: box.x / cv.width, y: box.y / cv.height, w: box.w / cv.width, h: box.h / cv.height });
    }
    const sel = selection && boxes.find((b) => b.kind === selection.kind && b.id === selection.id);
    if (sel) {
      ctx.save();
      ctx.setLineDash([8 * dpr, 6 * dpr]); ctx.strokeStyle = '#4cc9f0'; ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(sel.x * cv.width - 4, sel.y * cv.height - 4, sel.w * cv.width + 8, sel.h * cv.height + 8);
      ctx.restore();
    }
    boxesRef.current = boxes;
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
    onSelect({ kind: hit.kind, id: hit.id });
    const clip = project[hit.kind].find((c) => c.id === hit.id);
    const tr0 = transformAt(clip, time - clip.start);
    const base = project;
    const startX = e.clientX, startY = e.clientY;
    const move = (ev) => {
      onTransform(hit.kind, hit.id, {
        x: clamp(tr0.x + (ev.clientX - startX) / rect.width, -0.5, 1.5),
        y: clamp(tr0.y + (ev.clientY - startY) / rect.height, -0.5, 1.5),
      }, { transient: true });
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
        {!layout.length && !project.layers.length && <div className="stage-empty">أضف مقطع فيديو أو صورة إلى الخط الزمني للبدء</div>}

        {project.layers.map((c, i) => {
          const m = mediaById[c.mediaId];
          if (!m) return null;
          const active = isActive(c, 'layers');
          const tr = transformAt(c, time - c.start);
          const b = layerBox(c);
          const style = {
            left: tr.x * size.w, top: tr.y * size.h, width: b.w * tr.scale, height: b.h * tr.scale,
            transform: `translate(-50%, -50%) rotate(${tr.rotation}deg)`, opacity: clamp(tr.opacity, 0, 1),
            filter: cssFilter(c), zIndex: 200 + i, display: active ? 'block' : 'none',
          };
          return m.type === 'video'
            ? <video key={c.id} className="pip" style={style} preload="auto" playsInline onLoadedMetadata={rerender}
                ref={(el) => { if (el) layerRefs.current[c.id] = el; else delete layerRefs.current[c.id]; }} />
            : <img key={c.id} className="pip" style={style} src={window.api.mediaUrl(m.path)} alt="" />;
        })}

        <canvas ref={canvasRef} className="layer text-layer" onPointerDown={onPointerDown} />
      </div>
      {project.audio.map((a) => (
        <audio key={a.id} ref={(el) => { if (el) audioRefs.current[a.id] = el; else delete audioRefs.current[a.id]; }} preload="auto" onLoadedMetadata={rerender} />
      ))}
    </div>
  );
}
