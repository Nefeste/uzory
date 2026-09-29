// Новые картинки по сети (docs/specs/2026-09-packs.md; docs/03-server-api.md): раз в сутки,
// пока игра открыта, — каталог и его подпись. Подпись не сошлась или каталог не разобрался —
// он не трогается. Новые наборы качаются по одному: размер и SHA-256 — из подписанного
// каталога, затем полная проверка узоров; только тогда набор ложится в packs/, а в библиотеку —
// с даты `from`. Без сети ничего не показывается: повтор — при следующем запуске, не чаще
// раза в час.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { type Catalog, packsToFetch, readCatalog, versionLess } from '../engine/catalog';
import { isDate } from '../engine/dates';
import { openPack, type Pack, packError } from '../engine/pack';
import { sha256Hex, verifyCatalog } from '../engine/sign';
import { utf8Decode } from '../engine/utf8';
import { APP_VERSION } from '../version';
import { counterQuery } from './counters';
import { logError } from './crashlog';
import { trustedKeys } from './keys';
import { addPacks, packIds } from './library';
import { NET_BASE } from './net-env';
import { freeSpace, readPackFile, writePackFile } from './packfiles';
import { todayLocal, usePlayer } from './player';
import { KEYS, loadJson, saveJson } from './storage';

const HOUR = 3_600_000;
/** Ответ — не дольше 30 секунд и ещё секунды на каждые 50 КБ набора: медленная мобильная сеть. */
const TIMEOUT_MS = 30_000;
const timeoutFor = (bytes: number) => TIMEOUT_MS + Math.ceil(bytes / 50_000) * 1000;
/** Сколько места оставить свободным сверх двух размеров набора. */
const SPARE = 20 * 1024 * 1024;

/** Скачанный набор на телефоне. */
export interface LocalPack {
  id: string;
  sha256: string;
  /** с какой даты показывать в библиотеке */
  from?: string;
  /** когда скачан, «2026-10-12» */
  got: string;
}

/** Что телефон помнит о раздаче (хранилище `uzory.net.v1`). */
export interface NetState {
  /** день, когда каталог уже разобран: до завтра не спрашиваем */
  okDay?: string;
  /** последняя попытка, мс: после неудачи — не чаще раза в час */
  triedAt?: number;
  packs: LocalPack[];
  /** неудачи подряд по набору: после трёх — запись в журнал сбоев */
  failures: Record<string, number>;
  /** строка на главной: «обновите игру» или «не хватает места» */
  line: 'update' | 'space' | null;
  /** строка каталога для главной */
  notice: string | null;
}

const PACK_ID = /^[a-z0-9][a-z0-9.-]{0,40}$/;

function normalize(raw: unknown): NetState {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<NetState>;
  const packs = Array.isArray(r.packs)
    ? r.packs.filter((p) => typeof p?.id === 'string' && PACK_ID.test(p.id) && typeof p.sha256 === 'string' && isDate(p.got)
      && (p.from === undefined || isDate(p.from)))
    : [];
  return {
    okDay: typeof r.okDay === 'string' && isDate(r.okDay) ? r.okDay : undefined,
    triedAt: Number.isFinite(r.triedAt) ? r.triedAt : undefined,
    packs,
    failures: typeof r.failures === 'object' && r.failures !== null ? r.failures : {},
    line: r.line === 'update' || r.line === 'space' ? r.line : null,
    notice: typeof r.notice === 'string' ? r.notice : null,
  };
}

let state: NetState = normalize(null);
const listeners = new Set<() => void>();

async function save(next: NetState): Promise<void> {
  state = next;
  for (const f of listeners) f();
  await saveJson(KEYS.net, next);
}

