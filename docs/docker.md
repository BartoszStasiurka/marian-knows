# MarianKnows w Dockerze

Serwer MCP po HTTP w jednym kontenerze. Baza wiedzy to osobne repo gita, które `marian-knows index` sam klonuje i aktualizuje. Adres repo jest w `marian-knows.yml`, więc `compose.yml` kopiujesz bez zmian.

**Zasada utrzymania: restart = aktualizacja.** Przy każdym starcie kontener:

1. pobiera najnowszą wersję repo wiedzy (pierwszy raz: klonuje),
2. aktualizuje indeks (tylko zmienione pliki),
3. uruchamia serwer MCP na porcie 3000.

Kod aktualizuje się przez pobranie nowego obrazu, który GitHub Actions buduje po każdym zielonym pushu na `main`.

## Wymagania

- serwer z Dockerem i pluginem `docker compose` (Linux, amd64),
- dostęp do panelu repo wiedzy (Gitea, GitLab itp.), żeby dodać deploy key (przy publicznym repo przez https niepotrzebny),
- domena i reverse proxy, jeśli serwer ma być dostępny z internetu.

## Instalacja (jednorazowo)

### 1. Katalog

```bash
sudo -i
mkdir -p /srv/marian-knows/data
cd /srv/marian-knows
```

Całą instalację rób jako root (`sudo -i`): pliki w `data/` mogą należeć do kogokolwiek, bo kontener przy starcie sam ustawia im właściciela. Cały stan siedzi w `/srv/marian-knows`. Kontener można w każdej chwili usunąć i postawić od nowa.

### 2. `compose.yml`

Skopiuj [`docker/compose.example.yml`](../docker/compose.example.yml) jako `/srv/marian-knows/compose.yml`. Nic w nim nie zmieniasz.

`TZ` ustawia strefę czasu w `docker compose logs`. Logi zapytań zawsze mają czas w UTC.

### 3. Konfiguracja bazy

`data/marian-knows.yml`:

```yaml
name: Baza wiedzy zespołu
description: >
  Procedury operacyjne i dokumentacja serwerów, po polsku.
  Sprawdź tutaj przed odpowiedzią o deployu, backupach i dostępach.
path: ./knowledge
git:
  url: git@git.firma.pl:zespol/wiedza.git
  deployKey: ./deploy_key
```

- `path`: katalog, do którego trafia klon repo wiedzy (tu `data/knowledge`). Można go oglądać na hoście jak zwykłe repo.
- `git.url`: adres repo wiedzy. Opcjonalnie `git.branch` (domyślnie `main`) i `git.path`, jeśli dokumentacja leży w podkatalogu repo, np. `path: docs`. Wtedy pobierany jest tylko ten katalog.
- `git.deployKey`: plik z kluczem do repo. Nie twórz go ręcznie, kontener wygeneruje go przy pierwszym starcie (krok 5). Przy publicznym repo przez https usuń tę linię.
- `description` czyta agent AI i na tej podstawie decyduje, czy w ogóle zajrzeć do bazy. Napisz, co w niej jest i kiedy jej używać.
- Jeśli repo wiedzy ma pliki, których nie chcesz indeksować, dodaj `exclude` (globy, np. `"**/draft/**"`).

Uprawnień nie musisz ustawiać. Przy każdym starcie kontener poprawia właściciela plików w `data/`, a potem działa jako zwykły użytkownik `node` (UID 1000).

### 4. Logowanie do GHCR (tylko jeśli obraz jest prywatny)

```bash
docker login ghcr.io -u <login-github>
```

Jako hasło podaj token GitHuba typu **classic**: *Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)*, zaznacz tylko `read:packages`. Tokeny fine-grained nie mają tego uprawnienia i GHCR ich nie przyjmuje. Przy publicznym obrazie ten krok pomijasz.

### 5. Start i deploy key

```bash
docker compose up -d
docker compose logs
```

Za pierwszym razem kontener tworzy `data/deploy_key` i zatrzymuje się z kluczem publicznym w logu:

```
[start] syncing index
error: created the deploy key /data/deploy_key
ssh-ed25519 AAAAC3Nza… marian-knows
add this key to the repository as a read-only deploy key, then run index again
```

Linię `ssh-ed25519 …` dodaj w ustawieniach repo wiedzy jako **deploy key, tylko do odczytu** (Gitea: *Settings → Deploy Keys*, GitLab: *Settings → Repository → Deploy keys*). Ten klucz otwiera tylko to jedno repo i nie pozwala w nim nic zmienić. Klucz publiczny jest też w `data/deploy_key.pub`.

