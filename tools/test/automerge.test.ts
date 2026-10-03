// Автослияние (устав студии, ADR 0018; .github/workflows/automerge.yml): какой PR сливается сам.
// Решение — чистые функции .github/scripts/automerge.ts; пути владельца — настоящий CODEOWNERS.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LABEL, decide, matches, ownerFiles, ownerPatterns, type PrState } from '../../.github/scripts/automerge';

const root = join(import.meta.dir, '..', '..');
const codeowners = readFileSync(join(root, '.github', 'CODEOWNERS'), 'utf8');

/** PR, который сливается сам; в проверках меняется одно условие. */
const ready: PrState = { open: true, draft: false, labels: [LABEL, 'узоры'], files: ['src/ui/Home.tsx', 'docs/07-roadmap.md'], green: true };

describe('автослияние', () => {
  test('CODEOWNERS: пути владельца из устава и проекта — все за владельцем', () => {
    const patterns = ownerPatterns(codeowners);
    // из устава (ADR 0018) — убирать нельзя; политика конфиденциальности «Узоров» лежит
    // в store/site/; план набора недели, app.json и eas.json — пути проекта
    const project = ['/content/week.yaml', '/app.json', '/eas.json'];
    for (const p of ['/deploy/', '/.github/', '/server/', '/src/money/', '/store/forms.md', '/store/privacy*', '/store/site/privacy*', ...project]) {
      expect(patterns).toContain(p);
    }
    const owners = codeowners
      .split('\n')
      .map((line) => line.replace(/#.*/, '').trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/).slice(1));
    expect(owners.length).toBe(patterns.length);
    for (const o of owners) expect(o).toEqual(['@Nefeste']);
  });

  test('шаблоны путей — как в CODEOWNERS у GitHub', () => {
    const cases: [string, string, boolean][] = [
      ['/deploy/', 'deploy/uzory/nginx.conf', true],
      ['/deploy/', 'deploy', false],
      ['/deploy/', 'docs/deploy.md', false],
      ['/deploy/', 'tools/deploy/run.ts', false],
      ['/.github/', '.github/workflows/pr.yml', true],
      ['/.github/', '.github/CODEOWNERS', true],
      ['/src/money/', 'src/money/pay.ts', true],
      ['/src/money/', 'src/moneybox.ts', false],
      ['/store/privacy*', 'store/privacy.md', true],
      ['/store/privacy*', 'store/privacy-policy.en.md', true],
      ['/store/privacy*', 'store/listing.ru.md', false],
      ['/store/site/privacy*', 'store/site/privacy-uzory.ru.html', true],
      ['/store/site/privacy*', 'store/site/page.ru.md', false],
      ['/store/forms.md', 'store/forms.md', true],
      ['/store/forms.md', 'store/forms.md.orig', false],
      ['/app.json', 'app.json', true],
      ['/app.json', 'app.json.bak', false],
      ['/app.json', 'docs/app.json', false],
      // без «/» в начале и в середине — на любой глубине
      ['apps/', 'apps/a.ts', true],
      ['apps/', 'src/apps/a.ts', true],
      ['*.keystore', 'android/app/release.keystore', true],
      ['*.keystore', 'android/app/release.keystore.md', false],
      // «/» в середине привязывает к корню; «**» — любые папки
      ['docs/adr/', 'docs/adr/0001.md', true],
      ['docs/adr/', 'research/docs/adr/0001.md', false],
      ['/**/secrets.json', 'a/b/secrets.json', true],
      ['/**/secrets.json', 'secrets.json', true],
      ['/store/privacy?.md', 'store/privacy1.md', true],
      ['/store/privacy?.md', 'store/privacy/1.md', false],
    ];
    for (const [pattern, path, want] of cases) expect([pattern, path, matches(pattern, path)]).toEqual([pattern, path, want]);
  });

  test('пути владельца в PR — и прежние имена переименованных файлов', () => {
    expect(ownerFiles(codeowners, ['src/ui/Home.tsx', 'docs/05-process.md', 'README.md', 'store/site/page.ru.md'])).toEqual([]);
    expect(ownerFiles(codeowners, ['store/site/privacy-uzory.ru.html'])).toEqual(['store/site/privacy-uzory.ru.html']);
    expect(ownerFiles(codeowners, ['src/ui/Home.tsx', '.github/workflows/pr.yml', 'app.json', 'server/net.ts'])).toEqual([
      '.github/workflows/pr.yml',
      'app.json',
      'server/net.ts',
    ]);
    // файл вынесли из server/ — PR всё равно трогает путь владельца
    expect(ownerFiles(codeowners, ['tools/net.ts', 'server/net.ts'])).toEqual(['server/net.ts']);
  });

  test('метка, зелёные проверки, ни одного пути владельца — auto-merge включается', () => {
    expect(decide(false, ready, codeowners).act).toBe('enable');
    expect(decide(false, { ...ready, files: ['docs/05-process.md'] }, codeowners).act).toBe('enable');
  });

  test('не хватает одного условия — ничего не делается, причина названа', () => {
    const none = (pr: Partial<PrState>) => decide(false, { ...ready, ...pr }, codeowners);
    expect(none({ labels: ['узоры'] })).toEqual({ act: 'none', why: `нет метки «${LABEL}»` });
    expect(none({ labels: [] }).act).toBe('none');
    expect(none({ draft: true }).act).toBe('none');
    expect(none({ green: false }).act).toBe('none');
    expect(none({ open: false }).act).toBe('none');
    const own = none({ files: ['src/ui/Home.tsx', 'eas.json', 'store/privacy.md'] });
    expect(own.act).toBe('none');
    expect(own.why).toContain('eas.json, store/privacy.md');
  });

  test('новый коммит после ревью снимает метку и auto-merge; без метки — ничего', () => {
    expect(decide(true, ready, codeowners).act).toBe('drop');
    // проверки нового коммита ещё идут, но Ревьюер смотрел прежний
    expect(decide(true, { ...ready, green: false }, codeowners).act).toBe('drop');
    expect(decide(true, { ...ready, labels: ['узоры'] }, codeowners).act).toBe('none');
    expect(decide(true, { ...ready, open: false }, codeowners).act).toBe('none');
  });
});
