// Графика карточки RuStore и сайта студии (store/README.md): баннер 1024 × 500 по-русски
// и по-английски. Всё рисуется кодом: вышивка — тем же шейдером, что на телефоне, надписи —
// шрифтами студии (Kurale, Onest). Только картинки, которые можно выпускать: свои орнаменты
// и снимки Прокудина-Горского — не картины из российских музеев (docs/09-content.md, §2).
//
//   bun tools/store/graphics.ts   → store/graphics/feature-<ru|en>.png, store/site/*.webp
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { type Pattern } from '../../src/engine/pattern';
import { rng } from '../../src/engine/seed';
import { canvasKit, renderFrame } from '../canvas/ck';
import { buildAll, type Built } from '../content/build';

const ROOT = join(import.meta.dir, '..', '..');
const FONTS = join(ROOT, 'node_modules', '@expo-google-fonts');

const TEXT = {
  ru: { title: 'Узоры', sub: 'Вышивка крестиком по номерам', lines: ['Орнаменты, картины и Россия в цвете', 'Новая картинка каждый день', 'Без интернета и без рекламы'] },
  en: { title: 'Uzory', sub: 'Cross-stitch by numbers', lines: ['Folk ornaments, paintings, old Russia in colour', 'A new picture every day', 'Works offline, no ads'] },
} as const;

/** Узор, вышитый наполовину сверху вниз: видно и крестики, и номера. */
function halfStitched(p: Pattern, share: number): Uint8Array {
  const r = rng(7);
  return Uint8Array.from(p.cells, (_, i) => {
    const y = Math.floor(i / p.w) / p.h;
    return y < share - 0.08 || (y < share + 0.08 && r() < 0.5) ? 1 : 0;
  });
}

async function stitchTile(p: Pattern, size: number, s: number): Promise<Buffer> {
  // кадр — середина узора при масштабе s
  const tx = size / 2 - (p.w / 2) * s;
  const ty = size / 2 - (p.h / 2) * s;
  const f = await renderFrame(p, halfStitched(p, 0.55), { width: size, height: size, s, tx, ty, near: true, selected: 0, font: true });
  return Buffer.from(f.png());
}

async function bandTile(p: Pattern, width: number, s: number): Promise<Buffer> {
  const reps = Math.ceil(width / (p.w * s)) + 1;
  const wide: Pattern = { ...p, w: p.w * reps, cells: new Uint8Array(p.w * reps * p.h) };
  for (let y = 0; y < p.h; y++) for (let x = 0; x < wide.w; x++) wide.cells[y * wide.w + x] = p.cells[y * p.w + (x % p.w)];
  const f = await renderFrame(wide, new Uint8Array(wide.cells.length).fill(1), { width, height: Math.round(p.h * s), s, tx: 0, ty: 0, near: true });
  return Buffer.from(f.png());
}

async function textLayer(lang: 'ru' | 'en', width: number, height: number): Promise<Buffer> {
  const CK = await canvasKit();
  const kurale = CK.Typeface.MakeTypefaceFromData(readFileSync(join(FONTS, 'kurale/400Regular/Kurale_400Regular.ttf')).buffer);
  const onest = CK.Typeface.MakeTypefaceFromData(readFileSync(join(FONTS, 'onest/500Medium/Onest_500Medium.ttf')).buffer);
  const surface = CK.MakeSurface(width, height);
  const c = surface.getCanvas();
  c.clear(CK.TRANSPARENT);
  const paint = new CK.Paint();
  paint.setAntiAlias(true);
  const t = TEXT[lang];
  paint.setColor(CK.Color(0xb3, 0x16, 0x2f, 1));
  c.drawText(t.title, 56, 150, paint, new CK.Font(kurale, 112));
  paint.setColor(CK.Color(0x1a, 0x1b, 0x1e, 1));
  c.drawText(t.sub, 60, 210, paint, new CK.Font(onest, 30));
  paint.setColor(CK.Color(0x4b, 0x4f, 0x4c, 1));
  const small = new CK.Font(onest, 25);
  t.lines.forEach((line, i) => {
    paint.setColor(CK.Color(0xb3, 0x16, 0x2f, 1));
    c.drawRect(CK.XYWHRect(62, 262 + i * 44, 12, 12), paint);
    paint.setColor(CK.Color(0x4b, 0x4f, 0x4c, 1));
    c.drawText(line, 88, 276 + i * 44, paint, small);
  });
  surface.flush();
  return Buffer.from(surface.makeImageSnapshot().encodeToBytes());
}

export async function feature(lang: 'ru' | 'en', built: Built[]): Promise<Buffer> {
  const W = 1024;
  const H = 500;
  const pick = (id: string) => built.find((b) => b.card.id === id && !b.trial)?.pattern ?? built.find((b) => b.card.id === id)!.pattern;
  const star = pick('zvezda-alatyr');
  const band = pick('kayma-rushnika');
  const tile = await stitchTile(star, 380, 14.5);
  const strip = await bandTile(band, W, 5);
  const text = await textLayer(lang, 640, 440);
  const frame = Buffer.from(`<svg width="392" height="392"><rect x="1" y="1" width="390" height="390" rx="6" fill="none" stroke="#cfd1c6" stroke-width="2"/></svg>`);
  return sharp({ create: { width: W, height: H, channels: 3, background: '#ecede6' } })
    .composite([
      { input: text, left: 0, top: 0 },
      { input: tile, left: W - 380 - 42, top: 30 },
      { input: frame, left: W - 380 - 48, top: 24 },
      { input: strip, left: 0, top: H - 65 },
    ])
    .png()
    .toBuffer();
}

if (import.meta.main) {
  const { built } = await buildAll();
  for (const lang of ['ru', 'en'] as const) {
    const png = await feature(lang, built);
    await sharp(png).toFile(join(ROOT, 'store', 'graphics', `feature-${lang}.png`));
    await sharp(png).webp({ quality: 88 }).toFile(join(ROOT, 'store', 'site', `uzory-feature${lang === 'en' ? '-en' : ''}.webp`));
  }
  await sharp(join(ROOT, 'store', 'graphics', 'icon-512.png')).resize(256).webp({ quality: 90 }).toFile(join(ROOT, 'store', 'site', 'uzory-icon.webp'));
  console.log('графика готова');
}
