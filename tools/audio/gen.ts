// из anamnez: tools/audio/gen.ts @ f4c68f1 (WAV, фильтр, шум, нота, нормировка, затухание)
// bun tools/audio/gen.ts — звуки «Узоров», синтезированные кодом (docs/09-content.md, «Звук и
// музыка»: свои или со свободной лицензией): стежок, нить готова, картинка готова. Шум — из
// генератора игры с фиксированным зерном, поэтому файлы при каждой сборке те же до байта.
//
// Звучат они из динамика телефона, а он почти не воспроизводит частоты ниже ~250 Гц: у звуков
// всё главное — в полосе 1–5 кГц.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash32, rng } from '../../src/engine/seed';

export const RATE = 22050;
const OUT = join(import.meta.dir, '../../assets/audio');

export function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const len = (sec: number) => new Float32Array(Math.round(sec * RATE));

/** Двухполюсный фильтр по «поваренной книге» RBJ. */
export function biquad(input: Float32Array, kind: 'lp' | 'hp' | 'bp', hz: number, q: number): Float32Array {
  const w = (2 * Math.PI * hz) / RATE;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const [b0, b1, b2] = kind === 'lp' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
    : kind === 'hp' ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
      : [alpha, 0, -alpha];
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

export function noise(n: number, name: string): Float32Array {
  const r = rng(hash32(`uzory-audio-${name}`));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r() * 2 - 1;
  return out;
}

/** Нота с обертонами: [множитель частоты, громкость, время затухания в секундах]. */
function note(out: Float32Array, at: number, hz: number, gain: number, partials: [number, number, number][], attack = 0.003) {
  const s0 = Math.round(at * RATE);
  for (let i = 0; s0 + i < out.length; i++) {
    const t = i / RATE;
    const a = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    let v = 0;
    for (const [mul, amp, tau] of partials) v += amp * Math.exp(-t / tau) * Math.sin(2 * Math.PI * hz * mul * t);
    out[s0 + i] += gain * a * v;
  }
}

export function normalize(x: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (const v of x) {
    if (!Number.isFinite(v)) throw new Error('gen: NaN or Infinity in a sound');
    m = Math.max(m, Math.abs(v));
  }
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

/** Мягкое затухание в конце — без щелчка при обрыве. */
export function fadeOut(x: Float32Array, sec: number): Float32Array {
  const n = Math.min(x.length, Math.round(sec * RATE));
  for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n;
  return x;
}

/**
 * Стежок — «тук» иглы по канве, натянутой в пяльцах (0.18.2; владелец 31.10.2026: «звук стежков ещё не
 * улучшился»). Натянутая ткань звучит, как маленький барабан: короткий толчок шума проходит через три
 * резонанса круглой мембраны (основной тон, ×1,594 и ×2,136) — выходит глухой «тук» с живой фактурой, у
 * каждого варианта своей. Игла проходит ткань — щелчок 2–5 кГц в 3 мс, нить тянется — тихий шорох после.
 * До 0.18.2 стежок был шумом 2–3 кГц (центр спектра 2,5–2,8 кГц у всех четырёх, половина энергии — в
 * шипящей полосе 2–4 кГц): все четыре звучали одним «тсс». Теперь главное — в полосе 0,5–2 кГц, которую
 * динамик телефона ещё играет, и стежки различимы по высоте — от ре до ре октавой выше: кисть звучит
 * россыпью, а не машинкой.
 */
export function makeStitch(v: { seed: string; hz: number; tau: number; needle: number; sec: number }): Float32Array {
  const n = len(v.sec).length;
  // толчок: шум, гаснущий за 1,5 мс, — им «ударяют» по мембране
  const kick = noise(n, `kick${v.seed}`);
  for (let i = 0; i < n; i++) kick[i] *= Math.exp(-i / RATE / 0.0015);
  const body = new Float32Array(n);
  // резонанс звенит τ = Q / (π·f): добротность — из времени затухания моды; верхние гаснут быстрее.
  // Каждая мода — по своему пику: случайный толчок иначе раскачал бы одну, и стежок звучал бы писком
  const peakOf = (x: Float32Array) => x.reduce((m, y) => Math.max(m, Math.abs(y)), 0) || 1;
  for (const [mul, gain, tauK] of [[1, 1, 1], [1.594, 0.7, 0.7], [2.136, 0.45, 0.5]]) {
    const hz = v.hz * mul;
    const ring = biquad(kick, 'bp', hz, Math.PI * hz * v.tau * tauK);
    const k = gain / peakOf(ring);
    for (let i = 0; i < n; i++) body[i] += k * ring[i];
  }
  const needle = biquad(noise(n, `needle${v.seed}`), 'hp', 2200, 0.7);
  const thread = biquad(biquad(noise(n, `thread${v.seed}`), 'bp', 1600, 0.7), 'lp', 3500, 0.7);
  const bodyPeak = peakOf(body);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const a = t < 0.001 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.001) : 1;
    const tick = v.needle * Math.exp(-t / 0.003) * needle[i];
    // нить: тихий шорох, нарастает за 10 мс и гаснет
    const pull = 0.1 * (1 - Math.exp(-t / 0.01)) * Math.exp(-t / 0.03) * thread[i];
    out[i] = a * (body[i] / bodyPeak + tick + pull);
  }
  return fadeOut(normalize(out, 0.45), 0.015);
}

