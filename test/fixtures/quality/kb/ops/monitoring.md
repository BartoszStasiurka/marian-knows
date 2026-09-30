---
title: Monitoring i alerty
tags: [ops, monitoring]
---
# Monitoring i alerty

Metryki zbiera Prometheus, dashboardy są w Grafanie, a alerty trafiają przez Alertmanagera na Slacka i do PagerDuty.

## Prometheus

Prometheus działa na `mon-1` i scrapuje node exporter na każdym serwerze, postgres exporter na `db-1`, blackbox exporter dla publicznych endpointów oraz metryki aplikacji z `/metrics`. Retencja danych to 30 dni.

## Dashboardy w Grafanie

Grafana jest pod adresem `grafana.kompas.dev`, logowanie przez Google. Najważniejsze dashboardy: „Overview" (ruch, błędy, opóźnienia), „Postgres" (połączenia, replikacja, rozmiar bazy) i „Nodes" (CPU, pamięć, dysk).

## Reguły alertów

Reguły są w repozytorium `infra` w katalogu `prometheus/rules/`. Każdy alert musi mieć etykietę `severity` (`page` albo `ticket`) i adnotację z linkiem do runbooka. Alerty `page` budzą osobę na dyżurze przez PagerDuty, alerty `ticket` trafiają tylko na kanał #alerts.

## Dyżur

Dyżur zmienia się co tydzień w poniedziałek o 10:00. Grafik jest w PagerDuty. Osoba na dyżurze ma reagować na alert `page` w ciągu 15 minut.
