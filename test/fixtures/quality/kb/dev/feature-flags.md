---
title: Feature flagi
tags: [dev]
---
# Feature flagi

Feature flagi pozwalają wdrożyć kod, zanim funkcja zostanie włączona dla użytkowników, i szybko ją wyłączyć bez deployu.

## Dodanie flagi

Flagi definiujemy w pliku `config/flags.ts` z opisem, właścicielem i datą planowanego usunięcia. Wartości ustawiamy w panelu administracyjnym per środowisko, a w razie potrzeby także per klient.

## Wyłączenie funkcji na produkcji

Jeśli nowa funkcja psuje produkcję, wyłącz jej flagę w panelu administracyjnym — zmiana działa w ciągu 30 sekund, bez rollbacku. Potem zgłoś problem na kanale #dev i dopiero wtedy szukaj przyczyny.

## Sprzątanie

Flaga żyje najwyżej trzy miesiące po pełnym włączeniu. Martwe flagi komplikują kod i testy, więc przegląd flag jest stałym punktem planowania kwartalnego.
