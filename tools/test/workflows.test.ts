// Артефакты Actions (docs/05-process.md, «Место под артефакты»): место под них общее на все
// закрытые репозитории аккаунта и считается за месяц; в октябре 2026 оно кончилось, и сборки
// встали. «Узоры» пока открыты, и на них это место не считается: правила — на тот день, когда
// репозиторий закроется (ADR студии 0017). Файлы между заданиями — кэшем Actions, артефакт
// никогда не валит задание. Ниже — ветка vps веб-версии для сайта (docs/specs/2026-09-web.md).
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const dir = join(import.meta.dir, '..', '..', '.github', 'workflows');
const wf = (f: string) => parse(readFileSync(join(dir, f), 'utf8'));
const steps = (job: any, uses: string) => (job.steps ?? []).filter((s: any) => String(s.uses).startsWith(uses));

describe('артефакты Actions', () => {
  test('артефакты не скачивает ни один workflow; выгрузка артефакта задание не валит', () => {
    for (const f of readdirSync(dir)) {
      for (const [name, job] of Object.entries<any>(wf(f).jobs)) {
        expect({ f, name, download: steps(job, 'actions/download-artifact').length }).toEqual({ f, name, download: 0 });
        for (const s of steps(job, 'actions/upload-artifact')) {
          expect({ f, name, continueOnError: s['continue-on-error'] }).toEqual({ f, name, continueOnError: true });
        }
      }
    }
  });

  test('снимки сценария — только когда он упал, только из закрытого репозитория и на неделю', () => {
    const [s] = steps(wf('android.yml').jobs.web, 'actions/upload-artifact');
    expect(s.if).toBe('failure() && github.event.repository.private');
    expect(s.with['retention-days']).toBe(7);
  });

  test('файлы сборки — «Релизу» кэшем: тот же путь и ключ; AAB — только если он в матрице', () => {
    const jobs = wf('android.yml').jobs;
    const [save] = steps(jobs.build, 'actions/cache/save');
    expect(save.if).toBe("needs.key.outputs.ready == 'yes'");
    const restored = steps(jobs.release, 'actions/cache/restore');
    expect(restored.map((r: any) => r.with.key)).toEqual(['apk', 'aab'].map((t) => save.with.key.replace('${{ matrix.target }}', t)));
    for (const r of restored) {
      expect(r.with.path).toBe(save.with.path);
      expect(r.with['fail-on-cache-miss']).toBe(true);
      // перезапуск одного «Релиза» берёт сборку прежней попытки
      expect(r.with['restore-keys']).toBe(r.with.key.replace('${{ github.run_attempt }}', ''));
    }
    expect(restored[0].if).toBeUndefined();
    expect(restored[1].if).toBe(`contains(needs.key.outputs.matrix, '"target":"aab"')`);
    // строки матрицы в задании «Ключ подписи» — JSON без пробелов: по такой строке и ищется AAB
    expect(jobs.key.steps.find((s: any) => s.id === 'k').run).toContain('{"target":"apk"');
  });
});

describe('релиз на тег версии', () => {
  test('«vX.Y.Z», не пре-релиз и последний: на странице репозитория — ссылка Latest, а не число тегов', () => {
    const [s] = steps(wf('android.yml').jobs.release, 'softprops/action-gh-release');
    expect(s.with.name).toBe('v${{ steps.ver.outputs.version }}');
    expect(s.with.prerelease).toBe(false);
    expect(s.with.make_latest).toBe(true);
  });
});

describe('веб-версия для сайта: ветка vps (docs/specs/2026-09-web.md, критерий 4)', () => {
  // шаги site.yml как есть, только вместо GitHub — голый репозиторий в папке, а вместо age —
  // заглушка: проверяются проверки самого workflow, а не шифрование
  const site = wf('site.yml').jobs.site.steps as { name: string; if?: string; run: string }[];
  const at = site.findIndex((s) => s.name === 'Ветка vps');
  const SHA = 'a'.repeat(40);
  const AGE = '#!/bin/bash\nout="${@: -1}"\n{ printf "age-encryption.org/v1\\n--- заглушка\\n"; cat; } > "$out"\n';
  const NO_AGE = '#!/bin/bash\nout="${@: -1}"\ncat > "$out"\n';
  const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8' });

  function site_(age: string) {
    const root = mkdtempSync(join(tmpdir(), 'uzory-vps-'));
    const origin = join(root, 'origin.git');
    git('init', '-q', '--bare', origin);
    const work = join(root, 'work');
    mkdirSync(join(work, 'dist-site'), { recursive: true });
    writeFileSync(join(work, 'dist-site', 'index.html'), '<!doctype html>');
    writeFileSync(join(work, 'dist-site', 'canvaskit.wasm'), randomBytes(4096));
    writeFileSync(join(work, 'app.json'), JSON.stringify({ expo: { version: '0.0.0' } }));
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin', 'age'), age, { mode: 0o755 });
    const env = { ...process.env, KEY: 'age1заглушка', SHA, GH_TOKEN: 'x', GITHUB_STEP_SUMMARY: join(root, 'summary.md'), PATH: `${join(root, 'bin')}:${process.env.PATH}` };
    const local = (s: string) => s.replaceAll('https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git', `file://${origin}`).replaceAll('${{ github.run_number }}', '1');
    const step = (i: number) => spawnSync('bash', ['-c', local(site[i].run)], { cwd: work, env, encoding: 'utf8' }).status;
    return { root, origin, push: () => step(at), back: () => step(at + 1) };
  }

  test('выкладка: в ветке два файла, коммит main и шифровка — и чтение обратно их принимает', () => {
    expect(site[at + 1].name).toBe('Ветка vps — что выложено');
    expect(site[at + 1].if).toBe(site[at].if);
    const s = site_(AGE);
    try {
      expect(s.push()).toBe(0);
      expect(git('--git-dir', s.origin, 'ls-tree', '--name-only', 'vps').stdout.split('\n').filter(Boolean)).toEqual(['build.json', 'test.tar.gz.age']);
      expect(s.back()).toBe(0);
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  });

  test('без шифрования сборка в ветку не уходит', () => {
    const s = site_(NO_AGE);
    try {
      expect(s.push()).not.toBe(0);
      expect(git('--git-dir', s.origin, 'rev-parse', '--verify', '-q', 'vps').status).not.toBe(0);
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  });

  test('если в ветке не та сборка, чтение обратно падает', () => {
    const s = site_(AGE);
    try {
      expect(s.push()).toBe(0);
      const other = join(s.root, 'other');
      git('clone', '-q', '--branch', 'vps', `file://${s.origin}`, other);
      const file = join(other, 'build.json');
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), commit: 'b'.repeat(40) }));
      git('-C', other, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'чужой коммит');
      git('-C', other, 'push', '-q', 'origin', 'vps');
      expect(s.back()).not.toBe(0);
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  });
});
