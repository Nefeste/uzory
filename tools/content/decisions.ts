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
// Повторный отбор (с 0.16.2): у картинки в тексте — версия, «Название (id@v)». «Да» новой версии, у
// карточки которой «да» было у прежней (`approved_v`), — снять approved_v и записать дату; решение по
// другой версии, чем в карточке, — ошибка: картинку пересобрали после отбора, её надо смотреть снова.
// Настройки (с 0.24.1): «Название (id@v) {клеток 450, нитей 40, упрощение: немного}» — с «да» картинка
// пересобирается новой версией с этими числами и получает «да» сразу; без «да» — пересобирается и снова идёт
// на отбор (`retune`).
import { readFileSync, writeFileSync } from 'node:fs';
import { pluralRu } from '../../src/i18n/plural';
import { ru } from '../../src/i18n/ru';
import { cleanTune, type DecisionLabels, type Pick, type Tune, TUNE_SIDE, TUNE_THREADS, tuneText } from '../../src/state/decisions';
import { type Card, listCards, readCard } from './cards';

export interface Decision {
  id: string;
  /** версия, которую смотрел владелец (с 0.16.2: «id@v»); в тексте до 0.16.2 версии нет */
  v?: number;
  title: string;
  /** null — без отметки, только комментарий или настройки */
  pick: Pick | null;
  note: string;
  /** настройки, при которых владелец согласен (с 0.24.1) */
  tune?: Tune;
}

export interface Decisions {
  version: string;
  /** день, когда владелец скопировал решения, — он же дата `approved` */
  date: string;
  items: Decision[];
}

const HEAD = /^Узоры (\S+) — отбор картинок, (\d{4}-\d{2}-\d{2})$/;
const GROUP = /^(.+?) \((\d+)\): (.*)$/;
// картинка в строке группы: «Название (id@v)» (до 0.16.2 — «(id)»), если есть — « {настройки}» (с 0.24.1)
// и « — «комментарий»»; название — всё до « (id@v)»
const ITEM = /\(([a-z0-9][a-z0-9-]*)(?:@([1-9]\d*))?\)(?: \{([^}]*)\})?(?: — «([^»]*)»)?(?:, |$)/g;

/** Строка настроек из текста решений обратно (src/state/decisions.ts, tuneText); незнакомое слово или число вне пределов — ошибка. */
export function parseTune(s: string, w: DecisionLabels['tuneWords']): Tune {
  const t: Tune = {};
  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    const num = new RegExp(`^(${w.size}|${w.threads}) (\\d+)$`).exec(part);
    const level = part.startsWith(`${w.simplify}: `) ? w.levels.indexOf(part.slice(w.simplify.length + 2)) : -2;
    if (num) t[num[1] === w.size ? 'size' : 'threads'] = Number(num[2]);
    else if (level >= 0) t.simplify = level as 0 | 1 | 2;
    else throw new Error(`настройки не понять: «${part}»`);
  }
  const clean = cleanTune(t);
  if (!clean || Object.keys(clean).length !== Object.keys(t).length) throw new Error(`настройки вне пределов: «${s}» (клеток ${TUNE_SIDE.join('–')}, нитей ${TUNE_THREADS.join('–')})`);
  return clean;
}

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
      found.push({
        id: m[1], ...(m[2] ? { v: Number(m[2]) } : {}), title: group[3].slice(from, m.index).trim(), pick, note: m[4] ?? '',
        ...(m[3] !== undefined ? { tune: parseTune(m[3], labels.tuneWords) } : {}),
      });
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

/**
 * Карточка с «да»: строка `approved` в конце; уже с «да» — без изменений (false). На повторном отборе
 * (`approved_v`: «да» было у прежней версии) — «да» нынешней: approved_v снимается, дата — новая.
 */
export function approve(yaml: string, date: string): { yaml: string; changed: boolean } {
  if (/^approved_v:/m.test(yaml)) {
    return { yaml: yaml.replace(/^approved_v:.*\n?/m, '').replace(/^approved:.*$/m, `approved: ${date}`), changed: true };
  }
  if (/^approved:/m.test(yaml)) return { yaml, changed: false };
  return { yaml: `${yaml.replace(/\n*$/, '\n')}approved: ${date}\n`, changed: true };
}

