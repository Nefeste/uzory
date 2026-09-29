// Библиотека: встроенный набор и скачанные (docs/04-data-model.md, «Наборы и библиотека»;
// docs/specs/2026-09-packs.md). Встроенный лежит строкой base64 в модуле JS, который собирает
// tools/content/build.ts: так набор одинаково читается на телефоне, в вебе и в тестах.
// Скачанные добавляет src/state/net.ts, когда пришла их дата.
//
// Картинка, попавшая в библиотеку, остаётся навсегда (ADR 0010): у новой версии узора старая
// остаётся доступной начатым по ней работам — библиотека показывает последнюю версию, а
// работа открывает свою. Та же картинка той же версии во втором наборе не дублируется.
import { useSyncExternalStore } from 'react';
import { base64Decode } from '../engine/base64';
import { Daily } from '../engine/calendar';
import { patternKey } from '../engine/library';
import { libraryIndex, mergedCalendar, openPack, type Pack, packPattern, type PackPicture, samePattern } from '../engine/pack';
import type { Pattern } from '../engine/pattern';
import { BASE_PACK } from '../content/generated/pack';
import { logError } from './crashlog';

let base: Pack | null = null;
let parseMs = 0;
/** скачанные наборы, по порядку выхода */
const extra: Pack[] = [];
const patterns = new Map<string, Pattern>();
/** ключ узора → картинка и её набор; первый набор с этим ключом */
let byKey: Map<string, { pic: PackPicture; pack: Pack }> | null = null;
/** последняя версия каждой картинки */
let latest: PackPicture[] = [];
const listeners = new Set<() => void>();

export function basePack(): Pack {
  if (!base) {
    const t0 = Date.now();
    base = openPack(base64Decode(BASE_PACK));
    parseMs = Date.now() - t0;
  }
  return base;
}

/** Сколько занял разбор при запуске, мс — для экрана «Файл работы». */
export const packParseMs = () => parseMs;

function packs(): Pack[] {
  try {
    return [basePack(), ...extra];
  } catch (e) {
    logError('pack', e, 'base pack');
    return [...extra];
  }
}

function index(): Map<string, { pic: PackPicture; pack: Pack }> {
  if (byKey) return byKey;
  const lib = libraryIndex(packs());
  byKey = lib.byKey;
  latest = lib.latest;
  return byKey;
}

/** Все картинки библиотеки — каждая в последней версии, со скрытыми. */
export function pictures(): PackPicture[] {
  index();
  return latest;
}

export function pictureById(id: string): PackPicture | undefined {
  return pictures().find((p) => p.id === id);
}

/** Узор картинки: разбирается при первом открытии и держится в памяти. */
export function patternOf(pic: PackPicture): Pattern {
  const key = patternKey(pic);
  let p = patterns.get(key);
  if (!p) {
    const at = index().get(key);
    p = packPattern(at?.pack ?? basePack(), at?.pic ?? pic);
    patterns.set(key, p);
  }
  return p;
}

/** Картинка и узор по ключу работы — в том числе прежней версии узора. */
export function patternByKey(key: string): { pic: PackPicture; pattern: Pattern } | null {
  const at = index().get(key);
  return at ? { pic: at.pic, pattern: patternOf(at.pic) } : null;
}

/**
 * Добавляет скачанные наборы. Картинка, чей ключ уже есть, не дублируется; если её узор в
 * новом наборе другой — это ошибка выкладки: запись в журнал сбоев, остаётся прежний.
 */
export function addPacks(list: readonly Pack[]): void {
  if (!list.length) return;
  const known = index();
  for (const pack of list) {
    for (const pic of pack.json.pictures) {
      const had = known.get(patternKey(pic));
      if (!had) continue;
      try {
        if (!samePattern(packPattern(had.pack, had.pic), packPattern(pack, pic))) {
          logError('pack', new Error(`${patternKey(pic)}: different pattern in pack ${pack.json.id}`), 'pack merge');
        }
      } catch (e) {
        logError('pack', e, `pack merge ${pack.json.id}`);
      }
    }
    extra.push(pack);
  }
  byKey = null;
  for (const f of listeners) f();
}

/** id наборов в библиотеке: встроенный и добавленные. */
export const packIds = (): string[] => packs().map((p) => p.json.id);

/** Картинки библиотеки для экранов: новый массив — когда в библиотеке прибавилось. */
export function useLibrary(): PackPicture[] {
  return useSyncExternalStore((f) => {
    listeners.add(f);
    return () => listeners.delete(f);
  }, pictures);
}

/** Первая картинка (docs/specs/2026-09-first-picture.md). */
export const FIRST_PICTURE = 'first-picture';

/**
 * Календарь картинок дня (docs/09-content.md, §9): встроенного набора, продлённый скачанными —
 * у одного дня берётся запись позднего набора; `pinned` — дни, уже показанные по запасному
 * правилу (src/state/player.tsx).
 */
export function dailyCalendar(pinned: Readonly<Record<string, string>>, list: PackPicture[] = pictures()): Daily {
  return new Daily({ calendar: mergedCalendar(packs()), pictures: list, pinned });
}
