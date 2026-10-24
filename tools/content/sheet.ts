// Лист превью (docs/specs/2026-09-content-pipeline.md, «Что увидит владелец»): по строке на
// картинку — исходник с рамкой кадра, узор «Крестиком» и «Мозаикой» тем же шейдером, что
// на телефоне, и числа проверок. По листу владелец говорит «да» или «нет».
//
//   bun tools/content/sheet.ts                  все картинки → dist/sheet/*.png
//   bun tools/content/sheet.ts --only russia
//   bun tools/content/sheet.ts --ids a,b,c --name fragments   выбранные → dist/sheet/fragments-N.png
//   bun tools/content/sheet.ts --variants <id>  сетка 70/100/120 × 16/24/32 нити (П3)
//   bun tools/content/sheet.ts --deltas <id>    сетка 70/100/120 × порог различимости 0,05/0,04/0,03
//   bun tools/content/sheet.ts --smooth a,b,c --name X   как сейчас и сглаживание 1 и 2 (smooth.ts)
//                                               → dist/sheet/smooth-X-N.png
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { estimateMinutes, type Pattern } from '../../src/engine/pattern';
import { renderFrame } from '../canvas/ck';
import { type Card, ROOT, readCard, listCards } from './cards';
import { type Built, buildAll, buildCard } from './build';
import { decode } from './image';
import { buildPattern } from '../../src/engine/build/palette';
import { photoGrid } from '../../src/engine/build/photo';
import { SIMPLIFY_CLEAN } from '../../src/engine/build/simplify';
import { checkPattern } from './checks';

const OUT = join(ROOT, 'dist', 'sheet');
const H = 420;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Узор целиком издалека — как на телефоне, когда номера не видны: вышитое цветом нити. */
async function far(p: Pattern, height = H): Promise<Buffer> {
  const s = Math.max(2, Math.min(24, Math.floor(height / Math.max(p.w, p.h))));
  const all = new Uint8Array(p.cells.length).fill(1);
  const f = await renderFrame(p, all, { width: p.w * s, height: p.h * s, s, tx: 0, ty: 0, near: false });
  return sharp(Buffer.from(f.png())).resize({ height, width: Math.round((height * p.w) / p.h), kernel: 'nearest' }).png().toBuffer();
}

/**
 * Кусок узора вблизи — как на экране вышивания: левая половина вышита, правая с номерами.
 * Для маленьких узоров — весь узор.
 */
async function close(p: Pattern, mosaic: boolean, size = H): Promise<Buffer> {
  const n = Math.min(22, Math.max(p.w, p.h));
  const s = size / n;
  const cx = p.w / 2;
  const cy = p.h / 2;
  const stitched = Uint8Array.from(p.cells, (_, i) => ((i % p.w) < cx ? 1 : 0));
  const f = await renderFrame(p, stitched, { width: size, height: size, s, tx: size / 2 - cx * s, ty: size / 2 - cy * s, near: true, mosaic, font: true });
  return Buffer.from(f.png());
}

/** Для орнаментов: узор целиком вышитым. */
async function render(p: Pattern, mosaic: boolean, height = H): Promise<Buffer> {
  const s = Math.max(4, Math.min(24, Math.floor(height / Math.max(p.w, p.h))));
  const all = new Uint8Array(p.cells.length).fill(1);
  const f = await renderFrame(p, all, { width: p.w * s, height: p.h * s, s, tx: 0, ty: 0, near: true, mosaic, font: true });
  return sharp(Buffer.from(f.png())).resize({ height, width: Math.round((height * p.w) / p.h), kernel: 'nearest' }).png().toBuffer();
}