/** Решения по другой версии, чем в карточке: картинку пересобрали после отбора — её надо смотреть снова. */
export function staleDecisions(items: readonly Decision[], versionOf: (id: string) => number): string[] {
  return items.filter((it) => it.v !== undefined && it.v !== versionOf(it.id)).map((it) => `${it.id}@${it.v} (в карточке — v ${versionOf(it.id)})`);
}

/**
 * «Нет» картинке с «да» (ADR 0010): `hidden: true` в конце карточки, а над ним — когда и что сказал
 * владелец. Без «да» или уже скрытая — без изменений (false): такую в выпуск не пускали, её правят руками.
 */
export function hide(yaml: string, d: { date: string; version: string; note: string }): { yaml: string; changed: boolean } {
  if (!/^approved:/m.test(yaml) || /^hidden:/m.test(yaml)) return { yaml, changed: false };
  const said = `# «Нет» владельца ${d.date} в «Листе узоров» ${d.version}${d.note ? `: «${d.note}»` : ''}`;
  // повторный отбор: «нет» — новой версии; прежняя с «да» (approved_v) остаётся в наборе выпуска скрытой
  const lines = /^approved_v:/m.test(yaml) ? [
    `${said} — новой версии на повторном отборе.`,
    '# Скрыта: прежняя версия с «да» (approved_v) — в наборе для начатых работ (ADR 0010).',
    'hidden: true',
  ] : [
    `${said}.`,
    '# Скрыта (ADR 0010): узор — в наборе для начатых работ, в библиотеке и календаре картинки нет.',
    '# Вернуть — новой версией узора (`v`, `was`) и новым «да».',
    'hidden: true',
  ];
  return { yaml: `${yaml.replace(/\n*$/, '\n')}${lines.join('\n')}\n`, changed: true };
}

/** Поля узора, которые меняют настройки владельца; у прежних версий без поля в was — как без поля: 0. */
type Tuned = 'size' | 'threads' | 'simplify' | 'smooth';
const TUNED_NEUTRAL: Partial<Record<Tuned, number>> = { simplify: 0, smooth: 0 };

/** Верхние пары «ключ: значение» плоского словаря YAML `{ a: 1, b: [1, 2] }` — ключи по порядку. */
function flowKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0, start = 0;
  const take = (end: number) => {
    const part = body.slice(start, end).trim();
    const k = /^([a-z_]+):/.exec(part);
    if (k) keys.push(k[1]);
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      take(i);
      start = i + 1;
    }
  }
  take(body.length);
  return keys;
}

/** Что настройки меняют в карточке: новые значения полей; пусто — как в карточке. Нельзя — строка-причина. */
export function tuneChanges(card: Card, tune: Tune): { set: Partial<Record<Tuned, number | null>>; old: Partial<Record<Tuned, number>> } | string {
  const p = card.pattern;
  if (!p) return 'узор нарисован, а не собран из картинки — настройки не к нему';
  if (p.chart && (tune.size !== undefined || tune.simplify !== undefined)) return 'у старинной схемы клетки — её собственные, упрощения нет: только нити';
  const set: Partial<Record<Tuned, number | null>> = {};
  const old: Partial<Record<Tuned, number>> = {};
  const now = (k: Tuned) => (p[k] as number | undefined) ?? TUNED_NEUTRAL[k];
  if (tune.size !== undefined && tune.size !== p.size) [set.size, old.size] = [tune.size, p.size];
  if (tune.threads !== undefined && tune.threads !== p.threads) [set.threads, old.threads] = [tune.threads, p.threads];
  if (tune.simplify !== undefined && tune.simplify !== now('simplify')) [set.simplify, old.simplify] = [tune.simplify, now('simplify')!];
  // упрощение и сглаживание вместе не бывают (cards.ts): с упрощением сглаживание уходит
  if (tune.simplify && now('smooth')) [set.smooth, old.smooth] = [null, now('smooth')!];
  return { set, old };
}

/**
 * Настройки владельца (с 0.24.1) → новая версия карточки: поля pattern — новые, `v` — на один больше. Прежние
 * версии — те же узоры (ADR 0010): узор версии — {...pattern, ...was[v]}, поэтому у каждой строки was, где
 * изменённого поля нет, оно дописывается прежним значением, и строка was прежней нынешней версии — новая. С
 * «да» — approved у новой версии (approved_v снимается, скрытая возвращается); без «да» у карточки с «да» —
 * approved_v прежней: в выпуске остаётся она, пока новая на отборе.
 */
