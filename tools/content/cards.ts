// Карточки картинок (docs/09-content.md, §3): YAML в content/<коллекция>/, рядом исходник.
// Здесь — чтение и проверка схемы и прав; сборка узора — в build.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { parse } from 'yaml';
import { COLLECTIONS, type CollectionId } from '../../src/engine/library';
import { isDate } from '../../src/engine/dates';
import { parseHex } from '../../src/engine/pattern';
import { MIN_DELTA } from '../../src/engine/build/palette';
import { SIZES } from './checks';

export const ROOT = join(import.meta.dir, '..', '..');
export const CONTENT = join(ROOT, 'content');

/**
 * Правило срока с запасом (docs/09-content.md, §2): автор умер в DEATH_LIMIT году или
 * раньше, и работа создана до MADE_LIMIT года. Границу сдвигает владелец записью в 09-content.
 */
export const DEATH_LIMIT = 1951;
export const MADE_LIMIT = 1931;

/** Рассказ «О картине» — две-четыре фразы (docs/09-content.md, §7): не длиннее стольких знаков. */
export const ABOUT_MAX = 400;

/** Времена года календаря картинок дня (docs/09-content.md, §9): зима — декабрь–февраль и так далее. */
export const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;
export type Season = (typeof SEASONS)[number];

export interface Card {
  id: string;
  v: number;
  title: string;
  collection: CollectionId;
  order: number;
  author?: { name: string; life?: string };
  made?: string;
  place?: string;
  museum?: 'ru' | 'abroad' | 'none';
  license?: string | null;
  about?: string;
  about_sources?: string[];
  source: { file?: string; url: string; basis: string };
  pattern?: {
    crop?: [number, number, number, number]; size: number; threads: number; canvas?: string; canvas_delta?: number;
    /**
     * Старинная схема (chart.ts): рамка чуть шире сетки в долях кадра — линии сборка находит
     * сама, поле без сетки отрезает; сколько клеток должно выйти; доля клетки с краёв без
     * линий сетки. Фон — бумага: цвет не дальше canvas_delta от бумаги рядом и сетка видна
     * хотя бы на canvas_lines (ChartCells.lines).
     */
    chart?: [number, number, number, number]; cells?: [number, number]; inset?: number; canvas_lines?: number;
    /**
     * бумага схемы: образцы «бумаги рядом» — не дальше canvas_seed от canvas (0,2 — как без поля);
     * островок бумаги посреди рисунка до canvas_holes клеток — краска (chart.ts, paperCells; 15.10.2026)
     */
    canvas_seed?: number; canvas_holes?: number;
    /** схема на белой бумаге, скан пожелтел: цвета — относительно бумаги рядом (chart.ts, whiten) */
    white_paper?: boolean;
    /**
     * печатная схема ровными красками: одиночные клетки и шахматка — замысел, чистка их не
     * трогает, а проверка одиночных и мелких пятен — предупреждение (docs/09-content.md, §6)
     */
    exact?: boolean;
    /** упрощение перед палитрой: 1 — немного, 2 — сильно, 0 — нет, как без поля (src/engine/build/simplify.ts) */
    simplify?: 0 | 1 | 2;
    /**
     * сглаживание с сохранением деталей вместо simplify (src/engine/build/smooth.ts; с 24.10.2026):
     * 1 — упрощение по клеткам и чистка с охраной контрастных деталей, 2 — ещё и сдвиг среднего по
     * цвету на снимке; 0 — нет, как без поля
     */
    smooth?: 0 | 1 | 2;
    /**
     * мягкое небо (src/engine/build/soft.ts; с 24.10.2026): на больших ровных местах граница соседних
     * оттенков идёт волной, а не прямыми полосами; true — да, false — нет, как без поля (для прежней
     * версии в `was`)
     */
    soft?: boolean;
    /**
     * тон выцветшего снимка, сила 0,1…1 (src/engine/build/tone.ts; с 24.10.2026); 0 — как на снимке, как
     * без поля (для прежней версии в `was`)
     */
    tone?: number;
    /**
     * цвет клетки снимка: `mean` — среднее по её площади (по умолчанию), `dominant` — того, чего в клетке
     * больше (src/engine/build/dominant.ts; у своих снимков — с 15.10.2026)
     */
    grid?: 'mean' | 'dominant';
    /** насыщенность до палитры: хрома в OKLab ×chroma, 1 — как есть (dominant.ts, saturate) */
    chroma?: number;
    /**
     * порог различимости нитей вместо порога размера по числу клеток (MIN_DELTA): у листа с бумагой узор
     * малый по клеткам, а сетка — средняя, и порог малой сливает лепестки с листьями. Не ниже порога
     * размера по стороне сетки: до 70 клеток — 0,045 (docs/09-content.md, §6; с 16.10.2026)
     */
    min_delta?: number;
    /**
     * глаза: рамка вокруг каждого, доли снимка, как crop; в рамке сборка находит глаз и вышивает его
     * нитью узора (src/engine/build/eyes.ts; с 15.10.2026). Пусто — глаз нет, как без поля
     */
    eyes?: [number, number, number, number][];
    /**
     * кресты на главах: рамка вокруг каждого, доли снимка, как crop; в рамке сборка вышивает самую
     * большую связную группу заметных клеток одной нитью узора (src/engine/build/eyes.ts; с
     * 16.10.2026). Пусто — как без поля
     */
    lines?: [number, number, number, number][];
    /**
     * важные части — лица: рамка вокруг каждого, доли снимка, как crop; им — своя маленькая палитра, и
     * чистка не стирает в них глаз и рот (src/engine/build/focus.ts; с 16.10.2026). Пусто — как без поля
     */
    focus?: [number, number, number, number][];
  };
  /**
   * Прежние версии узора, уже вышедшие в APK: номер → поля pattern, которыми их узор отличался.
   * Сборка кладёт их в набор скрытыми, чтобы начатые на них работы открывались (ADR 0010);
   * библиотека показывает версию v.
   */
  was?: Record<string, Partial<PatternSpec>>;
  drawn?: {
    legend: Record<string, [string, string]>;
    grid?: string;
    generator?: string;
    params?: Record<string, number | number[]>;
  };
  approved?: string;
  /**
   * повторный отбор (с 24.10.2026, issue 121): «да» — у прежней версии approved_v, а нынешняя `v` ещё на
   * отборе. Сборка выпуска кладёт прежние версии до approved_v скрытыми — начатые на них работы
   * открываются (ADR 0010), — а нынешнюю не кладёт, пока у неё нет своего «да»: тогда поле снимают
   * (tools/content/decisions.ts). Без поля «да» — у нынешней версии
   */
  approved_v?: number;
  added?: string;
  free?: boolean;
  hidden?: boolean;
  /**
   * «в запас» (решение владельца 17.10.2026, issue 86): с «да» — но во встроенный набор выпуска не
   * идёт, его по очереди берут наборы недели после выхода (docs/05-process.md, «Ритм после 1.0»)
   */
  stock?: true;
  /** время года: в календаре сборки картинка встаёт только в свой сезон (docs/09-content.md, §9) */
  season?: Season;
  /** день «ММ-ДД» — праздник: в календаре сборки картинка встаёт ровно в этот день (§9) */
  day?: string;
  /** путь к карточке от корня — для отчёта */
  path: string;
  dir: string;
}

