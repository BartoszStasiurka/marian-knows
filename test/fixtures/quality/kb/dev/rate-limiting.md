---
title: Limity zapytań API
tags: [dev, api]
---
# Limity zapytań API

Publiczne API ogranicza liczbę zapytań, żeby jeden klient nie zablokował usługi innym.

## Domyślne limity

- Użytkownik zalogowany: 600 zapytań na minutę.
- Klucz API integracji: 1200 zapytań na minutę.
- Endpoint logowania: 10 prób na minutę z jednego adresu IP.

Liczniki trzymamy w Redisie w algorytmie przesuwanego okna.

## Odpowiedź po przekroczeniu

Po przekroczeniu limitu API zwraca status 429 Too Many Requests z nagłówkiem `Retry-After` (sekundy do końca okna). Każda odpowiedź zawiera nagłówki `X-RateLimit-Limit` i `X-RateLimit-Remaining`, żeby klient mógł zwolnić wcześniej.

## Podniesienie limitu

Klient, który potrzebuje więcej, zgłasza się do opiekuna konta. Limit podnosimy per klucz API w panelu administracyjnym; nie zmieniamy globalnej konfiguracji dla jednego klienta.
