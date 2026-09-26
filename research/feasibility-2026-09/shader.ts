// Spike: whole grid (fills, "ghost" colours, cross-stitch look, grid lines, selected-colour
// highlight, 1-2 digit numbers) in ONE runtime-effect draw, fed by 3 small textures.
// Runs on CanvasKit (same SkSL front-end as react-native-skia) on the CPU backend just to
// validate that the SkSL compiles under runtime-effect (ES2) rules and that index lookups are exact.
import CanvasKitInit from "canvaskit-wasm/bin/full/canvaskit.js";
import { dirname, join } from "path";

const dir = join(dirname(require.resolve("canvaskit-wasm/package.json")), "bin/full");
const CK: any = await CanvasKitInit({ locateFile: (f: string) => join(dir, f) });

const W = 150, H = 200, K = 32;
// cells texture: R = target palette index, G = 255 if filled, B/A unused
const cells = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { const x = i % W, y = (i / W) | 0; cells[i * 4] = (Math.floor(x / 9) * 5 + Math.floor(y / 7) * 3) % K; cells[i * 4 + 1] = (x + y) % 3 === 0 ? 255 : 0; cells[i * 4 + 3] = 255; }
const pal = new Uint8Array(64 * 4); for (let i = 0; i < K; i++) { pal.set([(i * 53) % 256, (i * 97) % 256, (i * 151) % 256, 255], i * 4); }
// digit atlas 10 glyphs x (16x24) drawn as 7-segment bars (stand-in for a real font atlas / SDF)
const GW = 16, GH = 24; const dig = new Uint8Array(GW * 10 * GH * 4);
const SEG: Record<number, string> = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
const rects: Record<string, number[]> = { a: [3, 2, 10, 3], b: [11, 3, 3, 8], c: [11, 13, 3, 8], d: [3, 19, 10, 3], e: [2, 13, 3, 8], f: [2, 3, 3, 8], g: [3, 10, 10, 3] };
for (let d = 0; d < 10; d++) for (const s of SEG[d]) { const [rx, ry, rw, rh] = rects[s]; for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) { const o = (y * GW * 10 + d * GW + x) * 4; dig[o] = dig[o + 1] = dig[o + 2] = dig[o + 3] = 255; } }

const img = (data: Uint8Array, w: number, h: number) => CK.MakeImage({ width: w, height: h, alphaType: CK.AlphaType.Unpremul, colorType: CK.ColorType.RGBA_8888, colorSpace: CK.ColorSpace.SRGB }, data, w * 4);
const cellsImg = img(cells, W, H), palImg = img(pal, 64, 1), digImg = img(dig, GW * 10, GH);
const nearest = (i: any) => i.makeShaderOptions(CK.TileMode.Clamp, CK.TileMode.Clamp, CK.FilterMode.Nearest, CK.MipmapMode.None);
const linear = (i: any) => i.makeShaderOptions(CK.TileMode.Clamp, CK.TileMode.Clamp, CK.FilterMode.Linear, CK.MipmapMode.None);

