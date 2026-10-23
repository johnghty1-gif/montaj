import React, { useEffect, useState } from 'react';

export default function UpdateBanner() {
  const [u, setU] = useState(null);
  useEffect(() => window.api.onUpdater(setU), []);
  if (!u) return null;

  let text = null, action = null;
  switch (u.state) {
    case 'checking': text = 'جارٍ التحقق من وجود تحديثات…'; break;
    case 'latest': text = 'أنت تستخدم أحدث إصدار.'; break;
    case 'available': text = `يتوفر إصدار جديد (${u.version}) — جارٍ التنزيل في الخلفية…`; break;
    case 'downloading': text = `جارٍ تنزيل التحديث… ${Math.round((u.progress || 0) * 100)}%`; break;
    case 'ready':
      text = `التحديث ${u.version} جاهز للتثبيت.`;
      action = <button className="btn primary" onClick={() => window.api.installUpdate()}>إعادة التشغيل والتثبيت</button>;
      break;
    case 'dev': text = 'التحديث التلقائي يعمل فقط في النسخة المثبّتة من التطبيق.'; break;
    case 'error': text = 'تعذر التحقق من التحديثات: ' + u.message; break;
    default: return null;
  }
  return (
    <div className={'update-banner ' + u.state}>
      <span>{text}</span>
      {action}
      <button className="btn ghost icon" onClick={() => setU(null)} title="إغلاق">×</button>
    </div>
  );
}