export type PatternSpec = NonNullable<Card['pattern']>;

/** Поля pattern прежней версии узора: остальные — как у нынешней. */
export function patternSpec(card: Card, v: number): PatternSpec {
  return v === card.v ? card.pattern! : { ...card.pattern!, ...card.was![String(v)] };
}

const years = (s: string | undefined) => (s?.match(/\d{4}/g) ?? []).map(Number);

export function listCards(only?: string): string[] {
  const out: string[] = [];
  for (const col of readdirSync(CONTENT)) {
    const dir = join(CONTENT, col);
    if (!statSync(dir).isDirectory() || (only && col !== only)) continue;
    for (const f of readdirSync(dir).sort()) if (f.endsWith('.yaml')) out.push(join(dir, f));
  }
  return out.sort();
}

const PATTERN_FIELDS = new Set(['crop', 'size', 'threads', 'canvas', 'canvas_delta', 'chart', 'cells', 'inset', 'canvas_lines', 'canvas_seed', 'canvas_holes', 'white_paper', 'exact', 'simplify', 'smooth', 'soft', 'tone', 'grid', 'chroma', 'min_delta', 'eyes', 'lines', 'focus']);

/** Ошибки полей pattern (нынешней версии или прежней — `was`). */
function patternErrors(p: PatternSpec): string[] {
  const errors: string[] = [];
  // пределы — самого большого размера, «Огромной» (docs/08-game-design.md, «Размеры узоров»)
  const top = SIZES.XL;
  if (!Number.isInteger(p.size) || p.size < 8 || p.size > top.side) errors.push(`pattern.size ${p.size} вне 8…${top.side}`);
  if (!Number.isInteger(p.threads) || p.threads < 2 || p.threads > top.threads[1]) errors.push(`pattern.threads ${p.threads} вне 2…${top.threads[1]}`);
  if (p.crop && (p.crop.length !== 4 || p.crop[0] >= p.crop[2] || p.crop[1] >= p.crop[3] || p.crop.some((x) => x < 0 || x > 1))) errors.push(`pattern.crop ${JSON.stringify(p.crop)}`);
  if (p.canvas !== undefined && parseHex(p.canvas) === null) errors.push(`pattern.canvas «${p.canvas}» не #rrggbb`);
  if (p.cells !== undefined && (!Array.isArray(p.cells) || p.cells.length !== 2 || p.cells.some((c) => !Number.isInteger(c) || c < 4) || Math.max(...p.cells) !== p.size)) {
    errors.push(`pattern.cells ${JSON.stringify(p.cells)}: два целых не меньше 4, большее — равно size`);
  }
  if (p.inset !== undefined && (typeof p.inset !== 'number' || p.inset < 0 || p.inset > 0.45)) errors.push(`pattern.inset ${String(p.inset)} вне 0…0,45`);
  if ((p.cells !== undefined || p.inset !== undefined) && !p.chart) errors.push('pattern.cells и inset — только у схемы (chart)');
  if (p.chart !== undefined) {
    if (p.chart.length !== 4 || p.chart[0] >= p.chart[2] || p.chart[1] >= p.chart[3] || p.chart.some((x) => x < 0 || x > 1)) errors.push(`pattern.chart ${JSON.stringify(p.chart)}`);
    if (!p.cells) errors.push('pattern.chart без cells: сколько клеток должно выйти');
    if (p.crop) errors.push('pattern.chart и crop вместе: у схемы кадр — рамка сетки');
  }
  if (p.canvas_lines !== undefined && (typeof p.canvas_lines !== 'number' || p.canvas_lines <= 0 || p.canvas_lines > 0.5 || !p.chart || !p.canvas)) {
    errors.push(`pattern.canvas_lines ${String(p.canvas_lines)}: 0…0,5 и только у схемы с canvas`);
  }
  // у выбеленного листа бумага — белое, без образцов рядом (whitePaperCells): этих полей у него нет
  const paperSheet = !!p.chart && !!p.canvas && !p.white_paper;
  if (p.canvas_seed !== undefined && (typeof p.canvas_seed !== 'number' || p.canvas_seed < 0.05 || p.canvas_seed > 0.2 || !paperSheet)) {
    errors.push(`pattern.canvas_seed ${String(p.canvas_seed)}: 0,05…0,2 и только у схемы с canvas, не на белой бумаге`);
  }
  if (p.canvas_holes !== undefined && (!Number.isInteger(p.canvas_holes) || p.canvas_holes < 0 || p.canvas_holes > 50 || !paperSheet)) {
    errors.push(`pattern.canvas_holes ${String(p.canvas_holes)}: целое 0…50 и только у схемы с canvas, не на белой бумаге`);
  }
  if (p.white_paper !== undefined && (p.white_paper !== true || !p.chart || !p.canvas)) errors.push('pattern.white_paper: true и только у схемы с canvas');
  if (p.exact !== undefined && (p.exact !== true || !p.chart)) errors.push('pattern.exact: true и только у схемы (chart)');
  if (p.simplify !== undefined && ((p.simplify !== 0 && p.simplify !== 1 && p.simplify !== 2) || p.chart)) errors.push(`pattern.simplify ${String(p.simplify)}: 0, 1 или 2, и не у схемы — её клетки и так замысел`);
  if (p.smooth !== undefined && ((p.smooth !== 0 && p.smooth !== 1 && p.smooth !== 2) || p.chart || (p.smooth && p.simplify))) {
    errors.push(`pattern.smooth ${String(p.smooth)}: 0, 1 или 2, не у схемы и не вместе с simplify — упрощение в нём уже есть`);
  }
  if (p.soft !== undefined && (typeof p.soft !== 'boolean' || p.chart)) errors.push(`pattern.soft ${String(p.soft)}: true или false, и не у схемы — её ровные места и так замысел`);
  if (p.tone !== undefined && (typeof p.tone !== 'number' || (p.tone !== 0 && (p.tone < 0.1 || p.tone > 1)) || p.chart)) errors.push(`pattern.tone ${String(p.tone)}: 0 или 0,1…1, и не у схемы`);
  if (p.grid !== undefined && ((p.grid !== 'mean' && p.grid !== 'dominant') || p.chart)) errors.push(`pattern.grid «${String(p.grid)}»: mean или dominant, и не у схемы`);
  if (p.chroma !== undefined && (typeof p.chroma !== 'number' || p.chroma < 1 || p.chroma > 1.5 || p.chart)) errors.push(`pattern.chroma ${String(p.chroma)}: 1…1,5, и не у схемы`);
  if (p.min_delta !== undefined) {
    // размер по стороне сетки: ниже его порога различимости нельзя, выше порога малой — незачем
    const bySide = (['S', 'M', 'L', 'XL'] as const).find((c) => p.size <= SIZES[c].side) ?? 'XL';
    const low = MIN_DELTA[bySide];
    if (typeof p.min_delta !== 'number' || p.min_delta < low || p.min_delta > MIN_DELTA.S) {
      errors.push(`pattern.min_delta ${String(p.min_delta)}: ${low}…${MIN_DELTA.S} — не ниже порога размера по стороне сетки ${p.size}`);
    }
  }
  const rect = (q: unknown) => Array.isArray(q) && q.length === 4 && q.every((x) => typeof x === 'number' && x >= 0 && x <= 1) && q[0] < q[2] && q[1] < q[3];
  if (p.eyes !== undefined) {
    if (!Array.isArray(p.eyes) || p.eyes.length > 8 || !p.eyes.every(rect) || p.chart) errors.push(`pattern.eyes ${JSON.stringify(p.eyes)}: до восьми рамок [слева, сверху, справа, снизу] в долях снимка, и не у схемы`);
  }
  if (p.lines !== undefined) {
    if (!Array.isArray(p.lines) || p.lines.length > 16 || !p.lines.every(rect) || p.chart) errors.push(`pattern.lines ${JSON.stringify(p.lines)}: до шестнадцати рамок [слева, сверху, справа, снизу] в долях снимка, и не у схемы`);
  }
  if (p.focus !== undefined) {
    if (!Array.isArray(p.focus) || p.focus.length > 12 || !p.focus.every(rect) || p.chart) errors.push(`pattern.focus ${JSON.stringify(p.focus)}: до двенадцати рамок [слева, сверху, справа, снизу] в долях снимка, и не у схемы`);
  }
  return errors;
}

