// Лист превью (docs/specs/2026-09-content-pipeline.md, «Что увидит владелец»): по строке на
// картинку — исходник с рамкой кадра, узор «Крестиком» и «Мозаикой» тем же шейдером, что
// на телефоне, и числа проверок. По листу владелец говорит «да» или «нет».
//
//   bun tools/content/sheet.ts                  все картинки → dist/sheet/*.png
//   bun tools/content/sheet.ts --only russia
//   bun tools/content/sheet.ts --ids a,b,c --name fragments   выбранные → dist/sheet/fragments-N.png
//   bun tools/content/sheet.ts --variants <id>  сетка 70/100/120 × 16/24/32 нити (П3)
//   bun tools/content/sheet.ts --deltas <id>    сетка 70/100/120 × порог различимости 0,05/0,04/0,03
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { estimateMinutes, type Pattern } from '../../src/engine/pattern';
import { renderFrame } from '../canvas/ck';
import { ROOT, readCard, listCards } from './cards';
import { type Built, buildAll } from './build';
import { decode, toGrid } from './image';
import { buildPattern } from './palette';
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

async function sourceTile(b: Built): Promise<Buffer | null> {
  if (!b.card.source.file) return null;
  const file = join(b.card.dir, b.card.source.file);
  const img = sharp(file).rotate();
  const meta = await img.metadata();
  const w0 = meta.width ?? 1;
  const h0 = meta.height ?? 1;
  const h = H;
  const w = Math.round((w0 * h) / h0);
  const [l, t, r, bt] = b.card.pattern?.crop ?? [0, 0, 1, 1];
  const frame = Buffer.from(`<svg width="${w}" height="${h}"><rect x="${l * w}" y="${t * h}" width="${(r - l) * w}" height="${(bt - t) * h}" fill="none" stroke="#b3162f" stroke-width="3"/></svg>`);
  return img.resize({ height: h }).composite([{ input: frame }]).png().toBuffer();
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
    ? [await sourceTile(b), await far(b.pattern), await close(b.pattern, false), await close(b.pattern, true)]
    : [await sourceTile(b), await render(b.pattern, false), await render(b.pattern, true)]).filter(Boolean) as Buffer[];
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
      const g = toGrid(raster, card.pattern.crop ?? [0, 0, 1, 1], size);
      const opts = mode === 'threads' ? { threads: v } : { threads: 32, minDelta: v };
      const { pattern, log } = buildPattern(g, { id: card.id, v: card.v, ...opts });
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

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--variants')) {
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
