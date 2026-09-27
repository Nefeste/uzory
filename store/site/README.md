# Материалы для gornitsa.games

Страница «Узоров» на сайте студии ([репозиторий сайта](https://github.com/Nefeste/gornitsagames))
собирается из тех же материалов, что карточка RuStore. Куда что кладётся в репозитории сайта:

| Файл здесь | Куда на сайте | Когда |
|---|---|---|
| `uzory-icon.webp` (256 × 256) | `site/assets/games/uzory-icon.webp` | сразу |
| `uzory-feature.webp`, `uzory-feature-en.webp` (1024 × 500) | `site/assets/games/` — картинка для соцсетей (`og:image`) | сразу |
| `uzory-01-stitch.webp` … `uzory-04-done.webp` (540 × 960) | `site/assets/games/` | сразу |
| [`uzory.html`](uzory.html) | `src/uzory/index.html`; в `build.py` — пара `"uzory/index.html": ("games", "/", "ru", "en/uzory/index.html")` | когда карточка RuStore пройдёт модерацию: на странице — ссылка на предзаказ |
| [`uzory.en.html`](uzory.en.html) | `src/en/uzory/index.html` и пара в `build.py` | вместе с русской |
| [`cards.html`](cards.html) | карточка на главной (`src/index.html`, `src/en/index.html`): из «В планах» — в «В разработке» | вместе со страницей |
| [`privacy-uzory.ru.html`](privacy-uzory.ru.html) | раздел `#uzory` в `src/privacy.html` (и английский — в `src/en/privacy.html`) | **до подачи карточки в RuStore**: ссылка на политику обязательна |

Строки nginx для раздачи наборов (`/uzory/v1/…`) — отдельная правка сайта, этап 0.4
(`docs/specs/2026-09-packs.md`).

WebP и снимки пересоздаются: `bun tools/store/graphics.ts` (баннеры, значок) и
`bun tools/store/shots.ts` (снимки экрана).
