// Автослияние (устав студии, ADR 0018; .github/workflows/automerge.yml): какой PR сливается сам.
// Логика — в общем наборе студии gornitsa-kit (ADR студии 0022) и проверяется там; здесь —
// настоящий CODEOWNERS и вызов набора: правила, имя проверки и метка, события из main.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = join(import.meta.dir, '..', '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const codeowners = read('.github/CODEOWNERS');
/** Строки CODEOWNERS без комментариев: шаблон и владельцы. */
const rows = codeowners
  .split('\n')
  .map((line) => line.replace(/#.*/, '').trim())
  .filter(Boolean)
  .map((line) => line.split(/\s+/));

describe('автослияние', () => {
  test('CODEOWNERS: пути владельца из устава и проекта — все за владельцем', () => {
    const patterns = rows.map(([p]) => p);
    // из устава (ADR 0018) — убирать нельзя; политика конфиденциальности «Узоров» лежит
    // в store/site/; план набора недели, app.json и eas.json — пути проекта
    const project = ['/content/week.yaml', '/app.json', '/eas.json'];
    for (const p of ['/deploy/', '/.github/', '/server/', '/src/money/', '/store/forms.md', '/store/privacy*', '/store/site/privacy*', ...project]) {
      expect(patterns).toContain(p);
    }
    for (const [, ...owners] of rows) expect(owners).toEqual(['@Nefeste']);
  });

  test('CODEOWNERS разбирается набором: без «?», «[]», «!» и «\\» — иначе автослияние откажет', () => {
    // правило разбора — actions/automerge/owned.mjs набора: шаблон, который он не понимает, —
    // ошибка, и ни один PR не сольётся сам
    for (const [p] of rows) expect({ p, bad: /[?[\]!\\]/.test(p) }).toEqual({ p, bad: false });
  });

  test('вызов набора: имя проверки и метка — те, что в pr.yml; события берут файл из main', () => {
    const am = parse(read('.github/workflows/automerge.yml'));
    const pr = parse(read('.github/workflows/pr.yml'));
    expect(Object.keys(am.on).sort()).toEqual(['pull_request_target', 'workflow_run']);
    expect(am.on.workflow_run.workflows).toEqual([pr.name]);
    expect(Object.keys(am.jobs)).toEqual(['automerge']);
    expect(am.jobs.automerge.uses).toBe('Nefeste/gornitsa-kit/.github/workflows/automerge.yml@v1');
    expect(am.jobs.automerge.with.check).toBe(pr.jobs.checks.name);
    expect(am.jobs.automerge.with.label).toBe('ревью: ок');
    // новый коммит снимает метку, снятая метка выключает auto-merge
    expect(am.on.pull_request_target.types).toEqual(expect.arrayContaining(['labeled', 'unlabeled', 'synchronize']));
  });
});
