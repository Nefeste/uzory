// Устав, «Код»: никогда Alert из React Native — своё окно src/ui/dialog.tsx (системный Alert в веб-сборке не работает).
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });

test('ни один файл приложения не берёт Alert из react-native', () => {
  for (const f of [join(ROOT, 'App.tsx'), ...files(join(ROOT, 'src'))]) {
    const s = readFileSync(f, 'utf8');
    const rn = [...s.matchAll(/import\s*\{([^}]*)\}\s*from\s*'react-native'/g)].map((m) => m[1]);
    expect([f, rn.some((names) => /\bAlert\b/.test(names))]).toEqual([f, false]);
    expect([f, /\bAlert\.alert\(/.test(s)]).toEqual([f, false]);
  }
});
