// Выбор файла в браузере для «Загрузить из файла» (docs/specs/2026-09-plus.md, «Перенос»):
// файл читается в памяти вкладки и никуда не уходит.
export const PICK_MAX = 64 * 1024 * 1024;

export class PickTooBig extends Error {}

/** Открывает выбор файла; отказался — null; слишком большой — PickTooBig. */
export function pickFile(): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.uzw,application/json';
    input.style.display = 'none';
    input.setAttribute('data-testid', 'pick-file');
    const done = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      done();
      if (!file) resolve(null);
      else if (file.size > PICK_MAX) reject(new PickTooBig());
      else file.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
    });
    input.addEventListener('cancel', () => {
      done();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}
