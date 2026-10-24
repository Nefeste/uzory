// Решения «Листа узоров» → карточки (docs/09-content.md, §8; docs/05-process.md, «Второй поток»).
// Владелец присылает текст «Скопировать решения» (src/state/decisions.ts); ассистент кладёт его в файл и
// запускает:
//
//   bun tools/content/decisions.ts решения.txt            что в тексте: «Да», «Нет», «Позже», комментарии
//   bun tools/content/decisions.ts решения.txt --write    и поставить `approved: <дата решения>` картинкам с «Да»,
//                                                         а картинки с «да», получившие «Нет», скрыть
//
// «Нет» картинке, у которой уже есть «да», — `hidden: true` с комментарием владельца (ADR 0010): узор
// остаётся в наборе для начатых работ, а библиотека и календарь картинку не показывают (так 24.10.2026 —
// 170 картинок). «Нет» картинке без «да», «Позже» и комментарии карточек не меняют: по ним ассистент
// правит картинки и пишет в PR, что сделано. Неизвестный id, картинка в двух группах или текст не из
// листа — ошибка, и ничего не пишется.
// «Да» запасу — сразу (решение владельца 17.10.2026, issue 86): у его карточек пометка `stock`, и с «да»
// они идут не в 1.0, а по очереди в наборы недели после выхода (docs/05-process.md, «Ритм после 1.0»).
import { readFileSync, writeFileSync } from 'node:fs';
import { pluralRu } from '../../src/i18n/plural';
import { ru } from '../../src/i18n/ru';
import type { Pick } from '../../src/state/decisions';
import { listCards, readCard } from './cards';

export interface Decision {
  id: string;
  title: string;
  /** null — без отметки, только комментарий */
  pick: Pick | null;
  note: string;
}

export interface Decisions {
  version: string;
  /** день, когда владелец скопировал решения, — он же дата `approved` */
  date: string;
  items: Decision[];
}

const HEAD = /^Узоры (\S+) — отбор картинок, (\d{4}-\d{2}-\d{2})$/;
const GROUP = /^(.+?) \((\d+)\): (.*)$/;
// картинка в строке группы: «Название (id)» и, если есть, « — «комментарий»»; название — всё до « (id)»
const ITEM = /\(([a-z0-9][a-z0-9-]*)\)(?: — «([^»]*)»)?(?:, |$)/g;

/** Текст «Скопировать решения» → решения по картинкам; текст не из листа — ошибка. */
export function parseDecisions(text: string, labels = ru.sheet): Decisions {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const head = HEAD.exec(lines[0] ?? '');
  if (!head) throw new Error(`первая строка — не заголовок решений листа: «${lines[0] ?? ''}»`);
  const kinds = new Map<string, Pick | null>([
    ...(Object.entries(labels.picks) as [Pick, string][]).map(([pick, label]): [string, Pick | null] => [label, pick]),
    [labels.noPick, null],
  ]);
  const items: Decision[] = [];
  for (const line of lines.slice(1)) {
    const group = GROUP.exec(line);
    if (!group || !kinds.has(group[1])) throw new Error(`строка не из листа: «${line}»`);
    const pick = kinds.get(group[1]) ?? null;
    const found: Decision[] = [];
    let from = 0;
    for (const m of group[3].matchAll(ITEM)) {
      found.push({ id: m[1], title: group[3].slice(from, m.index).trim(), pick, note: m[2] ?? '' });
      from = m.index + m[0].length;
    }
    if (found.length !== Number(group[2]) || from !== group[3].length) {
      throw new Error(`«${group[1]}»: в заголовке ${group[2]}, а разобрано ${found.length} — строку не понять целиком`);
    }
    items.push(...found);
  }
  const twice = items.map((d) => d.id).filter((id, i, all) => all.indexOf(id) !== i);
  if (twice.length) throw new Error(`картинка в двух группах: ${[...new Set(twice)].join(', ')}`);
  return { version: head[1], date: head[2], items };
}

