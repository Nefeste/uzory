// UTF-8: встроенные TextEncoder и TextDecoder, если они есть и ведут себя как свой код (проверка
// при загрузке), иначе свой код. Свой — потому что TextDecoder в Hermes есть не во всех версиях, а
// движок работает одинаково в приложении, в вебе и в Bun. Встроенные быстрее в десятки раз: без JIT,
// как на телефоне, свой код читает JSON встроенного набора (365 КБ) 46 мс, а указатель работ за год
// картинок дня (71 КБ) читает и пишет на каждой записи работы 16 мс; встроенные — 2 мс и доли
// миллисекунды (docs/specs/2026-09-spikes.md, П4).

/** Свой код: два прохода — длина, затем байты; одинокая половина суррогатной пары — «�». */
export function utf8EncodeOwn(s: string): Uint8Array {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
      n += 4;
      i++;
    } else n += 3;
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out[o++] = c;
      continue;
    }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // одинокая половина пары
    if (c < 0x800) {
      out[o++] = 0xc0 | (c >> 6);
      out[o++] = 0x80 | (c & 63);
    } else if (c < 0x10000) {
      out[o++] = 0xe0 | (c >> 12);
      out[o++] = 0x80 | ((c >> 6) & 63);
      out[o++] = 0x80 | (c & 63);
    } else {
      out[o++] = 0xf0 | (c >> 18);
      out[o++] = 0x80 | ((c >> 12) & 63);
      out[o++] = 0x80 | ((c >> 6) & 63);
      out[o++] = 0x80 | (c & 63);
    }
  }
  return out;
}

/** Свой код, строгое чтение: неверная последовательность — ошибка, а не «�»; BOM — знак, как все. */
export function utf8DecodeOwn(b: Uint8Array): string {
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

export interface Utf8Encoder { encode(s: string): Uint8Array }
export interface Utf8Decoder { decode(b: Uint8Array): string }

/** Строка для проверки: BOM в начале, знаки в один, два, три и четыре байта. */
const TEXT = '\ufeffa\u0439\u20ac\ud83d\ude00b';
/** Она же с одинокими половинами суррогатных пар — кодировщик пишет их как «�». */
const PROBE = `${TEXT}\ud800c\udc00`;
/** Чего строгое чтение не пропускает: чужой байт, лишняя длина, половина пары, за 0x10FFFF, обрыв. */
const BAD = [[0xff], [0x80], [0xc0, 0x80], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82]];

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const throws = (f: () => unknown) => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};

/** Встроенный кодировщик, если он даёт те же байты, что свой код; иначе — null. */
export function checkedEncoder(make: (() => Utf8Encoder) | null): Utf8Encoder | null {
  try {
    const e = make?.();
    return e && sameBytes(e.encode(PROBE), utf8EncodeOwn(PROBE)) ? e : null;
  } catch {
    return null;
  }
}

/** Встроенное чтение, если оно строгое и читает как свой код — BOM не съедает; иначе — null. */
export function checkedDecoder(make: (() => Utf8Decoder) | null): Utf8Decoder | null {
  try {
    const d = make?.();
    if (!d || d.decode(utf8EncodeOwn(TEXT)) !== TEXT) return null;
    return BAD.every((b) => throws(() => d.decode(Uint8Array.from(b)))) ? d : null;
  } catch {
    return null;
  }
}

const G = globalThis as {
  TextEncoder?: new () => Utf8Encoder;
  TextDecoder?: new (label: string, options: { fatal: boolean; ignoreBOM: boolean }) => Utf8Decoder;
};
const encoder = checkedEncoder(G.TextEncoder ? () => new G.TextEncoder!() : null);
const decoder = checkedDecoder(G.TextDecoder ? () => new G.TextDecoder!('utf-8', { fatal: true, ignoreBOM: true }) : null);

/** Чем кодируется и читается UTF-8 здесь — для экрана «Файл работы». */
export const utf8Native = { encode: encoder !== null, decode: decoder !== null };

export function utf8Encode(s: string): Uint8Array {
  return encoder ? encoder.encode(s) : utf8EncodeOwn(s);
}

/** Строгое чтение: неверная последовательность — RangeError с местом байта, как у своего кода. */
export function utf8Decode(b: Uint8Array): string {
  if (!decoder) return utf8DecodeOwn(b);
  try {
    return decoder.decode(b);
  } catch {
    return utf8DecodeOwn(b);
  }
}
