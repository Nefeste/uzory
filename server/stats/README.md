# Счётчики на сервере

Свёртка журнала каталога в суммы — [`fold.ts`](fold.ts) (ADR [0012](../../docs/adr/0012-stats-from-manifest.md),
[`docs/04-data-model.md`](../../docs/04-data-model.md), «Счётчики на сервере»). Сервер ничего
не вычисляет на лету: nginx пишет запросы каталога в отдельный журнал без адресов, а раз в
сутки таймер сворачивает законченные дни в `stats.csv` и удаляет строки старше семи дней.

## nginx (репозиторий сайта)

```nginx
log_format uzory_stats '$time_iso8601 "$request_uri" $status';

location = /uzory/v1/catalog.json {
    root /srv/gornitsa;
    access_log /var/log/nginx/uzory-catalog.log uzory_stats;   # без $remote_addr
    add_header Cache-Control "no-cache" always;
}
```

Остальные строки `/uzory/v1/` — [`docs/specs/2026-09-packs.md`](../../docs/specs/2026-09-packs.md), «Протокол».

## Таймер

Время журнала и «сегодня» у свёртки — московские: сервер студии живёт по Москве.

```ini
# /etc/systemd/system/uzory-stats.service
[Unit]
Description=Узоры: свёртка журнала каталога в суммы

[Service]
Type=oneshot
ExecStart=/usr/local/bin/bun /srv/gornitsa/uzory/stats/fold.ts --log /var/log/nginx/uzory-catalog.log --csv /srv/gornitsa/uzory/stats/stats.csv
# журнал переписан — nginx открывает файл заново
ExecStartPost=/usr/sbin/nginx -s reopen

# /etc/systemd/system/uzory-stats.timer
[Unit]
Description=Узоры: свёртка журнала раз в сутки

[Timer]
OnCalendar=*-*-* 00:20:00 Europe/Moscow
Persistent=true

[Install]
WantedBy=timers.target
```

`systemctl enable --now uzory-stats.timer`. Пропущенный день не теряется: сырые строки
живут семь дней, и следующий запуск свернёт всё законченное, чего ещё нет в таблице.

## Проверка

```bash
bun server/stats/fold.ts --log образец.log --csv /tmp/stats.csv --today 2026-10-12
```

Тесты — `tools/test/counters.test.ts`: только полные строки со счётчиками и кодом 200/304,
только известные корзины (чужая строка запроса не пронесёт в таблицу ни текста, ни адреса),
законченные дни один раз, строки старше семи дней удаляются.
