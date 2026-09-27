This is an Expo/React Native mobile game for RuStore: «Узоры», a color-by-number game styled as
digital cross-stitch (a grid of numbered cells, threads, stitches). Prioritize mobile-first
patterns, smooth canvas performance on inexpensive Android phones, and calm, honest UX.

**Status: stage 0 — prototypes 0.0.1** (`docs/specs/2026-09-spikes.md`): canvas, picture
build, work file, Android CI; `store/` holds the RuStore listing materials (pre-order) that the
studio site reuses.

## Studio charter — read first

This project belongs to the «Горница» studio. Studio-wide rules live only in the public
charter repository `Nefeste/gornitsa` (https://github.com/Nefeste/gornitsa); this repository
keeps only what is specific to the project. Before changing anything — and after a context
reset — read the charter's `AGENTS.md`, then `docs/05-rules.md` (hard rules for every game)
and `docs/04-process.md` (how work is done). Raw files:
`https://raw.githubusercontent.com/Nefeste/gornitsa/main/<path>`.

Precedence: the owner's recorded decision → the charter → this project's documents. A project
rule may narrow a charter rule, never weaken it. If a document here restates or contradicts
the charter, replace it with a link or report the contradiction to the owner.

## Read `docs/` before changing anything

The project documents itself in [`docs/`](docs/README.md), in Russian, and that is the source of
truth for *why* things are the way they are. Start there, in this order, especially after a context
reset:

- `docs/README.md` — index and the rules these documents follow.
- `docs/01-product.md` — what we promise the player and what is deliberately absent; glossary.
- `docs/08-game-design.md` — loop, screens, controls, daily picture, subscription as the player
  sees it; **all game-design numbers live only there**.
- `docs/09-content.md` — pictures: allowed and forbidden sources, rights rules, the conversion
  pipeline, curation. **Read before adding or generating any picture.**
- `docs/02-architecture.md`, `docs/03-server-api.md`, `docs/04-data-model.md` — how it is built.
- `docs/05-process.md`, `docs/06-testing.md` — versions, CI, release, the picture workflow, what to run.
- `docs/07-roadmap.md` — what is being built now; it links the live specification.
- `docs/10-money.md`, `docs/11-market.md` — subscription, law, market.
- `docs/adr/` — decisions that are expensive to reverse. Read the relevant one *before* proposing
  the opposite; each records what it costs.
- `docs/specs/` — specification-driven development: a notable feature gets a spec **before** code.

Working rule, spec-first lifecycle, ADRs and version sections are the same in every studio
project — charter `docs/04-process.md`. In addition here: new pictures are **content records**,
not specs (`docs/05-process.md`, «Второй поток: картинки»).

## Sister projects

Infrastructure is reused from the studio's other games **by copying** with a source line on top
(studio ADR 0002, project ADR 0001):
`Nefeste/votchina` (dialog, i18n mechanics, crash log and report, storage, settings, release
signing plugin, Android CI, RuStore upload), `Nefeste/anamnez` (Skia setup incl. web CanvasKit
loading), `Nefeste/nardy` (RuStore Pay and Review integration). The studio brand
(fonts Kurale and Onest, colour tokens, the ornament band) is in the charter's `brand/`; the site
`Nefeste/gornitsagames` holds the nginx config of the server that hosts picture packs.

## Expo and native SDKs

Planned Expo SDK 57, as the sister projects (see `package.json`). Never write Expo, React Native,
`@shopify/react-native-skia`, `react-native-reanimated`, `react-native-gesture-handler` or RuStore
Pay / Review code from memory — follow «Expo has changed» in the charter's `AGENTS.md` and read
the current docs of each SDK before use.

## Commands

```bash
npx expo install <package>          # ALWAYS use instead of npm/yarn/pnpm/bun add
bun tools/content/build.ts          # FIRST: builds src/content/generated/pack.ts (not in git)
npx expo start                      # dev server
npm run lint                        # zero warnings
npx tsc --noEmit                    # typecheck (also -p tools)
bun test tools/test                 # engine, shader golden frames, files, texts
bun tools/content/build.ts --check  # build packs and run every picture check
bun tools/content/sheet.ts          # preview sheet for the owner → dist/sheet/
npm run export:web && npm run e2e   # web build + Playwright scenario
bun tools/store/icons.ts            # icons from the shader; bun tools/store/shots.ts — store screenshots
```

Picture sources (Wikimedia Commons, Library of Congress) are not reachable from every agent
environment: `.github/workflows/content-fetch.yml` searches candidates into
`content/candidates.json` and downloads the files named in cards (`tools/content/fetch.ts`).
It runs only on manual dispatch — trigger it on your branch after adding cards (input `search`
to refresh candidates), then pull the bot's commit.

The repository is **public**. The owner's own photos for «Природа» and «Города» arrive as
assets of a **draft release** (drafts are visible to maintainers only): list releases via the
API, download assets with `Accept: application/octet-stream`. Only selected photos enter git
(card + 800 px source) — never commit the rest, never post them in logs or comments.

**CI runs only after merge** (studio rule, charter `docs/04-process.md`): `android.yml` runs on
push to `main` and on manual dispatch. Run typecheck, lint, tests and the web scenario locally
before every push; the APK is built and released only from `main`.

Run lint, typecheck and tests before declaring any task done. Canvas changes are re-measured on
the reference phone (hidden «Замер» screen); numbers go to `docs/02-architecture.md`.

## Hard rules

Studio-wide rules — no React Native `Alert`, player-facing strings only in `src/i18n/`, generated
`ios/`/`android/`, a permanent application id and signing key, a pure engine, no ads in the middle
of play, no pressure, content only from named sources — are in the charter's `docs/05-rules.md`
and are not repeated here. This project's own rules:

- **The engine is pure**: `src/engine/` — no React, no `Date.now()`, no `Math.random()`; today's
  date and subscription rights are arguments. The picture build is deterministic: same source,
  same pattern, byte for byte.
- **A work is a list of stitches** (ADR 0005); progress is derived, never stored as truth.
  **A released pattern never changes** and picture ids are eternal (ADR 0010); the golden test
  `tools/test/fixtures/released.json` must stay green — fix a picture by a new pattern version.
- **Pictures only from allowed sources** (`docs/09-content.md`, ADR 0006): public-domain works by
  the rules there, the owner's own photos, ornaments drawn by code or by hand. Never AI-generated
  images, never other coloring apps' pictures, never stock photos under restrictive licenses.
  Every picture card has a source and a legal basis. Paintings whose originals are held by
  Russian museums need the owner's recorded decision (museum law, `docs/09-content.md` §2)
  before release. The owner approves every picture.
- **No ads, no currency, no boosters for money, no energy, timers, streaks or nagging**
  (ADR 0008, 0011). The subscription is offered only in the three places listed in
  `docs/08-game-design.md`; no auto-converting trial (ADR 0009). Started works stay finishable
  after a subscription ends.
- **No server logic** (ADR 0007): the server serves static packs and a catalog; the only data it
  sees are the anonymous counters in the catalog query (ADR 0012). Never add identifiers.
- **The canvas is one SkSL `RuntimeEffect` over small data textures** (cells, palette, digit
  atlas); the fallback is the "layers" path (`docs/02-architecture.md`, «Канва»). Skia 2.6.2
  (SDK 57) samples `<ImageShader>` with `FilterMode.Nearest` bicubically — build the shader
  imperatively (`makeShaderOptions` → `makeShaderWithChildren`) or upgrade only after spike П2.
  Never put a Skia `Canvas` per library card — previews are PNGs shown with `expo-image`.
- **Worklets and React Compiler**: shared values via `.get()`/`.set()`; no nested arrow
  functions inside worklets (the compiler hoists them out) — use loops, or `"use no memo"` on
  the canvas component; big arrays live in shared values, not in worklet closures;
  `scheduleOnRN` instead of `runOnJS` (Reanimated 4).
- **Portrait on phones** (ADR 0013).
- `applicationId` is `games.gornitsa.uzory` (ADR 0014).
