// Библиотека глазами экранов (docs/specs/2026-09-library.md): картинки встроенного набора и то,
// что про каждую знает этот телефон, — доступ, «Новое», последняя работа. Правило доступа —
// одна функция движка (src/engine/access.ts); подписки ещё нет (0.x), поэтому ничего не
// запирается, но метка «Узоры+» стоит там, где запрёт этап подписки.
import { useEffect, useMemo, useState } from 'react';
import { type Access, access } from '../engine/access';
import { daysBetween, maxDate } from '../engine/dates';
import { COLLECTIONS, type CollectionId } from '../engine/library';
import type { PackPicture } from '../engine/pack';
import { dailyCalendar, useLibrary } from './library';
import { usePlayer } from './player';
import { loadIndex, type WorkEntry } from './works';

/** Сколько дней у картинки метка «Новое». */
export const NEW_DAYS = 7;

export const keyOf = (p: PackPicture) => `${p.id}@${p.v}`;
export const percentOf = (w: WorkEntry) => Math.floor((w.done * 100) / Math.max(1, w.total));

export interface Catalog {
  /** картинки библиотеки, без скрытых */
  pictures: PackPicture[];
  /** коллекции по порядку 09-content.md, §1, — только непустые */
  collections: { id: CollectionId; pictures: PackPicture[] }[];
  works: WorkEntry[];
  /** начатая работа картинки (последняя открытая), а если нет — последняя готовая */
  workOf: (p: PackPicture) => WorkEntry | undefined;
  /** вышита ли картинка хоть раз */
  done: (p: PackPicture) => boolean;
  access: (p: PackPicture) => Access;
  /** метка «Узоры+»: без подписки эта картинка будет заперта */
  plusOnly: (p: PackPicture) => boolean;
  isNew: (p: PackPicture) => boolean;
  /** перечитать работы — после возврата с канвы или удаления */
  reload: () => void;
}

export function useCatalog(): Catalog | null {
  const { player, today, loaded } = usePlayer();
  const [works, setWorks] = useState<WorkEntry[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadIndex().then((w) => {
      if (alive) setWorks(w);
    });
    return () => {
      alive = false;
    };
  }, [tick]);
  const all = useLibrary();
  const calendar = useMemo(() => dailyCalendar(player.pinned, all), [player.pinned, all]);

  return useMemo(() => {
    if (!loaded || !works) return null;
    const list = all.filter((p) => !p.hidden);
    const byKey = new Map<string, WorkEntry[]>();
    // указатель работ — от свежих к старым
    for (const w of works) {
      const l = byKey.get(w.pattern);
      if (l) l.push(w);
      else byKey.set(w.pattern, [w]);
    }
    const ids = new Set(works.map((w) => w.pattern.slice(0, w.pattern.lastIndexOf('@'))));
    const seen = maxDate(today, player.seen);
    const ctx = {
      today, seen, installed: player.installed, plus: false,
      dailyFrom: (id: string) => calendar.dailyFrom(id, player.installed, seen),
      hasWork: (id: string) => ids.has(id),
    };
    const workOf = (p: PackPicture) => {
      const l = byKey.get(keyOf(p));
      return l?.find((w) => !w.finished) ?? l?.[0];
    };
    const accessOf = (p: PackPicture) => access(p, ctx);
    return {
      pictures: list,
      collections: COLLECTIONS.map((id) => ({ id, pictures: list.filter((p) => p.collection === id).sort((a, b) => a.order - b.order) }))
        .filter((c) => c.pictures.length > 0),
      works,
      workOf,
      done: (p) => !!byKey.get(keyOf(p))?.some((w) => w.finished),
      access: accessOf,
      plusOnly: (p) => accessOf(p) === 'locked',
      // «Новое» — пришедшее после первого запуска: встроенный набор новым не бывает
      isNew: (p) => p.added > player.installed && daysBetween(p.added, today) < NEW_DAYS,
      reload: () => setTick((n) => n + 1),
    };
  }, [loaded, works, today, player.seen, player.installed, calendar, all]);
}
