// Quick feasibility experiment: photo -> grid pattern (area-average in linear light,
// k-means++ in OKLab with seeded PRNG, palette merge by min distance, speckle cleanup),
// then measure fragmentation and compressed size. Not production code.
import jpeg from "jpeg-js";
import { deflateSync } from "fflate";
import { readFileSync } from "fs";

const srgbToLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const linToSrgb = (c: number) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); };
function linToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToSrgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
          linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
          linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function downscaleToOklab(img: { width: number; height: number; data: Uint8Array }, W: number) {
  const H = Math.round((img.height / img.width) * W);
  const lab = new Float64Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * img.height) / H), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * img.width) / W), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / W));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * img.width + xx) * 4;
        r += srgbToLin(img.data[i]); g += srgbToLin(img.data[i + 1]); b += srgbToLin(img.data[i + 2]); n++;
      }
      const o = linToOklab(r / n, g / n, b / n);
      lab.set(o, (y * W + x) * 3);
    }
  }
  return { W, H, lab };
}
const d2 = (a: Float64Array, i: number, c: number[]) => { const x = a[i] - c[0], y = a[i + 1] - c[1], z = a[i + 2] - c[2]; return x * x + y * y + z * z; };

function kmeans(lab: Float64Array, n: number, K: number, seed: number) {
  const rnd = mulberry32(seed);
  const cents: number[][] = [];
  const first = Math.floor(rnd() * n) * 3; cents.push([lab[first], lab[first + 1], lab[first + 2]]);
  const dist = new Float64Array(n).fill(Infinity);
  while (cents.length < K) { // k-means++ init
    let sum = 0; const c = cents[cents.length - 1];
    for (let i = 0; i < n; i++) { dist[i] = Math.min(dist[i], d2(lab, i * 3, c)); sum += dist[i]; }
    let t = rnd() * sum, pick = n - 1;
    for (let i = 0; i < n; i++) { t -= dist[i]; if (t <= 0) { pick = i; break; } }
    cents.push([lab[pick * 3], lab[pick * 3 + 1], lab[pick * 3 + 2]]);
  }
  const assign = new Uint8Array(n);
  for (let it = 0; it < 60; it++) {
    let changed = 0;
    for (let i = 0; i < n; i++) { let best = 0, bd = Infinity; for (let k = 0; k < cents.length; k++) { const dd = d2(lab, i * 3, cents[k]); if (dd < bd) { bd = dd; best = k; } } if (assign[i] !== best) { assign[i] = best; changed++; } }
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { const a = acc[assign[i]]; a[0] += lab[i * 3]; a[1] += lab[i * 3 + 1]; a[2] += lab[i * 3 + 2]; a[3]++; }
    for (let k = 0; k < cents.length; k++) if (acc[k][3] > 0) cents[k] = [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]];
    if (it > 0 && changed === 0) break;
  }
  return { cents, assign };
}
const cdist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function mergeClose(cents: number[][], assign: Uint8Array, minD: number) {
  const counts = () => { const c = new Array(cents.length).fill(0); for (const a of assign) c[a]++; return c; };
  for (;;) {
    const cnt = counts(); let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < cents.length; i++) for (let j = i + 1; j < cents.length; j++) { if (!cnt[i] || !cnt[j]) continue; const d = cdist(cents[i], cents[j]); if (d < bd) { bd = d; bi = i; bj = j; } }
    if (bd >= minD || bi < 0) break;
    const wi = cnt[bi], wj = cnt[bj];
    cents[bi] = cents[bi].map((v, k) => (v * wi + cents[bj][k] * wj) / (wi + wj));
    for (let i = 0; i < assign.length; i++) if (assign[i] === bj) assign[i] = bi;
  }
  // compact
  const used = [...new Set(assign)].sort((a, b) => a - b); const remap = new Map(used.map((u, i) => [u, i]));
  for (let i = 0; i < assign.length; i++) assign[i] = remap.get(assign[i])!;
  return used.map((u) => cents[u]);
}

function components(assign: Uint8Array, W: number, H: number) {
  const comp = new Int32Array(W * H).fill(-1); const sizes: number[] = []; const stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (comp[s] >= 0) continue; const id = sizes.length; let sz = 0; comp[s] = id; stack.push(s);
    while (stack.length) { const p = stack.pop()!; sz++; const x = p % W, y = (p / W) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (const q of nb) if (q >= 0 && comp[q] < 0 && assign[q] === assign[s]) { comp[q] = id; stack.push(q); } }
    sizes.push(sz);
  }
  return { comp, sizes };
}
function stats(assign: Uint8Array, W: number, H: number) {
  const { sizes } = components(assign, W, H); const n = W * H;
  const singles = sizes.filter((s) => s === 1).length; const small = sizes.filter((s) => s <= 3).reduce((a, s) => a + s, 0);
  return { components: sizes.length, singlesPct: +(100 * singles / n).toFixed(1), cellsInCompLE3Pct: +(100 * small / n).toFixed(1), meanCompSize: +(n / sizes.length).toFixed(1) };
}
function cleanup(assign: Uint8Array, W: number, H: number, minSize: number, passes = 6) {
  for (let pass = 0; pass < passes; pass++) {
    const { comp, sizes } = components(assign, W, H); let changed = 0;
    // for each small component pick the neighbouring colour with the longest shared border
    const border = new Map<number, Map<number, number>>();
    for (let p = 0; p < W * H; p++) { const id = comp[p]; if (sizes[id] >= minSize) continue; const x = p % W, y = (p / W) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q < 0 || comp[q] === id) continue; let m = border.get(id); if (!m) border.set(id, (m = new Map())); m.set(assign[q], (m.get(assign[q]) ?? 0) + 1); } }
    const target = new Map<number, number>();
    for (const [id, m] of border) { let best = -1, bc = -1; for (const [c, v] of [...m].sort((a, b) => a[0] - b[0])) if (v > bc) { bc = v; best = c; } target.set(id, best); }
    for (let p = 0; p < W * H; p++) { const t = target.get(comp[p]); if (t !== undefined && t >= 0) { assign[p] = t; changed++; } }
    if (!changed) break;
  }
}

const files = process.argv.slice(2);
for (const f of files) {
  const img = jpeg.decode(readFileSync(f), { useTArray: true });
  for (const W of [60, 100, 150]) {
    for (const K of [16, 32]) {
      const t0 = performance.now();
      const { H, lab } = downscaleToOklab(img, W); const n = W * H;
      const { cents, assign } = kmeans(lab, n, K, 12345);
      const pal = mergeClose(cents, assign, 0.05);
      const before = stats(assign, W, H);
      cleanup(assign, W, H, 3);
      const after = stats(assign, W, H);
      const t1 = performance.now();
      let minD = Infinity; for (let i = 0; i < pal.length; i++) for (let j = i + 1; j < pal.length; j++) minD = Math.min(minD, cdist(pal[i], pal[j]));
      const usedColors = new Set(assign).size;
      const packed = deflateSync(assign, { level: 9 });
      const rgb = pal.map((c) => oklabToSrgb(c[0], c[1], c[2]));
      console.log(JSON.stringify({ file: f.split("/").pop(), grid: `${W}x${H}`, cells: n, K, colorsAfterMerge: pal.length, colorsUsedAfterCleanup: usedColors, minOklabDist: +minD.toFixed(3), before, after, rawBytes: n, deflateBytes: packed.length, ms: Math.round(t1 - t0), sample: rgb.slice(0, 3) }));
    }
  }
}
