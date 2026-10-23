import React from 'react';

// Progress card for long-running processing jobs (background removal, stabilization, separation, speech).
export default function JobOverlay({ job }) {
  if (!job) return null;
  return (
    <div className="modal-back">
      <div className="modal job">
        <h3>{job.title}</h3>
        <p>{job.label || 'جارٍ التجهيز…'} {job.progress != null && `${Math.round(job.progress * 100)}%`}</p>
        <div className="progress"><div style={{ width: `${(job.progress || 0) * 100}%` }} /></div>
        <div className="modal-actions"><button className="btn danger" onClick={() => window.api.cancelJob()}>إلغاء</button></div>
      </div>
    </div>
  );
}
