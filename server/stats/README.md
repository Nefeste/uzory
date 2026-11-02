# Счётчики на сервере

Свёртка журнала каталога в суммы — [`fold.ts`](fold.ts) (ADR [0012](../../docs/adr/0012-stats-from-manifest.md),
[`docs/04-data-model.md`](../../docs/04-data-model.md), «Счётчики на сервере»). Сервер ничего
не вычисляет на лету: nginx пишет запросы каталога в отдельный журнал без адресов, а раз в
сутки таймер сворачивает законченные дни в `stats.csv` и удаляет строки старше семи дней.

## nginx (репозиторий сайта)

Строки живут в репозитории сайта — `deploy/uzory/nginx.sh` в
[`Nefeste/gornitsagames`](https://github.com/Nefeste/gornitsagames) (команда `uzory-nginx` на сервере):

```nginx
# /etc/nginx/conf.d/uzory-stats.conf — формат живёт только на уровне http
log_format uzory_stats '$time_iso8601 "$request_uri" $status';

location = /uzory/v1/catalog.json {
    alias /srv/gornitsa/uzory/v1/catalog.json;
    access_log /var/log/uzory/catalog.log uzory_stats;   # без $remote_addr
    add_header Cache-Control "no-cache" always;
}
```

Журнал — не в `/var/log/nginx`: ту папку ротирует logrotate, а строки старше семи дней удаляет
сама свёртка. Остальные строки `/uzory/v1/` — [`docs/specs/2026-09-packs.md`](../../docs/specs/2026-09-packs.md),
«Протокол».

## Таймер

Время журнала и «сегодня» у свёртки — московские: сервер студии живёт по Москве.

Таймер ставит сайт (`deploy/uzory/setup.sh` в `Nefeste/gornitsagames`): `uzory-stats.timer` раз в сутки,
в 00:20 по Москве (`Persistent=true`), запускает `uzory-stats` (`deploy/uzory/stats.sh`):

```bash
bun /srv/gornitsa/uzory/stats/fold.ts --log /var/log/uzory/catalog.log --csv /srv/gornitsa/uzory/stats/stats.csv
nginx -s reopen   # журнал переписан — nginx открывает файл заново
```

`bun` — тот же, что у «Нард» (`/opt/bun/<версия>/bun`). Сам `fold.ts` приходит в ветке `packs`:
её кладёт `content.yml`, а `uzory-packs` на сервере копирует скрипт в `/srv/gornitsa/uzory/stats/`
(В9, [`docs/05-process.md`](../../docs/05-process.md), «Выкладывание наборов»). Пропущенный день не
теряется: сырые строки живут семь дней, и следующий запуск свернёт всё законченное, чего ещё нет в
таблице. Журнал на сервере: `journalctl -u uzory-stats -n 20`.

## Проверка

```bash
bun server/stats/fold.ts --log образец.log --csv /tmp/stats.csv --today 2026-10-12
```

Тесты — `tools/test/counters.test.ts`: только полные строки со счётчиками и кодом 200/304,
только известные корзины (чужая строка запроса не пронесёт в таблицу ни текста, ни адреса),
законченные дни один раз, строки старше семи дней удаляются.