async function sourceTile(card: Card, h = H): Promise<Buffer | null> {
  if (!card.source.file) return null;
  const file = join(card.dir, card.source.file);
  const img = sharp(file).rotate();
  const meta = await img.metadata();
  const w0 = meta.width ?? 1;
  const h0 = meta.height ?? 1;
  const w = Math.round((w0 * h) / h0);
  // рамка кадра, у старинной схемы — рамка сетки
  const [l, t, r, bt] = card.pattern?.chart ?? card.pattern?.crop ?? [0, 0, 1, 1];
  const frame = Buffer.from(`<svg width="${w}" height="${h}"><rect x="${l * w}" y="${t * h}" width="${(r - l) * w}" height="${(bt - t) * h}" fill="none" stroke="#b3162f" stroke-width="3"/></svg>`);
  // ширина — та же, что у рамки: sharp округляет её по-своему, и рамка на пиксель шире не ляжет
  return img.resize({ width: w, height: h, fit: 'fill' }).composite([{ input: frame }]).png().toBuffer();
}

function caption(b: Built): Buffer {
  const s = b.checked.stats;
  const lines = [
    `${b.picture.title}`,
    `${b.card.id} · ${b.checked.size} ${b.pattern.w}×${b.pattern.h} · ${b.pattern.threads.length} нитей · ≈ ${estimateMinutes(b.pattern)} мин`,
    `одиночных ${s.singles.toFixed(2)} % · мелкие пятна ${s.small.toFixed(2)} % · различимость ${Number.isFinite(s.minDelta) ? s.minDelta.toFixed(3) : '—'}`,
    b.log ? `нитей: заказано ${b.log.asked} → после слияния ${b.log.afterMerge} → итог ${b.log.final}; одиночных до чистки ${b.log.singlesBefore.toFixed(1)} %` : 'нарисован',
    b.trial ? `не в выпуск: ${b.trial}` : 'можно в выпуск',
    ...b.checked.warnings.slice(0, 3).map((w) => `⚠ ${w}`),
  ];
  const text = lines.map((t, i) => `<text x="12" y="${28 + i * 24}" font-family="DejaVu Sans, sans-serif" font-size="${i ? 15 : 20}" fill="#1a1b1e">${esc(t)}</text>`).join('');
  return Buffer.from(`<svg width="1400" height="${40 + lines.length * 24}"><rect width="100%" height="100%" fill="#f7f7f2"/>${text}</svg>`);
}

async function row(b: Built): Promise<Buffer> {
  const big = Math.max(b.pattern.w, b.pattern.h) > 40;
  const tiles = (big
    ? [await sourceTile(b.card), await far(b.pattern), await close(b.pattern, false), await close(b.pattern, true)]
    : [await sourceTile(b.card), await render(b.pattern, false), await render(b.pattern, true)]).filter(Boolean) as Buffer[];
  const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
  const cap = caption(b);
  const capMeta = await sharp(cap).metadata();
  const width = Math.max(1400, metas.reduce((s, m) => s + (m.width ?? 0) + 16, 16));
  const height = H + 32 + (capMeta.height ?? 0);
  let x = 16;
  const parts = tiles.map((t, i) => {
    const part = { input: t, left: x, top: 16 };
    x += (metas[i].width ?? 0) + 16;
    return part;
  });
  return sharp({ create: { width, height, channels: 3, background: '#ecede6' } })
    .composite([...parts, { input: cap, left: 0, top: H + 24 }]).png().toBuffer();
}

async function stack(rows: Buffer[], file: string) {
  const metas = await Promise.all(rows.map((r) => sharp(r).metadata()));
  const width = Math.max(...metas.map((m) => m.width ?? 0));
  const height = metas.reduce((s, m) => s + (m.height ?? 0), 0);
  let y = 0;
  const parts = rows.map((r, i) => {
    const p = { input: r, left: 0, top: y };
    y += metas[i].height ?? 0;
    return p;
  });
  await sharp({ create: { width, height, channels: 3, background: '#ecede6' } }).composite(parts).png().toFile(file);
  console.log(file);
}

