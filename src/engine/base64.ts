// base64 своим кодом: встроенный набор лежит строкой в модуле JS (docs/04-data-model.md,
// «Наборы и библиотека»), а `atob` есть не везде. Декодировать его целиком при запуске без JIT,
// как на телефоне, — полсекунды, поэтому он декодируется по частям (`lazyBase64`).

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < ABC.length; i++) INDEX[ABC.charCodeAt(i)] = i;

export function base64Encode(b: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const v = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    s += ABC[v >> 18] + ABC[(v >> 12) & 63] + ABC[(v >> 6) & 63] + ABC[v & 63];
  }
  if (i < b.length) {
    const v = (b[i] << 16) | ((i + 1 < b.length ? b[i + 1] : 0) << 8);
    s += ABC[v >> 18] + ABC[(v >> 12) & 63] + (i + 1 < b.length ? ABC[(v >> 6) & 63] : '=') + '=';
  }
  return s;
}

/** Длина без «=» в конце; длины, которой у base64 не бывает, — ошибка. */
function dataLength(s: string): number {
  let len = s.length;
  while (len > 0 && s[len - 1] === '=') len--;
  if (len % 4 === 1) throw new RangeError('base64: неверная длина');
  return len;
}

/** Знаки `s` с `from` (кратно 4) до `to` — байтами в `out` с места `o`. */
function decodeInto(s: string, from: number, to: number, out: Uint8Array, o: number) {
  let acc = 0;
  let bits = 0;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? INDEX[c] : -1;
    if (v < 0) throw new RangeError(`base64: знак «${s[i]}» на месте ${i}`);
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
}

export function base64Decode(s: string): Uint8Array {
  const len = dataLength(s);
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  decodeInto(s, 0, len, out, 0);
  return out;
}

/** Кусок ленивого декодирования: 3 КБ байтов — 4096 знаков. */
const CHUNK = 3 * 1024;

/**
 * Байты строки base64, которые декодируются по мере надобности: `bytes` — сразу во всю длину, но
 * заполнены в нём только куски, о которых просили `fill(start, end)`. Встроенному набору при запуске
 * нужны заголовок и JSON, а узор — когда его открывают (`openPack`, `packPattern`).
 */
export function lazyBase64(s: string): { bytes: Uint8Array; fill: (start: number, end: number) => void } {
  const len = dataLength(s);
  const bytes = new Uint8Array(Math.floor((len * 3) / 4));
  const done = new Uint8Array(Math.ceil(bytes.length / CHUNK));
  const fill = (start: number, end: number) => {
    if (end <= start) return;
    const last = Math.min(done.length, Math.ceil(end / CHUNK));
    for (let k = Math.max(0, Math.floor(start / CHUNK)); k < last; k++) {
      if (done[k]) continue;
      const from = (k * CHUNK * 4) / 3;
      decodeInto(s, from, Math.min(len, from + (CHUNK * 4) / 3), bytes, k * CHUNK);
      done[k] = 1;
    }
  };
  return { bytes, fill };
}
