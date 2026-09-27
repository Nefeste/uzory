// Числа переменной длины (varint, как в protobuf) и «зигзаг» для знаковых. Числа — до 2^53:
// в файле работы лежат миллисекунды, а они не влезают в 32 бита, поэтому без побитовых
// операций.

/** Файл кончился посреди числа или записи. */
export class Truncated extends Error {
  constructor() {
    super('данные обрываются');
  }
}

export class Writer {
  private buf: Uint8Array;
  private n = 0;

  constructor(capacity = 256) {
    this.buf = new Uint8Array(Math.max(16, capacity));
  }

  get length(): number { return this.n; }

  private room(k: number) {
    if (this.n + k <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }

  byte(b: number) {
    this.room(1);
    this.buf[this.n++] = b;
  }

  bytes(a: ArrayLike<number>) {
    this.room(a.length);
    this.buf.set(a, this.n);
    this.n += a.length;
  }

  /** Целое ≥ 0, не больше 2^53 − 1. */
  uint(v: number) {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`varint: ${v}`);
    this.room(8);
    while (v >= 0x80) {
      this.buf[this.n++] = (v % 0x80) | 0x80;
      v = Math.floor(v / 0x80);
    }
    this.buf[this.n++] = v;
  }

  /** Целое со знаком, |v| < 2^52: 0, −1, 1, −2… → 0, 1, 2, 3… */
  int(v: number) {
    if (!Number.isSafeInteger(v * 2)) throw new RangeError(`varint: ${v}`);
    this.uint(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  u32le(v: number) {
    this.room(4);
    this.buf[this.n++] = v & 0xff;
    this.buf[this.n++] = (v >>> 8) & 0xff;
    this.buf[this.n++] = (v >>> 16) & 0xff;
    this.buf[this.n++] = (v >>> 24) & 0xff;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

export class Reader {
  pos: number;

  constructor(readonly buf: Uint8Array, pos = 0) {
    this.pos = pos;
  }

  get done(): boolean { return this.pos >= this.buf.length; }
  get left(): number { return this.buf.length - this.pos; }

  byte(): number {
    if (this.pos >= this.buf.length) throw new Truncated();
    return this.buf[this.pos++];
  }

  uint(): number {
    let v = 0;
    let mul = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      v += (b & 0x7f) * mul;
      if (b < 0x80) {
        if (!Number.isSafeInteger(v)) throw new RangeError('varint больше 2^53');
        return v;
      }
      mul *= 0x80;
    }
    throw new RangeError('varint длиннее 8 байт');
  }

  int(): number {
    const z = this.uint();
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }

  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new Truncated();
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  u32le(): number {
    const b = this.bytes(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16)) + b[3] * 0x1000000;
  }
}
