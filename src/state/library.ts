// Библиотека прототипов: встроенный набор (docs/04-data-model.md, «Набор»). В 0.0.x он
// лежит строкой base64 в модуле JS, который собирает tools/content/build.ts: так набор
// одинаково читается на телефоне, в вебе и в тестах. Выбор между этим, файлом в APK
// и базой SQLite — итог П4 (docs/specs/2026-09-spikes.md).
import { base64Decode } from '../engine/base64';
import { Daily } from '../engine/calendar';
import { openPack, type Pack, packPattern, type PackPicture } from '../engine/pack';
import type { Pattern } from '../engine/pattern';
import { BASE_PACK } from '../content/generated/pack';
import { logError } from './crashlog';

let pack: Pack | null = null;
let parseMs = 0;
const patterns = new Map<string, Pattern>();

export function basePack(): Pack {
  if (!pack) {
    const t0 = Date.now();
    pack = openPack(base64Decode(BASE_PACK));
    parseMs = Date.now() - t0;
  }
  return pack;
}

/** Сколько занял разбор при запуске, мс — для экрана «Файл работы». */
export const packParseMs = () => parseMs;

export function pictures(): PackPicture[] {
  try {
    return basePack().json.pictures;
  } catch (e) {
    logError('pack', e, 'base pack');
    return [];
  }
}

export function pictureById(id: string): PackPicture | undefined {
  return pictures().find((p) => p.id === id);
}

/** Узор картинки: разбирается при первом открытии и держится в памяти. */
export function patternOf(pic: PackPicture): Pattern {
  const key = `${pic.id}@${pic.v}`;
  let p = patterns.get(key);
  if (!p) {
    p = packPattern(basePack(), pic);
    patterns.set(key, p);
  }
  return p;
}

export function patternByKey(key: string): { pic: PackPicture; pattern: Pattern } | null {
  const pic = pictures().find((p) => `${p.id}@${p.v}` === key);
  return pic ? { pic, pattern: patternOf(pic) } : null;
}

/** Первая картинка (docs/specs/2026-09-first-picture.md). */
export const FIRST_PICTURE = 'first-picture';

/**
 * Календарь картинок дня встроенного набора (docs/09-content.md, §9); `pinned` — дни, уже
 * показанные по запасному правилу (src/state/player.tsx).
 */
export function dailyCalendar(pinned: Readonly<Record<string, string>>): Daily {
  let calendar: Pack['json']['calendar'] = [];
  try {
    calendar = basePack().json.calendar ?? [];
  } catch (e) {
    logError('pack', e, 'calendar');
  }
  return new Daily({ calendar, pictures: pictures(), pinned });
}
