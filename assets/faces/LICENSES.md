# Детектор лиц и его лицензии

«Найти лица» в «Своём узоре» (с 0.24.0; [спецификация](../../docs/specs/2026-09-custom.md), «Найти лица»;
issue 146). Код детектора — порт pico.js на TypeScript (`src/engine/build/faces.ts`), каскад — файл рядом.
Игра не отправляет снимок никуда: детектор работает на телефоне.

| Файл | Что | Источник | Лицензия |
|------|-----|----------|----------|
| `facefinder.bin` | каскад лиц pico: деревья сравнений яркости, лица анфас и вполоборота | <https://github.com/nenadmarkus/pico>, `rnt/cascades/facefinder` (SHA-256 `d8014993e7298c7b1865d1f8b855d6dbf4ec5c808bf879e2091ab6837abf90cd`) | MIT, © 2013 Nenad Markus |
| `src/engine/build/faces.ts` | порт pico.js: разбор каскада, поиск окон, кучки | <https://github.com/nenadmarkus/picojs>, `pico.js` | MIT, © 2013 Nenad Markus |

## Текст лицензии MIT (pico и pico.js)

```
The MIT License

Copyright (c) 2013 Nenad Markus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
