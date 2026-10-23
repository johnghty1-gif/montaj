const { app } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Packaged builds keep the binaries in app.asar.unpacked.
function unpacked(p) {
  return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}
const ffmpegPath = unpacked(require('ffmpeg-static'));
const ffprobePath = unpacked(require('ffprobe-static').path);

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

function cacheDir(name) {
  const dir = path.join(app.getPath('userData'), name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function probe(filePath) {
  const out = await run(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath]);
  const info = JSON.parse(out);
  const v = info.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = info.streams.find((s) => s.codec_type === 'audio');
  const isImage = IMAGE_EXT.includes(path.extname(filePath).toLowerCase());
  const type = isImage ? 'image' : v ? 'video' : a ? 'audio' : null;
  if (!type) throw new Error('نوع الملف غير مدعوم');
  const duration = isImage ? 5 : parseFloat(info.format.duration || (v && v.duration) || (a && a.duration) || 0);

  let thumb = null;
  if (type !== 'audio') {
    const hash = crypto.createHash('md5').update(filePath).digest('hex');
    thumb = path.join(cacheDir('thumbs'), hash + '.jpg');
    if (!fs.existsSync(thumb)) {
      const at = isImage ? 0 : Math.min(1, duration / 2);
      await run(ffmpegPath, ['-y', '-ss', String(at), '-i', filePath, '-frames:v', '1', '-vf', 'scale=320:-2', thumb]);
    }
  }
  // VP9 WebM keeps transparency in a side channel flagged by the ALPHA_MODE tag (our cutouts use it).
  const tags = (v && v.tags) || {};
  const hasAlpha = isImage
    ? /a|pal/.test((v && v.pix_fmt) || '')
    : !!v && v.codec_name === 'vp9' && Object.keys(tags).some((k) => k.toLowerCase() === 'alpha_mode' && tags[k] === '1');
  return {
    path: filePath,
    name: path.basename(filePath),
    type,
    duration,
    width: v ? v.width : 0,
    height: v ? v.height : 0,
    hasAudio: !!a,
    hasAlpha,
    thumb,
  };
}

// Files the app generates (cutouts, stabilized clips, separated stems, speech) live here so projects can reference them.
function derivedPath(prefix, ext) {
  return path.join(cacheDir('derived'), `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}.${ext}`);
}

module.exports = { probe, run, ffmpegPath, ffprobePath, cacheDir, derivedPath };
