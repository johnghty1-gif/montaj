// Vocal / music separation with an MDX-Net model (UVR "Kim Vocal 2") on onnxruntime.
// Mirrors UVR's MDX pipeline: STFT (n_fft 7680, hop 1024, periodic Hann, centered with reflect padding),
// model predicts the vocal spectrogram for 3072 bins × 256 frames, ISTFT back, instrumental = mix − vocals.

const N_FFT = 7680;
const HOP = 1024;
const DIM_F = 3072;
const DIM_T = 256;
const N_BINS = N_FFT / 2 + 1;
const CHUNK = HOP * (DIM_T - 1);
const TRIM = N_FFT / 2;
const GEN = CHUNK - 2 * TRIM;
const COMPENSATE = 1.009;

// ---------- mixed-radix complex FFT (sizes made of 2, 3, 4, 5), forward sign e^{-2πi/n} ----------
// Iterative decimation in time: digit-reversed load, then in-place radix stages from the smallest block up.
function makeFFT(n) {
  const factors = [];
  let m = n;
  for (const p of [4, 2, 3, 5]) while (m % p === 0) { factors.push(p); m /= p; }
  if (m !== 1) throw new Error('unsupported FFT size ' + n);
  const cos = new Float64Array(n), sin = new Float64Array(n);
  for (let k = 0; k < n; k++) { cos[k] = Math.cos((2 * Math.PI * k) / n); sin[k] = -Math.sin((2 * Math.PI * k) / n); }

  const perm = new Int32Array(n);
  (function build(inOff, stride, size, outOff, fi) {
    if (size === 1) { perm[outOff] = inOff; return; }
    const p = factors[fi], sub = size / p;
    for (let q = 0; q < p; q++) build(inOff + q * stride, stride * p, sub, outOff + q * sub, fi + 1);
  })(0, 1, n, 0, 0);

  const sizes = [];
  for (let fi = factors.length - 1, size = 1; fi >= 0; fi--) { size *= factors[fi]; sizes.push([factors[fi], size]); }
  const S3 = -Math.sqrt(3) / 2;
  const xr = new Float64Array(5), xi = new Float64Array(5);
  const c5 = [0, 1, 2, 3, 4].map((j) => Math.cos((-2 * Math.PI * j) / 5)), s5 = [0, 1, 2, 3, 4].map((j) => Math.sin((-2 * Math.PI * j) / 5));

  return function fft(re, im, R, I) {
    for (let i = 0; i < n; i++) { R[i] = re[perm[i]]; I[i] = im[perm[i]]; }
    for (const [p, size] of sizes) {
      const sub = size / p, step = n / size;
      for (let b = 0; b < n; b += size) {
        for (let k = 0; k < sub; k++) {
          for (let q = 0; q < p; q++) {
            const idx = b + q * sub + k, tw = q * k * step;
            const a = R[idx], c = I[idx];
            xr[q] = a * cos[tw] - c * sin[tw];
            xi[q] = a * sin[tw] + c * cos[tw];
          }
          const o = b + k;
          if (p === 4) {
            const t0r = xr[0] + xr[2], t0i = xi[0] + xi[2], t1r = xr[0] - xr[2], t1i = xi[0] - xi[2];
            const t2r = xr[1] + xr[3], t2i = xi[1] + xi[3], t3r = xr[1] - xr[3], t3i = xi[1] - xi[3];
            R[o] = t0r + t2r; I[o] = t0i + t2i;
            R[o + sub] = t1r + t3i; I[o + sub] = t1i - t3r;
            R[o + 2 * sub] = t0r - t2r; I[o + 2 * sub] = t0i - t2i;
            R[o + 3 * sub] = t1r - t3i; I[o + 3 * sub] = t1i + t3r;
          } else if (p === 2) {
            R[o] = xr[0] + xr[1]; I[o] = xi[0] + xi[1];
            R[o + sub] = xr[0] - xr[1]; I[o + sub] = xi[0] - xi[1];
          } else if (p === 3) {
            const sr = xr[1] + xr[2], si = xi[1] + xi[2], dr = xr[1] - xr[2], di = xi[1] - xi[2];
            const mr = xr[0] - 0.5 * sr, mi = xi[0] - 0.5 * si;
            R[o] = xr[0] + sr; I[o] = xi[0] + si;
            R[o + sub] = mr - S3 * di; I[o + sub] = mi + S3 * dr;
            R[o + 2 * sub] = mr + S3 * di; I[o + 2 * sub] = mi - S3 * dr;
          } else {
            for (let s = 0; s < 5; s++) {
              let yr = 0, yi = 0;
              for (let q = 0; q < 5; q++) {
                const j = (q * s) % 5;
                yr += xr[q] * c5[j] - xi[q] * s5[j];
                yi += xr[q] * s5[j] + xi[q] * c5[j];
              }
              R[o + s * sub] = yr; I[o + s * sub] = yi;
            }
          }
        }
      }
    }
  };
}

const fft = makeFFT(N_FFT);
const WIN = new Float64Array(N_FFT).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));

function reflectPad(x) {
  const pad = N_FFT / 2;
  const xp = new Float64Array(CHUNK + N_FFT);
  for (let i = 0; i < pad; i++) xp[i] = x[pad - i];
  xp.set(x, pad);
  for (let i = 0; i < pad; i++) xp[pad + CHUNK + i] = x[CHUNK - 2 - i];
  return xp;
}

