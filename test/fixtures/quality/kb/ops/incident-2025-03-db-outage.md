---
title: "Postmortem: niedostępność bazy 2025-03-12"
tags: [ops, incident, postgres]
---
# Postmortem: niedostępność bazy 2025-03-12

## Podsumowanie

12 marca 2025 między 14:05 a 14:52 aplikacja zwracała błędy 500, bo produkcyjna baza PostgreSQL przestała przyjmować zapisy. Przyczyną był zapełniony dysk (disk full) na `db-1`.

## Przebieg

- 14:05 — alert `HighErrorRate`, osoba na dyżurze zaczyna diagnozę.
- 14:12 — w logach Postgresa `could not extend file: No space left on device`.
- 14:20 — okazuje się, że katalog WAL urósł do 180 GB, bo slot replikacji po wyłączonej replice analitycznej wstrzymywał usuwanie plików WAL.
- 14:41 — usunięcie nieużywanego slotu replikacji, Postgres zwalnia miejsce.
- 14:52 — zapisy działają, błędy ustępują.

## Przyczyna źródłowa

Replika analityczna została wyłączona w lutym, ale nikt nie usunął jej slotu replikacji. Nie mieliśmy alertu na zajętość dysku powyżej 80% na serwerze bazy.

## Działania naprawcze

- Dodać alert `DiskAlmostFull` przy 80% zajętości (zrobione).
- Dodać alert na nieaktywne sloty replikacji (zrobione).
- Dopisać do procedury wyłączania replik usunięcie slotu.