/** Читает карточку; ошибки схемы и прав — списком (пустой — карточка цела). */
export function readCard(file: string): { card: Card | null; errors: string[] } {
  const errors: string[] = [];
  let raw: Record<string, unknown>;
  try {
    raw = parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    return { card: null, errors: [`YAML: ${(e as Error).message}`] };
  }
  const card = { v: 1, ...raw, path: relative(ROOT, file), dir: dirname(file) } as Card;
  const col = basename(dirname(file));
  if (card.id !== basename(file, '.yaml')) errors.push(`id «${card.id}» не совпадает с именем файла`);
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(String(card.id))) errors.push('id — латиница, цифры и дефис, до 80 знаков');
  if (!Number.isInteger(card.v) || card.v < 1) errors.push(`версия узора v: ${String(card.v)}`);
  if (typeof card.title !== 'string' || !card.title.trim()) errors.push('нет названия');
  if (!COLLECTIONS.includes(card.collection)) errors.push(`коллекция «${String(card.collection)}»`);
  else if (card.collection !== col) errors.push(`коллекция ${card.collection}, а папка ${col}`);
  if (!Number.isInteger(card.order) || card.order < 0) errors.push(`order: ${String(card.order)}`);
  if (!card.source || typeof card.source.basis !== 'string' || !card.source.basis.trim()) errors.push('нет основания (source.basis)');
  if (!card.source || typeof card.source.url !== 'string') errors.push('нет адреса источника (source.url; для своей работы — пустая строка)');
  if (!!card.pattern === !!card.drawn) errors.push('нужно ровно одно: pattern (из исходника) или drawn (нарисован)');
  if (card.pattern) {
    if (!card.source?.file) errors.push('pattern без source.file');
    errors.push(...patternErrors(card.pattern));
  }
  if (card.was !== undefined) {
    if (!card.pattern || typeof card.was !== 'object' || card.was === null) errors.push('was — словарь «версия: поля pattern», и только у pattern');
    else for (const [k, diff] of Object.entries(card.was)) {
      if (!/^[1-9]\d*$/.test(k) || Number(k) >= card.v) errors.push(`was.${k}: прежняя версия — целое от 1 до ${card.v - 1}`);
      else if (typeof diff !== 'object' || diff === null || Object.keys(diff).some((f) => !PATTERN_FIELDS.has(f))) errors.push(`was.${k}: только поля pattern`);
      else errors.push(...patternErrors({ ...card.pattern, ...diff }).map((e) => `was.${k}: ${e}`));
    }
  }
  if (card.drawn) {
    const d = card.drawn;
    if (!d.legend || typeof d.legend !== 'object') errors.push('drawn без легенды');
    else for (const [k, v] of Object.entries(d.legend)) {
      if (k.length !== 1 || k === '.') errors.push(`ключ легенды «${k}» — один знак, не точка`);
      if (!Array.isArray(v) || parseHex(v[0]) === null || typeof v[1] !== 'string') errors.push(`нить «${k}»: [«#rrggbb», название]`);
    }
    if (!d.grid === !d.generator) errors.push('drawn: либо grid, либо generator');
  }
  // рисунки и снимки живописи несут автора и год; правило срока
  const art = card.collection === 'painting' || card.collection === 'tales' || card.collection === 'flowers';
  if (art || card.collection === 'russia') {
    if (!card.author?.name || !card.author.life) errors.push('у живописи и снимков — автор и годы жизни');
    if (!card.made) errors.push('у живописи и снимков — год работы (made)');
    const death = Math.max(...years(card.author?.life));
    const made = Math.min(...years(card.made));
    if (Number.isFinite(death) && death > DEATH_LIMIT) errors.push(`автор умер в ${death}: позже ${DEATH_LIMIT} (правило срока)`);
    if (Number.isFinite(made) && made >= MADE_LIMIT) errors.push(`работа ${made} года: не раньше ${MADE_LIMIT} (правило срока)`);
  }
  if (art) {
    if (!card.place) errors.push('у живописи — где хранится оригинал (place)');
    if (card.museum !== 'ru' && card.museum !== 'abroad' && card.museum !== 'none') errors.push('у живописи — museum: ru | abroad | none');
  }
  // рассказ о картине — своими словами по двум открытым источникам, адреса — рядом (docs/09-content.md, §7)
  if (card.about !== undefined || card.about_sources !== undefined) {
    if (typeof card.about !== 'string' || !card.about.trim()) errors.push('about_sources без рассказа (about)');
    else if (card.about.trim().length > ABOUT_MAX) errors.push(`рассказ длиннее ${ABOUT_MAX} знаков`);
    const urls = Array.isArray(card.about_sources) ? card.about_sources.filter((u) => typeof u === 'string' && /^https?:\/\/\S+$/.test(u)) : [];
    if (new Set(urls).size < 2) errors.push('у рассказа — два открытых источника (about_sources: два разных адреса)');
  }
  if (card.approved !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(card.approved))) errors.push(`approved «${String(card.approved)}» — дата`);
  if (card.approved_v !== undefined && (!card.approved || !Number.isInteger(card.approved_v) || card.approved_v < 1 || card.approved_v >= card.v || !card.was?.[String(card.approved_v)])) {
    errors.push(`approved_v ${String(card.approved_v)}: версия с «да» — прежняя, из was, и только вместе с approved`);
  }
  if (card.stock !== undefined && card.stock !== true) errors.push(`stock: ${String(card.stock)} — только true («в запас»), иначе поля нет`);
  if (card.season !== undefined && !SEASONS.includes(card.season)) errors.push(`season «${String(card.season)}» — одно из: ${SEASONS.join(', ')}`);
  if (card.day !== undefined && !(typeof card.day === 'string' && /^\d{2}-\d{2}$/.test(card.day) && isDate(`2028-${card.day}`))) {
    errors.push(`day «${String(card.day)}» — день года «ММ-ДД», например «12-31»`);
  }
  return { card: errors.length ? null : card, errors };
}

/**
 * Можно ли в выпуск: есть «да» владельца и не музейный предмет из России без лицензии
 * (docs/09-content.md, §2, «Музейные предметы»). Иначе — только в сборки для проверки.
 */
export function releasable(c: Card): string | null {
  return releasableAt(c, c.v);
}

/**
 * То же для версии `v` — нынешней или прежней из `was`: права — как у карточки, «да» — у версий не
 * новее approved_v (повторный отбор: нынешняя версия на отборе, прежние с «да» — в выпуске скрытыми).
 */
export function releasableAt(c: Card, v: number): string | null {
  if (!c.approved) return 'нет «да» владельца (approved)';
  if (c.museum === 'ru' && !c.license) return 'оригинал в российском музее, лицензии нет (решение В12)';
  if (c.approved_v !== undefined && v > c.approved_v) return `версия ${v} — на отборе: «да» у версии ${c.approved_v}`;
  return null;
}