async function get(path: string, bytes = 0): Promise<Uint8Array> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutFor(bytes));
  try {
    // без `cache`: полифилл fetch в React Native дописал бы к адресу «?_=время», а кэш каталога
    // и так решает сервер (Cache-Control: no-cache с ETag, наборы — immutable)
    const r = await fetch(NET_BASE + path, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Скачанные наборы, чья дата пришла, — в библиотеку. Файл проверен при скачивании, здесь —
 * только разбор: хеш всех наборов на каждом запуске стоил бы секунд на слабом телефоне.
 * Пропавший или испорченный файл — прочь из списка: завтра скачается заново.
 */
async function activate(today: string): Promise<void> {
  const inLibrary = new Set(packIds());
  const add: Pack[] = [];
  const broken = new Set<string>();
  for (const p of state.packs) {
    if (inLibrary.has(p.id) || (p.from && p.from > today)) continue;
    try {
      const bytes = await readPackFile(`${p.id}.pack`);
      if (!bytes) throw new Error(`pack ${p.id}: file missing`);
      add.push(openPack(bytes));
    } catch (e) {
      logError('pack', e, `pack ${p.id}`);
      broken.add(p.id);
    }
  }
  if (broken.size) await save({ ...state, packs: state.packs.filter((p) => !broken.has(p.id)), okDay: undefined });
  addPacks(add);
}

let started: Promise<void> | null = null;

/** Первый запуск экрана: состояние из хранилища и скачанные наборы — в библиотеку. */
function init(today: string): Promise<void> {
  started ??= (async () => {
    state = normalize(await loadJson<unknown>(KEYS.net));
    await activate(today);
  })().catch((e) => logError('pack', e, 'net init'));
  return started;
}

let running: Promise<void> | null = null;

/**
 * Спросить каталог, если сегодня ещё не спрашивали; одновременно — один раз. `installed` —
 * день первого запуска: из него счётчики берут неделю установки и сколько дней прошло.
 */
export function syncNet(today: string, installed: string, now = Date.now()): Promise<void> {
  running ??= init(today)
    .then(() => sync(today, installed, now))
    .catch((e) => logError('pack', e, 'net'))
    .finally(() => {
      running = null;
    });
  return running;
}

async function sync(today: string, installed: string, now: number): Promise<void> {
  await activate(today);
  // ключей подписи ещё нет — проверить каталог нечем, и спрашивать его незачем
  if (!trustedKeys().length) return;
  if (state.okDay === today) return;
  if (state.triedAt !== undefined && now >= state.triedAt && now - state.triedAt < HOUR) return;
  await save({ ...state, triedAt: now });
  // счётчики — только в первой попытке дня (docs/03-server-api.md, «Счётчики»); подписки ещё нет
  const q = await counterQuery(today, installed, false);
  let text: Uint8Array;
  let sig: string;
  try {
    text = await get(q ? `catalog.json?${q}` : 'catalog.json');
    sig = utf8Decode(await get('catalog.sig'));
  } catch {
    return; // нет сети, таймаут, не 200 — тихо: повтор не раньше чем через час
  }
  const done = (patch: Partial<NetState>) => save({ ...state, ...patch, okDay: today });
  if (!verifyCatalog(text, sig, trustedKeys())) {
    logError('pack', new Error('catalog signature mismatch'), 'catalog');
    return done({});
  }
  let cat: Catalog;
  try {
    cat = readCatalog(utf8Decode(text));
  } catch (e) {
    logError('pack', e, 'catalog');
    return done({});
  }
  if (versionLess(APP_VERSION, cat.minApp)) return done({ line: 'update', notice: cat.notice });
  let line: NetState['line'] = null;
  const have = new Set([...packIds(), ...state.packs.map((p) => p.id)]);
  for (const p of packsToFetch(cat, have)) {
    const free = freeSpace();
    if (free !== null && free < p.bytes * 2 + SPARE) {
      line = 'space';
      break;
    }
    let bytes: Uint8Array;
    try {
      bytes = await get(p.file, p.bytes);
    } catch {
      // сеть пропала посреди — остальное через час
      await save({ ...state, line, notice: cat.notice });
      return;
    }
    try {
      if (bytes.length !== p.bytes || sha256Hex(bytes) !== p.sha256) throw new Error(`pack ${p.id}: size or SHA-256 differs from catalog`);
      const pack = openPack(bytes);
      if (pack.json.id !== p.id) throw new Error(`pack ${p.id}: contains ${pack.json.id}`);
      const err = packError(pack);
      if (err) throw new Error(`pack ${p.id}: ${err}`);
      await writePackFile(`${p.id}.pack`, bytes);
      const failures = { ...state.failures };
      delete failures[p.id];
      const entry: LocalPack = { id: p.id, sha256: p.sha256, got: today };
      if (p.from) entry.from = p.from;
      await save({ ...state, packs: [...state.packs, entry], failures });
    } catch (e) {
      // не сошёлся или не разобрался: файл не записан, библиотека не тронута; повтор — завтра
      const n = (state.failures[p.id] ?? 0) + 1;
      if (n >= 3) logError('pack', e, `pack ${p.id}`);
      await save({ ...state, failures: { ...state.failures, [p.id]: n } });
    }
  }
  await done({ line, notice: cat.notice });
  await activate(today);
}

/** Раздача глазами экранов: строка на главной, дата последнего набора. */
export function useNet(): NetState {
  return useSyncExternalStore((f) => {
    listeners.add(f);
    return () => listeners.delete(f);
  }, () => state);
}

/**
 * Скачанные наборы — в библиотеке: до этого заставка (работа скачанной картинки иначе
 * показалась бы исчезнувшей). Потом — каталог сейчас и при каждом возвращении в игру.
 */
export function useNetReady(): boolean {
  const { player, loaded, today } = usePlayer();
  const installed = player.installed;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    void init(today).finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [loaded, today]);
  useEffect(() => {
    if (!ready) return;
    void syncNet(today, installed);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncNet(todayLocal(), installed);
    });
    return () => sub.remove();
  }, [ready, today, installed]);
  return ready;
}
