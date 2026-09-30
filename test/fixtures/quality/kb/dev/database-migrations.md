---
title: Migracje bazy danych
tags: [dev, postgres]
---
# Migracje bazy danych

Schemat bazy zmieniamy wyłącznie migracjami w repozytorium. Migracje uruchamia job w CI przed deployem nowej wersji aplikacji.

## Tworzenie migracji

```bash
npm run db:migration:create -- add-invoice-number
```

Plik migracji ma funkcje `up` i `down`. Migracja `down` jest obowiązkowa, nawet jeśli w praktyce jej nie używamy — wymusza przemyślenie zmiany.

## Migracje bez przestojów

Stara wersja aplikacji działa jeszcze przez kilka minut po migracji, więc migracja musi być zgodna wstecz:

- Nowa kolumna: najpierw dodaj ją jako nullable, wypełnij danymi w osobnym kroku, dopiero potem ustaw `NOT NULL`.
- Zmiana nazwy kolumny: dodaj nową, zapisuj do obu, przenieś odczyty, usuń starą w kolejnym wydaniu.
- Indeks na dużej tabeli: `CREATE INDEX CONCURRENTLY`, w osobnej migracji bez transakcji.

## Przed dużą migracją

Zrób ręczny backup bazy i uzgodnij termin na kanale #ops. Migracje blokujące tabelę na dłużej niż kilka sekund puszczamy poza godzinami szczytu.