export function retune(yaml: string, card: Card, tune: Tune, o: { pick: Pick | null; date: string; text: string }): { yaml: string; changed: boolean } {
  const ch = tuneChanges(card, tune);
  if (typeof ch === 'string') throw new Error(`${card.id}: ${ch}`);
  const fields = Object.keys(ch.set) as Tuned[];
  if (!fields.length) return o.pick === 'yes' ? approve(yaml, o.date) : { yaml, changed: false };
  const oldV = card.v, newV = card.v + 1;
  let lines = yaml.replace(/\n*$/, '').split('\n');
  const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
  // конец блока pattern: следующая строка верхнего уровня
  const patternEnd = () => {
    const from = at(/^pattern:/);
    if (from < 0) throw new Error(`${card.id}: нет блока pattern`);
    let i = from + 1;
    while (i < lines.length && (lines[i] === '' || /^\s/.test(lines[i]))) i++;
    return i;
  };
  // поля pattern
  for (const f of fields) {
    const value = ch.set[f];
    const i = lines.findIndex((l) => new RegExp(`^  ${f}:`).test(l));
    const line = `  ${f}: ${value}   # настройки владельца ${o.date}`;
    if (value === null) {
      if (i >= 0) lines.splice(i, 1);
    } else if (i >= 0) lines[i] = line;
    else {
      const after = at(/^  threads:/);
      lines.splice(after >= 0 ? after + 1 : patternEnd(), 0, line);
    }
  }
  // was: у прежних версий — прежние значения изменённых полей; прежняя нынешняя — своей строкой
  const prev = (f: Tuned) => ch.old[f];
  const wasAt = at(/^was:/);
  if (wasAt >= 0) {
    for (let i = wasAt + 1; i < lines.length && /^\s/.test(lines[i]); i++) {
      const m = /^(  \d+: \{)(.*)(\})(\s*#.*)?$/.exec(lines[i]);
      if (!m) throw new Error(`${card.id}: строка was не в одну строку — правка руками: «${lines[i]}»`);
      const have = new Set(flowKeys(m[2]));
      const add = fields.filter((f) => !have.has(f)).map((f) => `${f}: ${prev(f)}`);
      if (add.length) lines[i] = `${m[1]}${m[2].trimEnd()}${m[2].trim() ? ', ' : ' '}${add.join(', ')} ${m[3]}${m[4] ?? ''}`;
    }
  }
  const entry = `  ${oldV}: { ${fields.map((f) => `${f}: ${prev(f)}`).join(', ')} }   # до настроек владельца ${o.date} — для начатых работ`;
  if (wasAt >= 0) {
    let end = wasAt + 1;
    while (end < lines.length && /^\s/.test(lines[end])) end++;
    lines.splice(end, 0, entry);
  } else lines.splice(patternEnd(), 0, 'was:', entry);
  // версия
  const vAt = at(/^v: \d+/);
  if (vAt < 0) throw new Error(`${card.id}: нет строки v`);
  lines[vAt] = `v: ${newV}   # настройки владельца ${o.date}: ${o.text}; прежние — в was`;
  // «да»
  if (o.pick === 'yes') {
    lines = lines.filter((l) => !/^approved_v:/.test(l));
    const hid = at(/^hidden: true/);
    if (hid >= 0) lines.splice(hid, 1, `# Вернулась ${o.date}: «да» владельца при настройках «${o.text}» — новая версия.`);
    const ap = at(/^approved:/);
    if (ap >= 0) lines[ap] = `approved: ${o.date}`;
    else lines.push(`approved: ${o.date}`);
  } else if (card.approved && card.approved_v === undefined) {
    lines.push(`approved_v: ${oldV}   # «да» — у прежней версии; новая по настройкам владельца ${o.date} — на отборе`);
  }
  return { yaml: `${lines.join('\n')}\n`, changed: true };
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
  const stale = staleDecisions(d.items, (id) => cards.get(id)!.card!.v);
  if (stale.length) throw new Error(`решения по другой версии узора — картинку пересобрали после отбора: ${stale.join(', ')}`);
  // настройки (с 0.24.1): картинка пересобирается с ними — с «да» сразу в выпуск, без «да» — снова на отбор
  const tuned = d.items.filter((it) => it.tune);
  const wrong = tuned.map((it) => [it, tuneChanges(cards.get(it.id)!.card!, it.tune!)] as const).filter(([, c]) => typeof c === 'string');
  if (wrong.length) throw new Error(`настройки не применить: ${wrong.map(([it, c]) => `${it.id} — ${c as string}`).join('; ')}`);
  const words = ru.sheet.tuneWords;

  const n = d.items.length;
  const lines = [`Решения ${d.date} (Узоры ${d.version}): ${n} ${pluralRu(n, 'картинка', 'картинки', 'картинок')}.`];
  const yes = d.items.filter((it) => it.pick === 'yes');
  // новое «да» — и нынешней версии на повторном отборе (approved_v: «да» было у прежней)
  const fresh = yes.filter((it) => !it.tune && (!cards.get(it.id)!.card!.approved || cards.get(it.id)!.card!.approved_v !== undefined));
  lines.push('', `«Да» — ${yes.length}, из них новых ${fresh.length}${write ? ' (approved записан)' : ' (запишет --write)'}:`);
  for (const it of fresh) {
    const { card } = cards.get(it.id)!;
    const where = card!.museum === 'ru' && !card!.license ? ' — музейная: в выпуск после В12'
      : card!.stock ? ' — в запас: не в 1.0, а в наборы недели после выхода' : '';
    lines.push(`- ${it.title} (${it.id})${where}${it.note ? ` — «${it.note}»` : ''}`);
  }
  // «Нет» картинке с «да» — скрыть (ADR 0010); без «да» — правка руками
  const shown = (it: Decision) => !!cards.get(it.id)!.card!.approved && !cards.get(it.id)!.card!.hidden;
  const withdrawn = d.items.filter((it) => it.pick === 'no' && shown(it) && !it.tune);
  const item = (it: Decision) => `- ${it.title} (${it.id})${it.note ? ` — «${it.note}»` : ''}`;
  if (withdrawn.length) {
    lines.push('', `«Нет» картинкам с «да» — ${withdrawn.length}${write ? ' (скрыты: hidden)' : ' (скроет --write)'}:`, ...withdrawn.map(item));
  }
  if (tuned.length) {
    lines.push('', `Настройки — ${tuned.length}${write ? ' (новые версии записаны)' : ' (запишет --write)'}:`);
    for (const it of tuned) {
      const c = tuneChanges(cards.get(it.id)!.card!, it.tune!) as Exclude<ReturnType<typeof tuneChanges>, string>;
      const what = (Object.keys(c.set) as (keyof typeof c.set)[]).map((f) => `${f} ${c.old[f]} → ${c.set[f] ?? 'нет'}`).join(', ');
      const v = cards.get(it.id)!.card!.v;
      lines.push(`- ${it.title} (${it.id}): ${what || 'как в карточке'}${what ? ` — версия ${v + 1}${it.pick === 'yes' ? ', «да» сразу' : ', снова на отбор'}` : it.pick === 'yes' ? ' — «да» нынешней' : ''}${it.note ? ` — «${it.note}»` : ''}`);
    }
  }
  for (const [pick, title] of [['no', '«Нет»'], ['later', '«Позже»'], [null, 'Только комментарий']] as const) {
    const group = d.items.filter((it) => it.pick === pick && !withdrawn.includes(it) && !it.tune);
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
    // новая версия — сразу через проверку карточки: числа в пределах, а соседние поля (min_delta по размеру,
    // px со сглаживанием) могут с ними не сойтись — тогда карточка остаётся прежней, а правка — руками
    const bad: string[] = [];
    for (const it of tuned) {
      const { file, card } = cards.get(it.id)!;
      const before = readFileSync(file, 'utf8');
      writeFileSync(file, retune(before, card!, it.tune!, { pick: it.pick, date: d.date, text: tuneText(it.tune!, words) }).yaml);
      const after = readCard(file).errors;
      if (after.length) {
        writeFileSync(file, before);
        bad.push(`${it.id} — ${after.join('; ')}`);
      }
    }
    if (bad.length) {
      console.log(lines.join('\n'));
      throw new Error(`настройки не сошлись с карточкой — эти карточки не тронуты, правка руками: ${bad.join(' | ')}`);
    }
  }
  console.log(lines.join('\n'));
}

if (import.meta.main) main();
