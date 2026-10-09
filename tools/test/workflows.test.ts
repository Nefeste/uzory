// Артефакты Actions (docs/05-process.md, «Место под артефакты»): место под них общее на все
// закрытые репозитории аккаунта и считается за месяц; в октябре 2026 оно кончилось, и сборки
// встали. «Узоры» пока открыты, и на них это место не считается: правила — на тот день, когда
// репозиторий закроется (ADR студии 0017). Файлы между заданиями — кэшем Actions, артефакт
// никогда не валит задание.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
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
