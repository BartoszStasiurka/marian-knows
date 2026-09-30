---
title: Dostęp SSH do serwerów
tags: [ops, ssh, security]
---
# Dostęp SSH do serwerów

Do serwerów łączymy się wyłącznie przez bastion `bastion.kompas.dev`. Logowanie hasłem jest wyłączone, działają tylko klucze.

## Wygenerowanie klucza

Używamy kluczy ed25519 z hasłem:

```bash
ssh-keygen -t ed25519 -C "imie.nazwisko@kompas.dev"
```

Klucz publiczny (`~/.ssh/id_ed25519.pub`) dodaj przez pull request do repozytorium `infra`, plik `ssh/authorized_keys/<login>.pub`. Po merge'u Ansible rozsyła klucze na serwery w ciągu kilku minut.

## Konfiguracja klienta

Dopisz do `~/.ssh/config`:

```
Host bastion
    HostName bastion.kompas.dev
    User imie.nazwisko

Host *.internal
    ProxyJump bastion
    User imie.nazwisko
```

Wtedy `ssh db-1.internal` połączy się przez bastion automatycznie.

## Odebranie dostępu

Przy odejściu z firmy klucz usuwa się tym samym pull requestem co konto w Google Workspace. Odpowiada za to osoba prowadząca offboarding.
