// Список пьес (assets/music/music.yaml): разбор со строгой проверкой и модуль для приложения —
// src/content/generated/music.ts (его пишет сборка картинок, tools/content/build.ts, рядом с
// набором). В сборку выпуска (--release) идут только пьесы с «да» владельца (В6).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export const MUSIC_DIR = join(import.meta.dir, '..', '..', 'assets', 'music');
/** Вся музыка встроенного набора — не больше 10 МБ (docs/02-architecture.md, «Размер APK»). */
export const MUSIC_MAX_BYTES = 10 * 1024 * 1024;

export interface TrackEntry {
  id: string;
  title: string;
  composer: string;
  performer: string;
  license: string;
  page: string;
  download: string;
  sha256: string;
  approved: boolean;
}

const ID = /^[a-z0-9][a-z0-9-]{2,39}$/;
/** Только то, что можно выпускать без разрешения: общественное достояние, CC0, CC BY (не NC, не ND, не SA). */
const LICENSE = /^(PD|CC0|CC BY [1-4]\.0)$/;
const FROM = [/^https:\/\/archive\.org\/download\//, /^https:\/\/upload\.wikimedia\.org\//];

export function readTracks(file = join(MUSIC_DIR, 'music.yaml')): TrackEntry[] {
  const raw = parse(readFileSync(file, 'utf8')) as { tracks?: unknown };
  if (!raw || !Array.isArray(raw.tracks)) throw new Error('music.yaml: нет списка tracks');
  const ids = new Set<string>();
  return raw.tracks.map((t: Record<string, unknown>, i) => {
    const at = `music.yaml, пьеса ${i + 1}`;
    const str = (k: string) => {
      const v = t[k];
      if (typeof v !== 'string' || !v.trim()) throw new Error(`${at}: нет ${k}`);
      return v.trim();
    };
    const id = str('id');
    if (!ID.test(id) || ids.has(id)) throw new Error(`${at}: id ${id}`);
    ids.add(id);
    const license = str('license');
    if (!LICENSE.test(license)) throw new Error(`${id}: лицензия ${license} — нужна PD, CC0 или CC BY`);
    const page = str('page');
    if (!page.startsWith('https://commons.wikimedia.org/wiki/File:')) throw new Error(`${id}: page — страница файла на Викискладе`);
    const download = str('download');
    if (!FROM.some((r) => r.test(download))) throw new Error(`${id}: download ${download}`);
    const sha256 = str('sha256');
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${id}: sha256`);
    if (typeof t.approved !== 'boolean') throw new Error(`${id}: approved — true или false`);
    return { id, title: str('title'), composer: str('composer'), performer: str('performer'), license, page, download, sha256, approved: t.approved };
  });
}

export const trackFile = (id: string) => join(MUSIC_DIR, `${id}.webm`);

/** Модуль для приложения: подписи пьес и `require` их файлов. Пьесы без файла — ошибка сборки. */
export function musicModule(tracks: TrackEntry[], release: boolean): string {
  const list = tracks.filter((t) => !release || t.approved);
  for (const t of list) if (!existsSync(trackFile(t.id))) throw new Error(`нет assets/music/${t.id}.webm — bun tools/audio/music.ts`);
  const q = (s: string) => JSON.stringify(s);
  const rows = list.map((t) => `  { id: ${q(t.id)}, title: ${q(t.title)}, composer: ${q(t.composer)}, performer: ${q(t.performer)}, license: ${q(t.license)}, page: ${q(t.page)}, source: require('../../../assets/music/${t.id}.webm') },`);
  return [
    '// Собрано tools/content/build.ts из assets/music/music.yaml — не править руками.',
    `// ${list.length} ${release ? 'пьес с «да» владельца' : 'пьес (сборка для проверки: и без «да»)'}`,
    "import type { Track } from '../../engine/music';",
    '',
    `export const TRACKS: Track[] = [${rows.length ? `\n${rows.join('\n')}\n` : ''}];`,
    '',
  ].join('\n');
}