Do czasu dodania klucza kontener restartuje się w kółko. To nic nie psuje. Po dodaniu:

```bash
docker compose restart
docker compose logs -f
```

Poprawny start wygląda tak:

```
[start] syncing index
git: cloning git@git.firma.pl:zespol/wiedza.git (main)
git: git@git.firma.pl:zespol/wiedza.git (main) at 92be13a 2026-10-07T16:32:17+02:00
Files: 412
+ 412 added, ~ 0 changed, - 0 removed (1.8 s)
[start] serving MCP on port 3000
MCP over HTTP: http://0.0.0.0:3000/mcp
```

Przy pierwszym połączeniu kontener zapamiętuje odcisk serwera gita w `data/deploy_key.known_hosts`. Jeśli serwer gita później zmieni klucz, kontener odmówi pobrania (patrz [Awarie](#awarie)).

Ostrzeżenie `no tokens` na tym etapie jest normalne, tokeny dodajesz w następnym kroku.

### 6. Tokeny dla ludzi

```bash
docker compose exec marian-knows marian-knows token add anna
```

Token wyświetla się **tylko raz**. Przekaż go Annie bezpiecznym kanałem. Serwer przyjmuje nowy token od razu, bez restartu.

### 7. HTTPS

Port 3000 słucha tylko na `127.0.0.1`, więc z zewnątrz trzeba wejść przez reverse proxy. Przykład dla Caddy (sam załatwia certyfikat):

```
kb.firma.pl {
    reverse_proxy 127.0.0.1:3000
}
```

W nginx: `location /mcp { proxy_pass http://127.0.0.1:3000; }` plus certyfikat jak dla każdej innej strony.

W zamkniętej sieci firmowej, bez proxy, zmień w `compose.yml` mapowanie portu na `"3000:3000"`.

### 8. Podłączenie agenta

Każda osoba u siebie:

```bash
claude mcp add --transport http kb https://kb.firma.pl/mcp --header "Authorization: Bearer mk_…"
```

## Bez gita

Jeśli dokumentacja trafia na serwer inną drogą (rsync, inny proces), pomiń blok `git` i krok z kluczem.

Katalog z dokumentacją montujesz tylko do odczytu. W `compose.yml` dochodzi jedna linia:

```yaml
    volumes:
      - ./data:/data
      - /srv/docs:/knowledge:ro
```

a w `data/marian-knows.yml` piszesz `path: /knowledge`. Indeks leży w `data/.marian-knows/`, więc montaż może być read-only.

Prościej: wrzuć pliki do `data/knowledge` i ustaw `path: ./knowledge`, wtedy `compose.yml` zostaje bez zmian. W obu wariantach zmiana dokumentacji wymaga `docker compose restart`.

## Utrzymanie

| Co się zmieniło   | Co robisz                                                  |
|-------------------|------------------------------------------------------------|
| Wiedza (push do repo wiedzy) | `docker compose restart`                        |
| Kod (push na `main` w marian-knows) | `docker compose pull && docker compose up -d` (aktualizuje też wiedzę) |
| `marian-knows.yml` | `docker compose restart`                                  |
| `compose.yml`     | `docker compose up -d`                                     |

Restart trwa kilka sekund. W tym czasie agenci dostają błąd połączenia, a po restarcie po prostu łączą się od nowa.

### Wersje i rollback

Tag `main` zawsze wskazuje ostatni obraz, który przeszedł testy. Każdy build ma też tag `sha-<commit>`, np. `sha-24f5cf1`. Jeśli nowa wersja coś zepsuła:

1. sprawdź listę wersji na stronie pakietu na GitHubie (*Packages → marian-knows*),
2. w `compose.yml` zmień `:main` na `:sha-<poprzedni commit>`,
3. uruchom `docker compose up -d`.

Gdy poprawka trafi na `main`, wróć do `:main`.

### Tokeny

```bash
docker compose exec marian-knows marian-knows token list            # names, dates, last use
docker compose exec marian-knows marian-knows token revoke anna     # rejected from the next request on
```

### Logi

```bash
docker compose logs --tail 50                                       # start, warnings
docker compose exec marian-knows marian-knows log                   # who asked what
docker compose exec marian-knows marian-knows log --zero            # queries with no results = knowledge gaps
docker compose exec marian-knows marian-knows status                # file count, index age
```

Logi zapytań leżą w `data/.marian-knows/` i są kasowane po 90 dniach.

### Kopia zapasowa

Kopii wymaga tylko to, czego nie da się odtworzyć:

- `data/marian-knows.tokens.json`: bez niego wszyscy potrzebują nowych tokenów,
- `data/marian-knows.yml`, `compose.yml`, `data/deploy_key`: małe pliki, łatwo je odtworzyć, ale kopia oszczędza czas.

Indeks i klon wiedzy odbudowują się same przy starcie.

### Przeprowadzka na inny serwer

```bash
# old server
docker compose down
sudo tar czf marian-knows.tgz -C /srv marian-knows
# new server
sudo tar xzf marian-knows.tgz -C /srv
cd /srv/marian-knows && docker compose up -d
```

Tokeny, klucz i konfiguracja przenoszą się razem z katalogiem. Na nowym serwerze zostaje tylko ustawić reverse proxy (krok 7).

### Migracja ze starej konfiguracji (`KNOWLEDGE_REPO`)

Wcześniejsze wersje brały repo wiedzy z `KNOWLEDGE_REPO` i `KNOWLEDGE_BRANCH` w `compose.yml`. Nowy obraz ignoruje te zmienne i ostrzega o tym w logu.

1. W `data/marian-knows.yml` zamień `path: knowledge` na:
   ```yaml
   path: ./knowledge
   git:
     url: <dawne KNOWLEDGE_REPO>
     branch: <dawne KNOWLEDGE_BRANCH, jeśli inne niż main>
     deployKey: ./deploy_key
   ```
2. Usuń `KNOWLEDGE_REPO` i `KNOWLEDGE_BRANCH` z `compose.yml`.
3. `docker compose pull && docker compose up -d`.

Istniejący klon w `data/knowledge` zostaje użyty bez pobierania od nowa, bo jego origin pasuje do `git.url`. Odcisk serwera gita zapisuje się teraz w `data/deploy_key.known_hosts`, więc stary `data/known_hosts` możesz usunąć.

## Awarie

| Objaw w `docker compose logs` | Przyczyna i rozwiązanie |
|---|---|
| `! warning: fetch failed, indexing the previous content: …` | Serwer gita nie odpowiada albo klucz został usunięty z repo. Serwer działa dalej na poprzedniej wersji wiedzy. Napraw dostęp i zrób `docker compose restart`. |
| `… the git host key has changed; if expected, delete /data/deploy_key.known_hosts` | Serwer gita ma nowy klucz hosta. Kontener działa dalej na poprzedniej wersji wiedzy. Upewnij się u administratora serwera gita, że to zamierzona zmiana (np. przeprowadzka), potem `rm data/deploy_key.known_hosts && docker compose restart`. Bez tego potwierdzenia nie usuwaj pliku: to jedyna ochrona przed podstawionym serwerem. |
| `error: created the deploy key …` (kontener się restartuje w pętli) | Normalne przy pierwszym starcie: dodaj wypisany klucz w repo wiedzy (krok 5) i zrób `docker compose restart`. |
| `error: cannot clone …` (kontener się restartuje w pętli) | Pierwszy klon się nie udał: zły `git.url`, brak deploy keya w repo albo zła `git.branch`. Popraw `data/marian-knows.yml` i zrób `docker compose restart`. |
| `Permission denied (publickey)` | Deploy key nie jest dodany do repo wiedzy albo `data/deploy_key` nie pasuje do dodanego klucza. Komunikat powtarza klucz, który trzeba dodać. |
| `error: … is a clone of …, config says …` | `git.url` w konfiguracji nie pasuje do repo w `data/knowledge`. Jeśli adres zmieniłeś celowo: `rm -rf data/knowledge && docker compose restart`. |
| `error: path exists and is not a git repository` | W katalogu z `path` leżą pliki, ale to nie jest klon. Kontener niczego tam nie nadpisze: usuń katalog albo zmień `path`. |
| `! warning: local changes in …` / `cannot fast-forward …` | Ktoś zmienił pliki w `data/knowledge` albo historia repo została przepisana (force push). Serwer działa na tym, co leży na dysku. W kontenerze najprościej: `rm -rf data/knowledge && docker compose restart`. |
| `! warning: KNOWLEDGE_REPO is ignored` | Stara konfiguracja, patrz [Migracja](#migracja-ze-starej-konfiguracji-knowledge_repo). |
| `error: missing config /data/marian-knows.yml` | Brak `data/marian-knows.yml` (krok 3). |
| Agent dostaje 401 | Brak tokena, literówka albo token unieważniony. Sprawdź `token list` i `data/.marian-knows/*/logs/access-*.jsonl`. |

Brakujące repo wiedzy przy pierwszym starcie zatrzymuje kontener. Gdy klon już istnieje, każdy problem z gitem kończy się ostrzeżeniem, a serwer działa na ostatniej znanej wersji: nieaktualna baza jest lepsza niż żadna.
