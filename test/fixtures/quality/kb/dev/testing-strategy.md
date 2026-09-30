---
title: Strategia testów
tags: [dev, testing]
---
# Strategia testów

Piszemy dużo szybkich testów jednostkowych, trochę testów integracyjnych i kilka testów end-to-end dla kluczowych ścieżek.

## Testy jednostkowe

Testują czystą logikę bez bazy i sieci. Uruchamiają się przy każdym zapisie pliku (`npm run test:watch`) i muszą trwać sekundy, nie minuty.

## Testy integracyjne

Sprawdzają współpracę z prawdziwą bazą PostgreSQL uruchomioną w kontenerze. Każdy test działa w transakcji wycofywanej na końcu, więc testy nie widzą swoich danych nawzajem. Nie mockujemy bazy danych — mock nie złapie błędu w zapytaniu SQL.

## Testy end-to-end

Playwright przechodzi przez logowanie, złożenie zamówienia i wystawienie faktury na środowisku staging po każdym deployu. Test e2e, który losowo nie przechodzi, naprawiamy albo usuwamy w ciągu tygodnia; niestabilne testy uczą ignorowania czerwonego CI.

## Pokrycie kodu

Nie mamy progu pokrycia. Raport pokrycia pomaga znaleźć nieprzetestowane moduły, ale sam procent niczego nie gwarantuje.
