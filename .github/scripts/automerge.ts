// Автослияние (устав студии, ADR 0018; .github/workflows/automerge.yml): включить ли auto-merge
// GitHub у PR. Условия — метка «ревью: ок» от Ревьюера (другой сессии, не автора PR), зелёные
// проверки pr.yml на последнем коммите, ни одного пути владельца из CODEOWNERS, не черновик.
// Новый коммит в PR снимает метку и auto-merge: Ревьюер проверял не его.
//
// Запускается из ветки main — код PR сюда не попадает. Решение — чистые функции ниже, их
// проверяет tools/test/automerge.test.ts; под ними — запросы к GitHub через gh.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

/** Метка Ревьюера (ADR 0018). */
export const LABEL = 'ревью: ок';
/** Проверки на PR — `name:` в .github/workflows/pr.yml. */
export const CI_WORKFLOW = 'PR';

/** Шаблоны путей владельца: первая колонка строк CODEOWNERS без комментариев. */
export function ownerPatterns(codeowners: string): string[] {
  return codeowners
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0]);
}

/** Знак шаблона CODEOWNERS — в регулярное выражение. */
const glob = (part: string) =>
  part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part === '?' ? '[^/]' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Путь подходит под шаблон CODEOWNERS (синтаксис .gitignore): «/папка/» — всё в ней, «/файл» —
 * сам файл, «*» — любые знаки, кроме «/», «**» — любые. Шаблон без «/» в начале и в середине
 * подходит на любой глубине. Где GitHub строже (`docs/*` у него не берёт вложенные папки), здесь
 * шире: лишний путь владельца только отдаёт PR владельцу.
 */
export function matches(pattern: string, path: string): boolean {
  const dir = pattern.endsWith('/');
  const p = dir ? pattern.slice(0, -1) : pattern;
  const anchored = p.includes('/');
  const body = (p.startsWith('/') ? p.slice(1) : p).split(/(\*\*\/|\*\*|\*|\?)/).map(glob).join('');
  return new RegExp(`${anchored ? '^' : '(^|/)'}${body}${dir ? '/' : '(/|$)'}`).test(path);
}

/** Пути владельца среди файлов PR. */
export function ownerFiles(codeowners: string, files: readonly string[]): string[] {
  const patterns = ownerPatterns(codeowners);
  return files.filter((f) => patterns.some((p) => matches(p, f)));
}

export interface PrState {
  open: boolean;
  draft: boolean;
  labels: readonly string[];
  /** файлы PR; у переименованных — и прежнее имя */
  files: readonly string[];
  /** последний запуск pr.yml на последнем коммите PR закончился успехом */
  green: boolean;
}

export interface Decision {
  act: 'enable' | 'drop' | 'none';
  why: string;
}

/**
 * Что сделать. `push` — в PR пришёл новый коммит: метку и auto-merge снять. Иначе — включить
 * auto-merge, если выполнены все условия; не выполнено одно — ничего, с причиной.
 */
export function decide(push: boolean, pr: PrState, codeowners: string): Decision {
  const labeled = pr.labels.includes(LABEL);
  if (!pr.open) return { act: 'none', why: 'PR закрыт' };
  if (push) {
    return labeled
      ? { act: 'drop', why: `новый коммит после ревью: метка «${LABEL}» и auto-merge сняты — нужно новое ревью` }
      : { act: 'none', why: 'новый коммит, метки ревью нет' };
  }
  if (!labeled) return { act: 'none', why: `нет метки «${LABEL}»` };
  if (pr.draft) return { act: 'none', why: 'PR — черновик' };
  const own = ownerFiles(codeowners, pr.files);
  if (own.length) return { act: 'none', why: `пути владельца (${own.join(', ')}) — такой PR сливает владелец` };
  if (!pr.green) return { act: 'none', why: 'проверки на PR ещё не зелёные — auto-merge включится, когда пройдут' };
  return { act: 'enable', why: `метка «${LABEL}», проверки зелёные, путей владельца нет — auto-merge (squash) включён` };
}

interface Run {
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY!;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
  const gh = (...args: string[]) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const report = (text: string) => {
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  };

  // у workflow_run — PR, чей последний коммит проверяли (список бывает и с чужими PR)
  const runPrs: { number: number; head: { sha: string } }[] = event.workflow_run?.pull_requests ?? [];
  const number: number | undefined =
    eventName === 'workflow_run' ? (runPrs.find((p) => p.head.sha === event.workflow_run.head_sha) ?? runPrs[0])?.number : event.pull_request?.number;
  if (!number) return report('PR не найден (проверки шли не по PR этого репозитория)');
  const pr = JSON.parse(gh('api', `repos/${repo}/pulls/${number}`));
  if (eventName === 'workflow_run' && event.workflow_run.head_sha !== pr.head.sha) {
    return report(`PR #${number}: проверки — для прежнего коммита, решает запуск на последнем`);
  }
  const files = gh('api', `repos/${repo}/pulls/${number}/files`, '--paginate', '--jq', '.[] | .filename, (.previous_filename // empty)')
    .split('\n')
    .filter(Boolean);
  const runs = (JSON.parse(gh('api', `repos/${repo}/actions/runs?head_sha=${pr.head.sha}&event=pull_request&per_page=100`)).workflow_runs as Run[])
    .filter((r) => r.name === CI_WORKFLOW)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const state: PrState = {
    open: pr.state === 'open',
    draft: !!pr.draft,
    labels: (pr.labels as { name: string }[]).map((l) => l.name),
    files,
    green: runs[0]?.status === 'completed' && runs[0]?.conclusion === 'success',
  };
  const push = eventName === 'pull_request_target' && event.action === 'synchronize';
  const d = decide(push, state, readFileSync('.github/CODEOWNERS', 'utf8'));
  report(`PR #${number}: ${d.why}`);

  if (d.act === 'drop') {
    gh('api', '-X', 'DELETE', `repos/${repo}/issues/${number}/labels/${encodeURIComponent(LABEL)}`);
    try {
      gh('pr', 'merge', String(number), '--repo', repo, '--disable-auto');
    } catch {
      // auto-merge и не был включён
    }
  }
  if (d.act === 'enable') {
    try {
      gh('pr', 'merge', String(number), '--repo', repo, '--auto', '--squash');
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr ?? e);
      // ждать нечего — правила ветки уже выполнены: сливаем сразу, условия выше проверены
      if (/clean status/i.test(msg)) gh('pr', 'merge', String(number), '--repo', repo, '--squash');
      else {
        console.log(`::error::Не удалось включить auto-merge: ${msg.trim()} Нужны Settings → General → «Allow auto-merge» и защита main (описание PR правил студии).`);
        process.exit(1);
      }
    }
  }
}

if (import.meta.main) await main();
