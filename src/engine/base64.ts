// base64 своим кодом: встроенный набор в прототипах лежит строкой в модуле JS
// (docs/specs/2026-09-spikes.md, П4), а `atob` есть не везде.

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

export function base64Decode(s: string): Uint8Array {
  let len = s.length;
  while (len > 0 && s[len - 1] === '=') len--;
  if (len % 4 === 1) throw new RangeError('base64: неверная длина');
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
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
  return out;
}
