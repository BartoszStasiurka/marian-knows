---
title: Test odtwarzania kopii zapasowej
tags: [ops, backup]
---
# Test odtwarzania kopii zapasowej

Backup, którego nikt nie odtworzył, nie jest backupem. Raz na kwartał robimy test odtwarzania na osobnym serwerze.

## Kiedy i kto

Test robi osoba z dyżuru ops w pierwszym tygodniu kwartału. Termin wpisujemy do kalendarza zespołu, a wynik do tabeli w tym dokumencie. Test trwa zwykle około dwóch godzin.

## Procedura

1. Postaw czystą maszynę `restore-test` z obrazu `postgres-16`.
2. Pobierz najnowszą kopię dzienną z bucketu S3 i odtwórz ją przez `pg_restore`.
3. Uruchom zapytania kontrolne z `/opt/backup/checks.sql` — liczba użytkowników, ostatnie zamówienie, rozmiar tabel.
4. Zmierz czas odtworzenia od pobrania pliku do działającej bazy i zapisz go jako RTO.
5. Usuń maszynę po teście.

## Wyniki

| Kwartał | Czas odtworzenia | Uwagi |
| ------- | ---------------- | ----- |
| 2024 Q4 | 41 min | bez problemów |
| 2025 Q1 | 58 min | wolny transfer z S3, rozważyć kopię w tym samym regionie |