const sksl = `
uniform shader cells;   // W x H, nearest
uniform shader palette; // 64 x 1, nearest
uniform shader digits;  // 10 glyphs of GW x GH, linear
uniform float2 grid;    // W, H
uniform float2 glyph;   // GW, GH
uniform float cellPx;   // on-screen pixels per cell (LOD for lines/digits)
uniform float selected; // selected palette index
half4 main(float2 p) {  // p is already in cell units (local matrix)
  float2 cell = floor(p);
  if (cell.x < 0 || cell.y < 0 || cell.x >= grid.x || cell.y >= grid.y) return half4(0.93, 0.91, 0.86, 1);
  half4 c = cells.eval(cell + 0.5);
  float idx = floor(c.r * 255 + 0.5);
  half3 col = palette.eval(float2(idx + 0.5, 0.5)).rgb;
  float2 f = fract(p);
  half3 o;
  if (c.g > 0.5) {                       // filled: cross-stitch "X"
    float d = min(abs(f.x - f.y), abs(f.x + f.y - 1));
    float x = 1 - smoothstep(0.10, 0.18, d);
    o = mix(col * 0.78, col, x);
  } else {                               // unfilled: pale ghost + number
    half g = dot(col, half3(0.299, 0.587, 0.114));
    o = mix(half3(1), half3(g), 0.22);
    if (abs(idx - selected) < 0.5) o *= 0.82;
    if (cellPx >= 14) {
      float n = idx + 1;                 // numbers shown 1-based
      float tens = floor(n / 10), ones = n - tens * 10;
      float two = step(9.5, n);
      float2 q = (f - float2(0.5 - 0.22 * two, 0.5)) / float2(0.34, 0.52) + 0.5; // glyph box (ones or single digit)
      float2 q2 = (f - float2(0.28, 0.5)) / float2(0.34, 0.52) + 0.5;            // tens glyph box
      half a = 0;
      if (q.x > 0 && q.x < 1 && q.y > 0 && q.y < 1) a = digits.eval(float2((ones + q.x) * glyph.x, q.y * glyph.y)).a;
      if (two > 0.5 && q2.x > 0 && q2.x < 1 && q2.y > 0 && q2.y < 1) a = max(a, digits.eval(float2((tens + q2.x) * glyph.x, q2.y * glyph.y)).a);
      o = mix(o, half3(0.25), a);
    }
  }
  if (cellPx >= 6) {                     // 1-device-pixel grid lines
    float2 e = min(f, 1 - f) * cellPx;
    float line = 1 - smoothstep(0.5, 1.2, min(e.x, e.y));
    o = mix(o, half3(0.55), line * 0.6);
  }
  return half4(o, 1);
}`;
const effect = CK.RuntimeEffect.Make(sksl, (e: string) => console.error("SkSL error:", e));
if (!effect) throw new Error("compile failed");

const SW = 1080, SH = 1800;
const surface = CK.MakeSurface(SW, SH); // CPU raster surface
const canvas = surface.getCanvas();
const paint = new CK.Paint();
function draw(cellPx: number, panX: number, panY: number) {
  // local matrix maps cell space -> screen: screen = cell * cellPx + pan
  const lm = CK.Matrix.multiply(CK.Matrix.translated(panX, panY), CK.Matrix.scaled(cellPx, cellPx));
  const shader = effect.makeShaderWithChildren([W, H, GW, GH, cellPx, 5], [nearest(cellsImg), nearest(palImg), linear(digImg)], lm);
  paint.setShader(shader);
  canvas.drawRect(CK.XYWHRect(0, 0, SW, SH), paint);
  surface.flush();
  shader.delete();
}
for (const [cellPx, label] of [[7, "zoomed out (whole grid)"], [40, "zoomed in (digits on)"]] as const) {
  const t0 = performance.now(); const N = 5;
  for (let i = 0; i < N; i++) draw(cellPx, 3, 3);
  const ms = (performance.now() - t0) / N;
  const px = surface.makeImageSnapshot().readPixels(0, 0, { width: SW, height: SH, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB });
  // verify a few filled cells: colour at a point on the X diagonal must equal the palette colour exactly
  let ok = 0, bad = 0;
  for (let cy = 0; cy < Math.min(H, Math.floor((SH - 3) / cellPx)); cy += 5) for (let cx = 0; cx < Math.min(W, Math.floor((SW - 3) / cellPx)); cx += 5) {
    const i = cy * W + cx; if (!cells[i * 4 + 1]) continue;
    const sx = Math.floor(3 + (cx + 0.5) * cellPx), sy = Math.floor(3 + (cy + 0.5) * cellPx);
    const o = (sy * SW + sx) * 4; const k = cells[i * 4];
    if (Math.abs(px[o] - pal[k * 4]) <= 1 && Math.abs(px[o + 1] - pal[k * 4 + 1]) <= 1 && Math.abs(px[o + 2] - pal[k * 4 + 2]) <= 1) ok++; else bad++;
  }
  console.log(`${label}: cellPx=${cellPx}, CPU-raster ${SW}x${SH} one draw = ${ms.toFixed(1)} ms; exact palette match at filled cell centres: ${ok} ok / ${bad} mismatched`);
  if (cellPx === 40) await Bun.write(join(import.meta.dir, "shader-frame.png"), surface.makeImageSnapshot().encodeToBytes());
}
