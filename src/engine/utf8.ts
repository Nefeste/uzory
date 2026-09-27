// UTF-8 своим кодом: `TextDecoder` в Hermes есть не во всех версиях, а движок работает
// одинаково в приложении, в вебе и в Bun.

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // одинокая половина пары
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** Строгое чтение: неверная последовательность — ошибка, а не «�». */
export function utf8Decode(b: Uint8Array): string {
  let s = '';
  const chunk: number[] = [];
  const flush = () => {
    s += String.fromCharCode(...chunk);
    chunk.length = 0;
  };
  for (let i = 0; i < b.length; ) {
    const x = b[i];
    let c: number;
    let n: number;
    if (x < 0x80) { c = x; n = 0; }
    else if (x >= 0xc2 && x < 0xe0) { c = x & 31; n = 1; }
    else if (x >= 0xe0 && x < 0xf0) { c = x & 15; n = 2; }
    else if (x >= 0xf0 && x < 0xf5) { c = x & 7; n = 3; }
    else throw new RangeError(`UTF-8: байт ${x} на месте ${i}`);
    if (n > 0 && i + n >= b.length) throw new RangeError('UTF-8 обрывается');
    for (let k = 1; k <= n; k++) {
      const y = b[i + k];
      if ((y & 0xc0) !== 0x80) throw new RangeError(`UTF-8: байт ${y} на месте ${i + k}`);
      c = (c << 6) | (y & 63);
    }
    if ((n === 2 && (c < 0x800 || (c >= 0xd800 && c <= 0xdfff))) || (n === 3 && (c < 0x10000 || c > 0x10ffff))) {
      throw new RangeError(`UTF-8: неверный знак на месте ${i}`);
    }
    i += n + 1;
    if (c >= 0x10000) {
      c -= 0x10000;
      chunk.push(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    } else chunk.push(c);
    if (chunk.length > 4096) flush();
  }
  flush();
  return s;
}
