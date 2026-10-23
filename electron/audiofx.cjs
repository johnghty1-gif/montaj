// FFmpeg chains for clip audio effects. Ids must match AUDIO_FX in src/lib/effects.js.
const AUDIO_FX = {
  none: '',
  deep: 'rubberband=pitch=0.75',
  chipmunk: 'rubberband=pitch=1.6',
  robot: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75",
  echo: 'aecho=0.8:0.9:450:0.35',
  hall: 'aecho=0.8:0.88:60|120|180:0.4|0.3|0.2',
  telephone: 'highpass=f=300,lowpass=f=3400,volume=1.6',
  radio: 'highpass=f=450,lowpass=f=2800,acompressor=threshold=0.1:ratio=4,volume=1.4',
  megaphone: 'highpass=f=800,lowpass=f=3500,acrusher=bits=10:mode=log:aa=1,volume=2',
  vibrato: 'vibrato=f=6:d=0.5',
  denoise: 'afftdn=nf=-25',
  enhance: 'highpass=f=80,afftdn=nf=-25,acompressor=threshold=0.125:ratio=3,dynaudnorm=f=150:g=15',
  normalize: 'dynaudnorm=f=150:g=15',
};

function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}

// Shared per-clip audio chain: speed, effect, volume, fades. `dur` is the clip's timeline duration.
function clipAudioChain(c, dur) {
  const parts = ['asetpts=PTS-STARTPTS'];
  if ((c.speed || 1) !== 1) parts.push(atempoChain(c.speed));
  if (AUDIO_FX[c.audioFx]) parts.push(AUDIO_FX[c.audioFx]);
  parts.push(`volume=${(c.volume ?? 1).toFixed(3)}`);
  const fi = Math.min(c.fadeIn || 0, dur / 2), fo = Math.min(c.fadeOut || 0, dur / 2);
  if (fi > 0) parts.push(`afade=t=in:st=0:d=${fi.toFixed(3)}`);
  if (fo > 0) parts.push(`afade=t=out:st=${(dur - fo).toFixed(3)}:d=${fo.toFixed(3)}`);
  parts.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo');
  return parts.join(',');
}

module.exports = { AUDIO_FX, atempoChain, clipAudioChain };
