import { mainLayout, mainEnd, newTextClip } from './project.js';

// Built-in templates restyle the clips already on the timeline: aspect, look, transitions, titles and motion.
export const TEMPLATES = [
  {
    id: 'cinematic', name: 'مقدمة سينمائية', desc: 'ألوان درامية، تلاشٍ للأسود، وعنوان كبير يكبر تدريجيًا',
    aspect: '16:9', filter: 'drama', transition: { type: 'fadeblack', duration: 0.8 },
    title: { text: 'عنوان الفيلم', style: { size: 120, weight: 800, font: 'Cairo', color: '#ffffff', stroke: '#000000', strokeWidth: 4, animation: 'fade' }, motion: 'zoomIn', duration: 3.5 },
    outro: { text: 'شكرًا للمشاهدة', style: { size: 80, weight: 700, color: '#ffffff', stroke: '', strokeWidth: 0, bg: 'rgba(0,0,0,0.5)', animation: 'fade' } },
    swatch: ['#1b1b2f', '#e43f5a'],
  },
  {
    id: 'reels', name: 'ريلز سريع', desc: 'عمودي 9:16، ألوان حيوية، انتقالات انزلاق سريعة',
    aspect: '9:16', filter: 'vivid', transition: { type: 'slideleft', duration: 0.3 },
    title: { text: 'تابعني للمزيد 🔥', style: { size: 90, weight: 800, color: '#ffd60a', stroke: '#000000', strokeWidth: 6, y: 0.2 }, motion: 'pop', duration: 2.5 },
    swatch: ['#ff006e', '#ffbe0b'],
  },
  {
    id: 'vlog', name: 'فلوج يومي', desc: 'ألوان دافئة وانتقالات ذوبان ناعمة',
    aspect: '16:9', filter: 'warm', transition: { type: 'dissolve', duration: 0.6 },
    title: { text: 'يوم في حياتي', style: { size: 96, weight: 700, font: 'Tajawal', color: '#ffffff', stroke: '#5a3e1b', strokeWidth: 4, y: 0.8 }, motion: 'slideIn', duration: 3 },
    swatch: ['#f4a261', '#2a9d8f'],
  },
  {
    id: 'memories', name: 'ذكريات', desc: 'طابع كلاسيكي، تلاشٍ بطيء، وخط أميري',
    aspect: '16:9', filter: 'vintage', transition: { type: 'fade', duration: 1.2 },
    title: { text: 'ذكرياتنا الجميلة', style: { size: 110, weight: 700, font: 'Amiri', color: '#fff3d6', stroke: '#3a2a10', strokeWidth: 4, animation: 'fade' }, motion: 'fadeInOut', duration: 4 },
    swatch: ['#a98467', '#f0ead2'],
  },
  {
    id: 'promo', name: 'إعلان منتج', desc: 'مربع 1:1، تكبير حيوي، وعبارة دعوة في النهاية',
    aspect: '1:1', filter: 'vivid', transition: { type: 'zoomin', duration: 0.4 },
    title: { text: 'عرض خاص', style: { size: 120, weight: 800, color: '#ffffff', stroke: '', strokeWidth: 0, bg: 'rgba(230,57,70,0.9)', y: 0.2 }, motion: 'pop', duration: 2.5 },
    outro: { text: 'اطلبه الآن', style: { size: 100, weight: 800, color: '#1d3557', stroke: '', strokeWidth: 0, bg: 'rgba(255,214,10,0.95)', animation: 'none' }, motion: 'pop' },
    swatch: ['#e63946', '#ffd60a'],
  },
  {
    id: 'classic', name: 'أبيض وأسود', desc: 'أبيض وأسود كلاسيكي مع تلاشٍ للأبيض',
    aspect: '16:9', filter: 'bw', transition: { type: 'fadewhite', duration: 0.7 },
    title: { text: 'حكاية', style: { size: 130, weight: 400, font: 'Lalezar', color: '#ffffff', stroke: '#000000', strokeWidth: 3, animation: 'fade' }, duration: 3 },
    swatch: ['#111111', '#eeeeee'],
  },
];

export function applyTemplate(project, tpl, motionPresets) {
  const motion = (id, clip, d) => {
    const p = motionPresets.find((m) => m.id === id);
    return p ? p.make(clip, d) : {};
  };
  const main = project.main.map((c, i, arr) => ({
    ...c, filter: tpl.filter,
    transition: i < arr.length - 1 ? { ...tpl.transition } : c.transition,
  }));
  const next = { ...project, settings: { ...project.settings, aspect: tpl.aspect }, main };
  // Replace earlier template titles; keep the user's own texts.
  const texts = project.text.filter((t) => !t.fromTemplate);
  const end = mainEnd(next) || 5;
  const make = (spec, start, duration) => {
    const t = newTextClip(start, { ...spec.style, text: spec.text, duration, fromTemplate: true });
    return spec.motion ? { ...t, kf: motion(spec.motion, t, duration) } : t;
  };
  if (tpl.title) texts.push(make(tpl.title, 0, Math.min(tpl.title.duration || 3, end)));
  if (tpl.outro && mainLayout(next).length) texts.push(make(tpl.outro, Math.max(0, end - 2.5), Math.min(2.5, end)));
  return { ...next, text: texts };
}
