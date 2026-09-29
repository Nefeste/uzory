# Встроенный набор

`generated/pack.ts` собирает `bun tools/content/build.ts` из `content/` и не хранит git:
набор — производная карточек и исходников ([`docs/specs/2026-09-content-pipeline.md`](../../docs/specs/2026-09-content-pipeline.md)).
Рядом та же сборка пишет `generated/music.ts` — список пьес из `assets/music/music.yaml`
с `require` их файлов; с `--release` — только пьесы с «да» владельца.
Без них приложение не собирается: сначала сборка картинок, потом типы и Metro — так же
делает CI.