async function variants(id: string, mode: 'threads' | 'deltas') {
  const file = listCards().find((f) => f.endsWith(`/${id}.yaml`));
  if (!file) throw new Error(`карточки ${id} нет`);
  const { card, errors } = readCard(file);
  if (!card || !card.pattern) throw new Error(errors.join('; ') || 'карточка без исходника');
  const raster = await decode(join(card.dir, card.source.file!));
  const tiles: Buffer[] = [];
  const second = mode === 'threads' ? [16, 24, 32] : [0.05, 0.04, 0.03];
  for (const size of [70, 100, 120]) {
    for (const v of second) {
      // сетка — как у карточки (кадр, цвет клетки, насыщенность, упрощение), меняются размер и нити
      const g = photoGrid(raster, { ...card.pattern, size });
      const opts = mode === 'threads' ? { threads: v } : { threads: 32, minDelta: v };
      const { pattern, log } = buildPattern(g, { id: card.id, v: card.v, ...opts, clean: SIMPLIFY_CLEAN[card.pattern.simplify ?? 0] });
      const c = checkPattern(pattern, card);
      const img = await far(pattern, 330);
      const what = mode === 'threads' ? `заказано ${v}` : `порог ${v.toFixed(2)}`;
      const note = c.errors[0] ?? `одиночных ${c.stats.singles.toFixed(2)} %, различимость ${c.stats.minDelta.toFixed(3)}`;
      const label = Buffer.from(`<svg width="380" height="44"><rect width="100%" height="100%" fill="#f7f7f2"/><text x="8" y="18" font-family="DejaVu Sans" font-size="14">${size} клеток · ${what} → ${log.final} нитей</text><text x="8" y="37" font-family="DejaVu Sans" font-size="12" fill="${c.errors.length ? '#b3162f' : '#1f3c34'}">${esc(note.slice(0, 60))}</text></svg>`);
      const m = await sharp(img).metadata();
      const w = Math.min(380, m.width ?? 380);
      const fitted = (m.width ?? 0) > 380 ? await sharp(img).resize({ width: 380 }).toBuffer() : img;
      tiles.push(await sharp({ create: { width: 380, height: 390, channels: 3, background: '#ecede6' } })
        .composite([{ input: fitted, left: Math.max(0, Math.round((380 - w) / 2)), top: 0 }, { input: label, left: 0, top: 344 }]).png().toBuffer());
    }
  }
  const parts = tiles.map((t, i) => ({ input: t, left: (i % 3) * 390, top: Math.floor(i / 3) * 400 }));
  mkdirSync(OUT, { recursive: true });
  const out = join(OUT, `${mode === 'threads' ? 'variants' : 'deltas'}-${id}.png`);
  await sharp({ create: { width: 1170, height: 1200, channels: 3, background: '#ecede6' } }).composite(parts).png().toFile(out);
  console.log(out);
}

/** Подпись под плиткой листа сглаживания. */
function smoothLabel(lines: string[], width: number): Buffer {
  const text = lines.map((t, i) => `<text x="8" y="${22 + i * 21}" font-family="DejaVu Sans, sans-serif" font-size="${i ? 15 : 18}" fill="${t.startsWith('⚠') ? '#b3162f' : '#1a1b1e'}">${esc(t)}</text>`).join('');
  return Buffer.from(`<svg width="${width}" height="${14 + lines.length * 21}"><rect width="100%" height="100%" fill="#f7f7f2"/>${text}</svg>`);
}

/**
 * Лист сглаживания (src/engine/build/smooth.ts): по строке на картинку — исходник с кадром, узор
 * как сейчас, сглаживание 1 и 2; издалека вышито целиком, под ним — кусок из середины вблизи, как на
 * экране вышивания, и числа проверок. Карточки не меняются: сглаживание — на копии в памяти.
 */
