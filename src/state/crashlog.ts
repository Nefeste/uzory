// из votchina: src/state/crashlog.ts @ 1242776
// Журнал сбоев (перенос из «Вотчины»): последние ошибки на телефоне, чтобы в отчёте было
// не «вылетело», а что и где. Никуда не уходит сам: только в отчёт, который игрок видит
// целиком и отправляет своими руками.
import { KEYS, loadJson, saveJson } from './storage';

export type CrashKind = 'crash' | 'error' | 'render' | 'work' | 'pack' | 'web';
export interface CrashEntry { at: number; kind: CrashKind; message: string }

export const CRASH_MAX = 30;
const LEN = 1000;
const STACK_LINES = 8;

export function crashText(err: unknown, where?: string): string {
  const e = err as { name?: string; message?: string; stack?: string } | null;
  const head = e && typeof e === 'object' ? `${e.name ?? 'Error'}: ${e.message ?? ''}` : String(err);
  const stack = e && typeof e === 'object' && e.stack ? e.stack.split('\n').slice(1, 1 + STACK_LINES).join('\n') : '';
  return [where, head, stack].filter(Boolean).join('\n').slice(0, LEN);
}

// записи идут друг за другом: две ошибки подряд не затирают друг друга
let queue: Promise<void> = Promise.resolve();

export function logError(kind: CrashKind, err: unknown, where?: string): void {
  const entry: CrashEntry = { at: Date.now(), kind, message: crashText(err, where) };
  queue = queue.then(async () => {
    const list = (await loadJson<CrashEntry[]>(KEYS.crashlog)) ?? [];
    await saveJson(KEYS.crashlog, [...(Array.isArray(list) ? list : []), entry].slice(-CRASH_MAX));
  }).catch(() => {});
}

/** Журнал; `null` — не прочитался (в отчёте так и будет сказано). */
export async function readCrashlog(): Promise<CrashEntry[] | null> {
  try {
    await queue;
    const list = await loadJson<CrashEntry[]>(KEYS.crashlog);
    return Array.isArray(list) ? list : [];
  } catch {
    return null;
  }
}

/** Ловушки при запуске; прежний обработчик вызывается дальше — поведение сбоя не меняется. */
export function installCrashHandlers(): void {
  type Handler = (e: unknown, fatal?: boolean) => void;
  const EU = (globalThis as { ErrorUtils?: { getGlobalHandler?: () => Handler; setGlobalHandler?: (h: Handler) => void } }).ErrorUtils;
  if (EU?.getGlobalHandler && EU.setGlobalHandler) {
    const prev = EU.getGlobalHandler();
    EU.setGlobalHandler((e, fatal) => {
      logError(fatal ? 'crash' : 'error', e);
      prev?.(e, fatal);
    });
  }
  type Ev = { error?: unknown; message?: string; reason?: unknown };
  const w = (globalThis as { window?: { addEventListener?: (t: string, f: (e: Ev) => void) => void } }).window;
  if (w?.addEventListener) {
    w.addEventListener('error', (e) => logError('web', e.error ?? e.message));
    w.addEventListener('unhandledrejection', (e) => logError('web', e.reason));
  }
}