// Stereo chunk (each length CHUNK) -> model input [4][DIM_F][DIM_T] = L.re, L.im, R.re, R.im.
// Both real channels go through one complex FFT (z = l + i·r) and are split by conjugate symmetry.
function stft(l, r) {
  const pl = reflectPad(l), pr = reflectPad(r);
  const plane = DIM_F * DIM_T;
  const dst = new Float32Array(4 * plane);
  const fr = new Float64Array(N_FFT), fi = new Float64Array(N_FFT), Z = new Float64Array(N_FFT), Zi = new Float64Array(N_FFT);
  for (let t = 0; t < DIM_T; t++) {
    const s = t * HOP;
    for (let i = 0; i < N_FFT; i++) { fr[i] = pl[s + i] * WIN[i]; fi[i] = pr[s + i] * WIN[i]; }
    fft(fr, fi, Z, Zi);
    for (let f = 0; f < DIM_F; f++) {
      const j = f === 0 ? 0 : N_FFT - f;
      const a = Z[f], b = Zi[f], c = Z[j], d = Zi[j];
      const o = f * DIM_T + t;
      dst[o] = (a + c) / 2; dst[plane + o] = (b - d) / 2;
      dst[2 * plane + o] = (b + d) / 2; dst[3 * plane + o] = (c - a) / 2;
    }
  }
  return dst;
}

// Model output [4][DIM_F][DIM_T] -> stereo waveform chunk; one inverse FFT per frame recovers both channels.
function istft(src) {
  const pad = N_FFT / 2, plane = DIM_F * DIM_T;
  const yl = new Float64Array(CHUNK + N_FFT), yr = new Float64Array(CHUNK + N_FFT), env = new Float64Array(CHUNK + N_FFT);
  const cr = new Float64Array(N_FFT), ci = new Float64Array(N_FFT), or = new Float64Array(N_FFT), oi = new Float64Array(N_FFT);
  for (let t = 0; t < DIM_T; t++) {
    cr.fill(0); ci.fill(0);
    for (let f = 0; f < DIM_F; f++) {
      const o = f * DIM_T + t;
      const Lr = src[o], Li = src[plane + o], Rr = src[2 * plane + o], Ri = src[3 * plane + o];
      // C = L + i·R, stored conjugated for the inverse-via-forward trick: ifft(C) = conj(fft(conj(C)))/N.
      cr[f] = Lr - Ri; ci[f] = -(Li + Rr);
      if (f > 0) { cr[N_FFT - f] = Lr + Ri; ci[N_FFT - f] = -(Rr - Li); }
    }
    fft(cr, ci, or, oi);
    const s = t * HOP;
    for (let i = 0; i < N_FFT; i++) {
      yl[s + i] += (or[i] / N_FFT) * WIN[i];
      yr[s + i] -= (oi[i] / N_FFT) * WIN[i];
      env[s + i] += WIN[i] * WIN[i];
    }
  }
  const L = new Float32Array(CHUNK), R = new Float32Array(CHUNK);
  for (let i = 0; i < CHUNK; i++) {
    const e = env[pad + i];
    if (e > 1e-11) { L[i] = yl[pad + i] / e; R[i] = yr[pad + i] / e; }
  }
  return [L, R];
}

// left/right: Float32Array stereo at 44.1 kHz. Returns { vocals: [L, R], music: [L, R] }.
async function separate(session, left, right, onProgress, isCanceled) {
  const n = left.length;
  const padEnd = GEN - (n % GEN);
  const total = TRIM + n + padEnd + TRIM;
  const mix = [new Float32Array(total), new Float32Array(total)];
  mix[0].set(left, TRIM); mix[1].set(right, TRIM);
  const vocals = [new Float32Array(n + padEnd), new Float32Array(n + padEnd)];
  const { Tensor } = require('onnxruntime-node');
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const chunks = Math.ceil((n + padEnd) / GEN);

  for (let c = 0, i = 0; i < n + padEnd; i += GEN, c++) {
    if (isCanceled()) throw new Error('canceled');
    const spec = stft(mix[0].subarray(i, i + CHUNK), mix[1].subarray(i, i + CHUNK));
    const res = await session.run({ [inputName]: new Tensor('float32', spec, [1, 4, DIM_F, DIM_T]) });
    const wave = istft(res[outputName].data);
    for (let ch = 0; ch < 2; ch++) vocals[ch].set(wave[ch].subarray(TRIM, CHUNK - TRIM), i);
    onProgress((c + 1) / chunks);
  }
  const v = vocals.map((a) => a.subarray(0, n));
  for (const a of v) for (let k = 0; k < n; k++) a[k] *= COMPENSATE;
  const m = [new Float32Array(n), new Float32Array(n)];
  for (let ch = 0; ch < 2; ch++) {
    const src = ch === 0 ? left : right;
    for (let k = 0; k < n; k++) m[ch][k] = src[k] - v[ch][k];
  }
  return { vocals: v, music: m };
}

module.exports = { separate, makeFFT, stft, istft, CHUNK, SAMPLE_RATE: 44100 };