async function smoothSheet(ids: string[], name: string) {
  const files = listCards();
  const rows: Buffer[] = [];
  for (const id of ids) {
    const file = files.find((f) => f.endsWith(`/${id}.yaml`));
    if (!file) throw new Error(`карточки ${id} нет`);
    const { card, errors } = readCard(file);
    if (!card?.pattern || card.pattern.chart) throw new Error(`${id}: ${errors.join('; ') || 'не снимок и не картина'}`);
    const tiles: { img: Buffer; cap: string[] }[] = [];
    const src = await sourceTile(card, 360);
    tiles.push({ img: src!, cap: [card.title, `${id} · сетка ${card.pattern.size}, заказано ${card.pattern.threads} нитей`] });
    for (const level of [0, 1, 2] as const) {
      const variant: Card = level ? { ...card, pattern: { ...card.pattern, simplify: undefined, smooth: level } } : card;
      const t = performance.now();
      const b = await buildCard(variant);
      const ms = performance.now() - t;
      const c = checkPattern(b.pattern, variant, b.focus);
      const s = c.stats;
      const img = await far(b.pattern, 360);
      const near = await close(b.pattern, false, 300);
      const m = await sharp(img).metadata();
      const width = Math.max(m.width ?? 0, 300);
      const stacked = await sharp({ create: { width, height: 360 + 12 + 300, channels: 3, background: '#ecede6' } })
        .composite([{ input: img, left: 0, top: 0 }, { input: near, left: 0, top: 372 }]).png().toBuffer();
      tiles.push({
        img: stacked,
        cap: [
          level ? `сглаживание ${level}` : 'как сейчас',
          `${b.pattern.threads.length} нитей · одиночных ${s.singles.toFixed(2)} %`,
          `в мелких пятнах ${s.small.toFixed(2)} %`,
          `сборка ${(ms / 1000).toFixed(1)} с${b.guard ? ` · охрана ${b.guard.toFixed(3)}` : level ? ' · без охраны' : ''}`,
          ...c.errors.slice(0, 2).map((e) => `⚠ ${e.slice(0, 48)}`),
        ],
      });
    }
    const metas = await Promise.all(tiles.map((t) => sharp(t.img).metadata()));
    const caps = tiles.map((t, i) => smoothLabel(t.cap, Math.max(300, metas[i].width ?? 0)));
    const capMetas = await Promise.all(caps.map((c) => sharp(c).metadata()));
    const colW = metas.map((m, i) => Math.max(m.width ?? 0, capMetas[i].width ?? 0));
    const imgH = Math.max(...metas.map((m) => m.height ?? 0));
    const width = colW.reduce((sum, w) => sum + w + 16, 16);
    const height = 16 + imgH + 8 + Math.max(...capMetas.map((m) => m.height ?? 0)) + 16;
    let x = 16;
    const parts: OverlayOptions[] = [];
    tiles.forEach((t, i) => {
      parts.push({ input: t.img, left: x, top: 16 }, { input: caps[i], left: x, top: 16 + imgH + 8 });
      x += colW[i] + 16;
    });
    rows.push(await sharp({ create: { width, height, channels: 3, background: '#ecede6' } }).composite(parts).png().toBuffer());
  }
  mkdirSync(OUT, { recursive: true });
  for (let i = 0; i < rows.length; i += 4) await stack(rows.slice(i, i + 4), join(OUT, `smooth-${name}-${i / 4 + 1}.png`));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--smooth')) {
    await smoothSheet(args[args.indexOf('--smooth') + 1].split(','), args.includes('--name') ? args[args.indexOf('--name') + 1] : 'selected');
  } else if (args.includes('--variants')) {
    await variants(args[args.indexOf('--variants') + 1], 'threads');
  } else if (args.includes('--deltas')) {
    await variants(args[args.indexOf('--deltas') + 1], 'deltas');
  } else {
    const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
    // --ids: лист из выбранных картинок в заданном порядке, файлы — по --name
    const ids = args.includes('--ids') ? args[args.indexOf('--ids') + 1].split(',') : null;
    const name = args.includes('--name') ? args[args.indexOf('--name') + 1] : 'selected';
    const r = await buildAll({ only });
    mkdirSync(OUT, { recursive: true });
    const byCol = new Map<string, Built[]>();
    if (ids) {
      const missing = ids.filter((id) => !r.built.some((b) => b.card.id === id));
      if (missing.length) throw new Error(`нет в наборе: ${missing.join(', ')}`);
      byCol.set(name, ids.map((id) => r.built.find((b) => b.card.id === id)!));
    } else for (const b of r.built) byCol.set(b.card.collection, [...(byCol.get(b.card.collection) ?? []), b]);
    for (const [col, list] of byCol) {
      for (let i = 0; i < list.length; i += 6) {
        const rows = [];
        for (const b of list.slice(i, i + 6)) rows.push(await row(b));
        await stack(rows, join(OUT, `${col}-${i / 6 + 1}.png`));
      }
    }
  }
}
