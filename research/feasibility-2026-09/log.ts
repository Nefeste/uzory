import { deflateSync } from "fflate";
// Simulate a stroke log for a W x H grid with K colours: player fills colour by colour,
// dragging in rough scanlines inside each colour region (worst-ish case: random order within colour).
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function varint(out: number[], v: number) { while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; } out.push(v); }
for (const [W, H] of [[100, 100], [150, 200]]) {
  const n = W * H, rnd = mulberry32(7);
  // colour map: blobs
  const color = new Uint8Array(n); for (let i = 0; i < n; i++) { const x = i % W, y = (i / W) | 0; color[i] = (Math.floor(x / 13) * 7 + Math.floor(y / 11) * 3) % 24; }
  for (const mode of ["scanline", "shuffled-chunks"]) {
    const order: number[] = [];
    for (let c = 0; c < 24; c++) { const cells = []; for (let i = 0; i < n; i++) if (color[i] === c) cells.push(i);
      if (mode === "shuffled-chunks") { // player jumps around between regions of the same colour in chunks of ~20 cells
        const chunks = []; for (let i = 0; i < cells.length; i += 20) chunks.push(cells.slice(i, i + 20));
        for (let i = chunks.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [chunks[i], chunks[j]] = [chunks[j], chunks[i]]; }
        for (const ch of chunks) order.push(...ch);
      } else order.push(...cells); }
    const raw16 = new Uint8Array(new Uint16Array(order).buffer);
    const vi: number[] = []; let prev = 0; for (const i of order) { const d = i - prev; varint(vi, d >= 0 ? d * 2 : -d * 2 - 1); prev = i; }
    // time deltas: 1 byte per event (frames since previous event, capped)
    const td = new Uint8Array(order.length).map(() => (rnd() < 0.9 ? 1 + Math.floor(rnd() * 3) : 30 + Math.floor(rnd() * 200)));
    const withTime = new Uint8Array(vi.length + td.length); withTime.set(vi); withTime.set(td, vi.length);
    console.log(`${W}x${H} ${mode}: uint16 raw ${raw16.length}B, deflate(uint16) ${deflateSync(raw16, { level: 9 }).length}B, zigzag-varint ${vi.length}B -> deflate ${deflateSync(new Uint8Array(vi), { level: 9 }).length}B; +1B frame-delta/event -> deflate ${deflateSync(withTime, { level: 9 }).length}B; bitset ${Math.ceil(n / 8)}B`);
  }
}
