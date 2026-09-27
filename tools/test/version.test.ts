// из votchina: tools/test/version.test.ts @ 1242776
// Номер версии живёт в нескольких местах (docs/05-process.md, «Версии»): тест сверяет их.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_BUILD, APP_VERSION } from '../../src/version';

const root = join(import.meta.dir, '..', '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));

describe('версия', () => {
  test('app.json, package.json, package-lock.json и src/version.ts называют одну версию', () => {
    const app = read('app.json').expo;
    expect(app.version).toBe(APP_VERSION);
    expect(read('package.json').version).toBe(APP_VERSION);
    expect(read('package-lock.json').version).toBe(APP_VERSION);
    expect(app.android.versionCode).toBe(APP_BUILD);
  });

  test('у версии есть раздел в README — из него CI берёт заметки релиза', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(readme).toContain(`### ${APP_VERSION}`);
  });

  test('идентификатор приложения — постоянный (ADR 0014)', () => {
    const app = read('app.json').expo;
    expect(app.android.package).toBe('games.gornitsa.uzory');
    expect(app.android.allowBackup).toBe(true);
  });
});
