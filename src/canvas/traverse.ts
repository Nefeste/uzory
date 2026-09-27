// Кисть между двумя замерами пальца: все клетки, которые пересекает отрезок
// (обход сетки Amanatides–Woo, 1987). Координаты — в клетках, дробные. Ворклет: зовётся
// из обработчика жеста на UI-потоке и из тестов под Bun.

/** Дописывает в `out` номера клеток отрезка в порядке прохода, только внутри узора w × h. */
export function traverse(x0: number, y0: number, x1: number, y1: number, w: number, h: number, out: number[]): void {
  'worklet';
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = stepX > 0 ? (cx + 1 - x0) / dx : stepX < 0 ? (x0 - cx) / -dx : Infinity;
  let tMaxY = stepY > 0 ? (cy + 1 - y0) / dy : stepY < 0 ? (y0 - cy) / -dy : Infinity;
  if (cx >= 0 && cy >= 0 && cx < w && cy < h) out.push(cy * w + cx);
  const n = Math.abs(ex - cx) + Math.abs(ey - cy);
  for (let i = 0; i < n; i++) {
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      tMaxY += tDeltaY;
      cy += stepY;
    }
    if (cx >= 0 && cy >= 0 && cx < w && cy < h) out.push(cy * w + cx);
  }
}