/** Карточка с «да»: строка `approved` в конце; уже с «да» — без изменений (false). */
export function approve(yaml: string, date: string): { yaml: string; changed: boolean } {
  if (/^approved:/m.test(yaml)) return { yaml, changed: false };
  return { yaml: `${yaml.replace(/\n*$/, '\n')}approved: ${date}\n`, changed: true };
}

/**
 * «Нет» картинке с «да» (ADR 0010): `hidden: true` в конце карточки, а над ним — когда и что сказал
 * владелец. Без «да» или уже скрытая — без изменений (false): такую в выпуск не пускали, её правят руками.
 */
export function hide(yaml: string, d: { date: string; version: string; note: string }): { yaml: string; changed: boolean } {
  if (!/^approved:/m.test(yaml) || /^hidden:/m.test(yaml)) return { yaml, changed: false };
  const lines = [
    `# «Нет» владельца ${d.date} в «Листе узоров» ${d.version}${d.note ? `: «${d.note}»` : ''}.`,
    '# Скрыта (ADR 0010): узор — в наборе для начатых работ, в библиотеке и календаре картинки нет.',
    '# Вернуть — новой версией узора (`v`, `was`) и новым «да».',
    'hidden: true',
  ];
  return { yaml: `${yaml.replace(/\n*$/, '\n')}${lines.join('\n')}\n`, changed: true };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('нужен файл с текстом решений: bun tools/content/decisions.ts решения.txt [--write]');
  const write = args.includes('--write');
  const d = parseDecisions(readFileSync(file, 'utf8'));
  const cards = new Map(listCards().map((f) => {
    const { card } = readCard(f);
    return [card?.id ?? f, { file: f, card }] as const;
  }));
  const unknown = d.items.filter((it) => !cards.get(it.id)?.card);
  if (unknown.length) throw new Error(`нет таких карточек: ${unknown.map((it) => it.id).join(', ')}`);

  const n = d.items.length;
  const lines = [`Решения ${d.date} (Узоры ${d.version}): ${n} ${pluralRu(n, 'картинка', 'картинки', 'картинок')}.`];
  const yes = d.items.filter((it) => it.pick === 'yes');
  const fresh = yes.filter((it) => !cards.get(it.id)!.card!.approved);
  lines.push('', `«Да» — ${yes.length}, из них новых ${fresh.length}${write ? ' (approved записан)' : ' (запишет --write)'}:`);
  for (const it of fresh) {
    const { card } = cards.get(it.id)!;
    const where = card!.museum === 'ru' && !card!.license ? ' — музейная: в выпуск после В12'
      : card!.stock ? ' — в запас: не в 1.0, а в наборы недели после выхода' : '';
    lines.push(`- ${it.title} (${it.id})${where}${it.note ? ` — «${it.note}»` : ''}`);
  }
  // «Нет» картинке с «да» — скрыть (ADR 0010); без «да» — правка руками
  const shown = (it: Decision) => !!cards.get(it.id)!.card!.approved && !cards.get(it.id)!.card!.hidden;
  const withdrawn = d.items.filter((it) => it.pick === 'no' && shown(it));
  const item = (it: Decision) => `- ${it.title} (${it.id})${it.note ? ` — «${it.note}»` : ''}`;
  if (withdrawn.length) {
    lines.push('', `«Нет» картинкам с «да» — ${withdrawn.length}${write ? ' (скрыты: hidden)' : ' (скроет --write)'}:`, ...withdrawn.map(item));
  }
  for (const [pick, title] of [['no', '«Нет»'], ['later', '«Позже»'], [null, 'Только комментарий']] as const) {
    const group = d.items.filter((it) => it.pick === pick && !withdrawn.includes(it));
    if (!group.length) continue;
    lines.push('', `${title} — ${group.length}:`, ...group.map(item));
  }
  if (write) {
    for (const it of fresh) {
      const path = cards.get(it.id)!.file;
      writeFileSync(path, approve(readFileSync(path, 'utf8'), d.date).yaml);
    }
    for (const it of withdrawn) {
      const path = cards.get(it.id)!.file;
      writeFileSync(path, hide(readFileSync(path, 'utf8'), { date: d.date, version: d.version, note: it.note }).yaml);
    }
  }
  console.log(lines.join('\n'));
}

if (import.meta.main) main();
