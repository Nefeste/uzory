// Фон вышивания (разбор оформления 31.10.2026, 4.8; docs/08-game-design.md, «Звук и музыка»): по желанию
// игрока, выключен сразу после установки. Синтезирован кодом, как звуки (tools/audio/gen.ts): своё, без
// чужих записей. Петли по 60 с — конец плавно переходит в начало, — Opus моно, 48 кбит/с, а не 32, как
// музыка (tools/audio/music.ts): шум кодеку труднее всего, и на 32 кбит/с он посреди петли сужал полосу —
// шелест заметно тускнел. Шум — из генератора игры с фиксированным зерном: при том же ffmpeg файлы те же до байта.
//
//   bun tools/audio/ambience.ts → assets/ambience/rain.webm и fire.webm (нужен ffmpeg с libopus; FFMPEG=…)
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash32, rng } from '../../src/engine/seed';
import { biquad, noise, RATE, wav } from './gen';

/** Длина петли и перехода её конца в начало, с. */
export const LOOP_SEC = 60;
const XFADE_SEC = 2;

/** Средняя громкость обоих фонов, дБ от полной шкалы: дождь и печь звучат одинаково громко. */
const RMS_DB = -26;

/** К средней громкости RMS_DB; пики при этом остаются ниже полной шкалы. */
function level(x: Float32Array): Float32Array {
  let sum = 0;
  let peak = 0;
  for (const v of x) {
    if (!Number.isFinite(v)) throw new Error('ambience: NaN or Infinity');
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const k = Math.min(10 ** (RMS_DB / 20) / Math.sqrt(sum / x.length), 0.9 / peak);
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

/** Короткий всплеск шума в полосе `hz`, гаснет за `tau` секунд. */
function burst(seed: string, hz: number, q: number, tau: number): Float32Array {
  const n = Math.round(tau * 6 * RATE);
  const x = biquad(noise(n, seed), 'bp', hz, q);
  for (let i = 0; i < n; i++) x[i] *= Math.exp(-(i / RATE) / tau);
  return x;
}

/** Петля: последние XFADE_SEC секунд плавно переходят в начало. */
function loop(x: Float32Array): Float32Array {
  const L = Math.round(LOOP_SEC * RATE);
  const F = Math.round(XFADE_SEC * RATE);
  const out = x.slice(0, L);
  for (let i = 0; i < F; i++) {
    const w = i / F;
    out[i] = x[i] * w + x[L + i] * (1 - w);
  }
  return out;
}

/** Медленная «дрожь» громкости: сглаженное случайное блуждание, 0,8…1,2. */
function flicker(n: number, seed: string, sec: number): Float32Array {
  const r = rng(hash32(`uzory-audio-${seed}`));
  const out = new Float32Array(n);
  const k = 1 / (sec * RATE);
  let v = 1;
  let target = 1;
  for (let i = 0; i < n; i++) {
    if (i % Math.round(sec * RATE) === 0) target = 0.8 + 0.4 * r();
    v += (target - v) * k * 4;
    out[i] = v;
  }
  return out;
}

/** Дождь за окном: ровный шелест, тихий гул и капли по стеклу — дюжина в секунду, разной силы. */
export function makeRain(): Float32Array {
  const n = Math.round((LOOP_SEC + XFADE_SEC) * RATE);
  const hiss = biquad(biquad(noise(n, 'rain-hiss'), 'hp', 900, 0.7), 'lp', 6000, 0.7);
  const body = biquad(noise(n, 'rain-body'), 'bp', 500, 0.5);
  const swell = flicker(n, 'rain-swell', 6);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = swell[i] * (0.5 * hiss[i] + 0.3 * body[i]);
  const drops = Array.from({ length: 6 }, (_, k) => burst(`rain-drop-${k}`, 2200 + 500 * k, 2.5, 0.006 + 0.002 * (k % 3)));
  const r = rng(hash32('uzory-audio-rain-drops'));
  for (let at = 0; at < n; at += Math.round((0.02 + 0.14 * r()) * RATE)) {
    const d = drops[Math.floor(r() * drops.length)];
    const g = 0.6 + 1.4 * r() * r();
    for (let i = 0; i < d.length && at + i < n; i++) out[at + i] += g * d[i];
  }
  return level(loop(out));
}

/** Печь: глухой гул пламени, который «дышит», редкие треск угольков и щелчки поленьев. */
export function makeFire(): Float32Array {
  const n = Math.round((LOOP_SEC + XFADE_SEC) * RATE);
  const rumble = biquad(biquad(noise(n, 'fire-rumble'), 'lp', 700, 0.7), 'hp', 120, 0.7);
  const roar = biquad(noise(n, 'fire-roar'), 'bp', 1200, 0.4);
  const breath = flicker(n, 'fire-breath', 0.7);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = breath[i] * (0.6 * rumble[i] + 0.12 * roar[i]);
  const crackles = Array.from({ length: 8 }, (_, k) => burst(`fire-crackle-${k}`, 2500 + 450 * k, 1.5, 0.0012 + 0.0004 * (k % 4)));
  const pops = Array.from({ length: 3 }, (_, k) => burst(`fire-pop-${k}`, 800 + 300 * k, 1.2, 0.012));
  const r = rng(hash32('uzory-audio-fire-sparks'));
  // треск — пачками: несколько угольков подряд, потом тишина
  for (let at = 0; at < n;) {
    const run = 1 + Math.floor(r() * 5);
    for (let j = 0; j < run && at < n; j++) {
      const c = crackles[Math.floor(r() * crackles.length)];
      const g = 0.5 + 1.5 * r();
      for (let i = 0; i < c.length && at + i < n; i++) out[at + i] += g * c[i];
      at += Math.round((0.01 + 0.06 * r()) * RATE);
    }
    at += Math.round((0.15 + 0.9 * r()) * RATE);
  }
  for (let at = Math.round(2 * RATE); at < n; at += Math.round((2.5 + 5 * r()) * RATE)) {
    const p = pops[Math.floor(r() * pops.length)];
    for (let i = 0; i < p.length && at + i < n; i++) out[at + i] += 2.2 * p[i];
  }
  return level(loop(out));
}

export const AMBIENCE: Record<string, () => Float32Array> = { rain: makeRain, fire: makeFire };

if (import.meta.main) {
  const FFMPEG = process.env.FFMPEG || 'ffmpeg';
  const out = join(import.meta.dir, '..', '..', 'assets', 'ambience');
  mkdirSync(out, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'uzory-ambience-'));
  for (const [id, make] of Object.entries(AMBIENCE)) {
    const src = join(tmp, `${id}.wav`);
    writeFileSync(src, wav(make()));
    const r = spawnSync(FFMPEG, ['-y', '-i', src, '-ar', '24000', '-ac', '1', '-c:a', 'libopus', '-b:a', '48k', '-vbr', 'on', '-cutoff', '12000',
      '-compression_level', '10', '-application', 'audio', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
      '-f', 'webm', join(out, `${id}.webm`)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr?.slice(-1500) ?? r.error?.message}`);
  }
  console.log('фон готов:', Object.keys(AMBIENCE).map((id) => `assets/ambience/${id}.webm`).join(', '));
}
