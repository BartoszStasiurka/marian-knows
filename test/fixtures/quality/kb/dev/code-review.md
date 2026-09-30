---
title: Zasady code review
tags: [dev, review]
---
# Zasady code review

Code review ma wyłapać błędy i szerzyć wiedzę o kodzie, a nie sprawdzać, kto ma rację w sprawie stylu.

## Czas odpowiedzi

Na prośbę o review odpowiadamy w ciągu jednego dnia roboczego. Jeśli nie dasz rady, napisz to w PR i wskaż kogoś innego. Blokujący PR na trzy dni to problem całego zespołu.

## Na co patrzymy

- Poprawność: czy kod robi to, co opisuje ticket, i co się dzieje w przypadkach brzegowych.
- Testy: czy zmiana jest pokryta testami i czy testy sprawdzają zachowanie, a nie implementację.
- Czytelność: czy za pół roku ktoś zrozumie ten kod bez autora.
- Bezpieczeństwo: dane wejściowe od użytkownika, uprawnienia, sekrety w kodzie.

Styl i formatowanie sprawdza linter w CI — nie komentujemy ich ręcznie.

## Jak pisać komentarze

Komentarz dotyczy kodu, nie osoby. Oznaczaj wagę: `nit:` dla drobiazgów, które autor może pominąć, `blocker:` dla rzeczy, bez których nie zatwierdzisz. Zamiast „to jest źle" napisz, co może pójść nie tak i zaproponuj alternatywę.
