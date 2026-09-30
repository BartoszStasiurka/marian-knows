---
title: Backup bazy PostgreSQL
tags: [ops, postgres, backup]
---
# Backup bazy PostgreSQL

Produkcyjna baza danych jest kopiowana każdej nocy. Ta strona opisuje, jak działa backup, gdzie leżą kopie i jak odtworzyć bazę z kopii zapasowej.

## Jak działa nocny backup

O 2:30 w nocy cron na serwerze `db-1` uruchamia skrypt `/opt/backup/pg-backup.sh`. Skrypt wykonuje `pg_dump` w formacie custom (`-Fc`), kompresuje wynik i wysyła go do bucketu S3 `kompas-backups` w regionie eu-central-1. Po wysłaniu skrypt sprawdza sumę kontrolną i zapisuje wynik do logu `/var/log/pg-backup.log`.

Jeśli backup się nie powiedzie, Prometheus zgłasza alert `PgBackupMissing` na kanał #alerts po 26 godzinach bez udanej kopii.

## Retencja kopii

Przechowujemy kopie dzienne przez 14 dni, tygodniowe (z niedzieli) przez 8 tygodni i miesięczne przez 12 miesięcy. Rotacją zajmuje się polityka lifecycle w S3, a nie skrypt — nie usuwaj kopii ręcznie. Kopie są szyfrowane kluczem KMS, do którego dostęp ma tylko rola `backup-admin`.

## Ręczny backup przed ryzykowną zmianą

Przed dużą migracją zrób kopię ręcznie:

```bash
sudo -u postgres pg_dump -Fc kompas > /tmp/kompas-$(date +%F).dump
aws s3 cp /tmp/kompas-$(date +%F).dump s3://kompas-backups/manual/
```

## Odtwarzanie bazy z kopii

Pobierz odpowiedni plik z S3 i użyj `pg_restore`:

```bash
aws s3 cp s3://kompas-backups/daily/kompas-2025-03-01.dump .
pg_restore --clean --if-exists -d kompas kompas-2025-03-01.dump
```

Odtwarzanie produkcji zawsze uzgadniamy na kanale #ops. Pełną procedurę testowego odtwarzania opisuje strona o teście odtwarzania.