/**
 * Варианты стежка: основной тон — ре, ми, соль, ля, си второй октавы и ре третьей (пентатоника — любые
 * два подряд не режут слух); основной тон гаснет за 12–16 мс — «тук», а не щелчок и не писк; щелчок
 * иглы у каждого свой, у двух — почти без него. Длина 70–80 мс.
 */
export const STITCHES = [
  { seed: '', hz: 587, tau: 0.016, needle: 0.7, sec: 0.08 },
  { seed: '-2', hz: 659, tau: 0.015, needle: 0.5, sec: 0.08 },
  { seed: '-3', hz: 784, tau: 0.014, needle: 0.2, sec: 0.075 },
  { seed: '-4', hz: 880, tau: 0.014, needle: 0.6, sec: 0.075 },
  { seed: '-5', hz: 988, tau: 0.013, needle: 0.15, sec: 0.07 },
  { seed: '-6', hz: 1175, tau: 0.012, needle: 0.5, sec: 0.07 },
] as const;

/**
 * Удар по колокольчику: короткий шумовой щелчок в полосе 3–6 кГц, 2 мс — у звона появляется
 * «касание», и он звучит не электронно (разбор оформления, 4.3).
 */
function strike(out: Float32Array, at: number, gain: number, seed: string) {
  const s0 = Math.round(at * RATE);
  const n = Math.round(0.012 * RATE);
  const hit = biquad(noise(n, `strike${seed}`), 'bp', 4500, 0.9);
  for (let i = 0; i < n && s0 + i < out.length; i++) out[s0 + i] += gain * Math.exp(-(i / RATE) / 0.002) * hit[i];
}

/**
 * Обертоны колокольчика: основной тон держится, верхние, не кратные ему, гаснут быстро; вторая гармоника
 * чуть расстроена (на 4 цента) — живой звон, а не синус.
 */
const BELL: [number, number, number][] = [[1, 1, 0.5], [2.0046, 0.18, 0.22], [2.76, 0.22, 0.09], [5.4, 0.05, 0.03]];

/** Нить закончена: тихий звон — две ноты колокольчика вверх, до и соль третьей октавы. */
export function makeThread(): Float32Array {
  const out = len(1.0);
  note(out, 0, 1046.5, 0.8, BELL);
  strike(out, 0, 0.35, 'thread-1');
  note(out, 0.11, 1568.0, 0.7, BELL);
  strike(out, 0.11, 0.3, 'thread-2');
  return fadeOut(normalize(out, 0.45), 0.2);
}

/** Картинка готова: до — ми — соль — до выше, мягко и медленнее, чем нить. */
export function makeDone(): Float32Array {
  const out = len(1.9);
  const warm: [number, number, number][] = [[1, 1, 0.8], [2.0, 0.25, 0.35], [3.0, 0.08, 0.15], [2.76, 0.06, 0.08]];
  [1046.5, 1318.5, 1568.0, 2093.0].forEach((hz, i) => {
    note(out, i * 0.16, hz, i === 3 ? 0.9 : 0.75, warm, 0.006);
    strike(out, i * 0.16, 0.25, `done-${i}`);
  });
  return fadeOut(normalize(out, 0.5), 0.35);
}

export const SOUNDS: Record<string, () => Float32Array> = {
  ...Object.fromEntries(STITCHES.map((v, i) => [i ? `stitch-${i + 1}.wav` : 'stitch.wav', () => makeStitch(v)])),
  'thread.wav': makeThread,
  'done.wav': makeDone,
};

if (import.meta.main) {
  for (const [name, make] of Object.entries(SOUNDS)) writeFileSync(join(OUT, name), wav(make()));
  console.log('звуки готовы:', Object.keys(SOUNDS).join(', '));
}
