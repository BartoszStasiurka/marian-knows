# MarianKnows: wymagania (v1, wersja robocza)

## 1. Cel

Baza wiedzy z plików `.md`, przeszukiwalna pełnotekstowo z linii poleceń. Pliki `.md` są źródłem prawdy, a indeks SQLite to odtwarzalna pochodna.

Zastosowanie docelowe: karmienie asystenta AI, który pomaga klientowi. Ta sama baza może być też bazą wiedzy formową lub tematyczną. Przewidywana skala: dziesiątki plików, więc wydajność nie jest kryterium projektowym.

## 2. Zakres

- **W v1:** CLI `marian-knows` (Node.js 20+, ESM, TypeScript); indeks SQLite + FTS5 (`better-sqlite3`) na poziomie sekcji; wyszukiwanie (także w poddrzewie ścieżek), listowanie, odczyt plików; konfiguracja YAML (`yaml` + `zod`); skan katalogów (`fast-glob`).
- **W v2:** serwer MCP tylko do odczytu (stdio i HTTP), log zapytań, odczyt sekcji, tokeny dostępu; szczegóły w sekcji 9.
- **Poza v1 i v2:** `--watch`, wyszukiwanie semantyczne, synonimy i aliasy, wyjątki fleksyjne i indeks trigramowy, widoczność treści (public/internal), edycja plików, UI.

## 3. Konfiguracja: `marian-knows.yml`

Konfiguracja opisuje jeden projekt i jeden katalog źródłowy.

```yaml
name: Baza wiedzy klienta
description: Procedury obsługi klienta i FAQ produktu, po polsku. Sprawdzaj tu przed odpowiedzią o zamówienia.
path: ./docs
exclude:
  - "**/draft/**"
```

| Pole      | Opis                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| `name`    | wymagany identyfikator projektu                                                           |
| `description` | opis dla agenta: co jest w bazie i kiedy jej używać; opcjonalny                       |
| `path`    | katalog źródłowy; względny do katalogu z `marian-knows.yml` albo absolutny; opcjonalny     |
| `exclude` | string lub lista globów względnych do `path`; opcjonalne                                  |
| `git`     | repo gita, z którego `index` klonuje i aktualizuje `path`; opcjonalne                      |

**`name`**
- Po usunięciu białych znaków z brzegów: od 1 do 128 znaków, bez znaków sterujących.
- Metadane: nie wpływa na nazwę ani lokalizację bazy danych. Serwer MCP podaje ją agentowi razem z `description`.

**`description`**
- Pisany dla agenta AI: co zawiera baza, w jakim języku, kiedy ją sprawdzać. Bez niego agent podłączony przez MCP wie tylko, że jakaś baza istnieje, i nie sięga po nią sam.
- Po usunięciu białych znaków z brzegów: od 1 do 2000 znaków; może mieć wiele linii.
- Trafia na początek `instructions` serwera MCP i opisu narzędzia `search` oraz do `status`.

**`path`**
- Brak pola oznacza katalog pliku `marian-knows.yml`. Skanowanie jest zawsze rekurencyjne.
- Istniejące `path` musi wskazywać katalog; plik to błąd konfiguracji.
- Nieistniejący katalog nie jest błędem: `scan` wypisuje ostrzeżenie i nie znajduje plików.
- Błąd dostępu do katalogu (np. brak uprawnień) jest błędem konfiguracji.

**`git`**

```yaml
path: ./wiedza               # kopia robocza: tu klon, stąd indeksujemy
git:
  url: git@git.firma.pl:zespol/wiedza.git
  branch: main               # opcjonalne, domyślnie main
  path: docs                 # opcjonalne: indeksuj tylko ten katalog repo
  deployKey: ./deploy_key    # opcjonalne: ścieżka do pliku z kluczem prywatnym, nigdy sam klucz
```

- `url`: wymagany, dowolny adres, który przyjmuje `git clone` (ssh, https, file). `branch`: niepusty, nie zaczyna się od `-`, domyślnie `main`.
- `git.path`: katalog wewnątrz repo. Wiodący `/` jest pomijany (`/docs` = `docs`), `.` i pusty oznaczają korzeń repo. Segment `..`, `\` i znaki sterujące to błąd konfiguracji.
- `deployKey`: względny do katalogu z `marian-knows.yml` albo absolutny.
- Z `git` pole `path` jest **wymagane**: klon w katalogu konfiguracji wymieszałby repo z konfiguracją, tokenami i `.marian-knows/`. `path` dalej jest stringiem i oznacza kopię roboczą; nieistniejący katalog to normalny stan przed pierwszym klonem.
- Katalog indeksowany to `path` + `git.path`; ścieżki wirtualne liczą się od niego (`git.path: docs` i plik `docs/api/x.md` dają `/api/x.md`).
- Kopia robocza to zwykłe repo, można w nim pracować bez MarianKnows. Wczytanie konfiguracji nie uruchamia gita; robi to tylko `index` (sekcja 4).
- Usunięcie bloku `git` zostawia działającą konfigurację na lokalnym katalogu.

**Walidacja:** nieznane pola są błędem; stare pole `sources` jest odrzucane z osobnym komunikatem. Walidacja zbiera wszystkie błędy naraz, kod wyjścia 2.

**Zasady skanowania**
- Indeksowane są tylko `.md`. Zawsze pomijane, niezależnie od `exclude`: ukryte pliki i katalogi (od kropki), `node_modules`.
- Pliki większe niż 1 MB oraz nazwy zawierające `#` lub `?` są pomijane z ostrzeżeniem.
- Ścieżka wirtualna pliku to `/` oraz jego ścieżka względna wobec `path`, z separatorami `/` i normalizacją Unicode NFC. Przykład: `path: ./docs` i plik `docs/api/readme.md` dają `/api/readme.md`.
- W indeksie są wyłącznie **ścieżki wirtualne**; ścieżki dyskowe żyją tylko w YAML-u i w wyjściu diagnostycznym (`scan --disk`), więc baza jest przenośna.
- Kolizja ścieżek różniących się wyłącznie wielkością liter (także w nazwach katalogów, np. `/Notes/x.md` i `/notes/x.md`): wygrywa pierwsza w porządku punktów kodowych, pozostałe są pomijane z ostrzeżeniem.

**Pozostałe**
- Baza leży w katalogu `.marian-knows/<nazwa>/` obok pliku konfiguracyjnego, gdzie `<nazwa>` to nazwa pliku konfiguracji bez rozszerzenia (`marian-knows.yml` → `.marian-knows/marian-knows/index.db`, `-wal`, `-shm`; tam też blokada i logi). Lokalizacji nie da się zmienić. Katalog powstaje przy pierwszym indeksowaniu; jako ukryty nigdy nie jest skanowany. Jeden plik konfiguracji = jedna baza, więc w jednym katalogu może leżeć kilka konfiguracji (np. `publiczna.yml` i `wewnetrzna.yml`) z osobnymi bazami; tak w v1 rozdziela się treści publiczne i wewnętrzne.
- Stara baza `.marian-knows/index.db` (sprzed katalogów per konfiguracja) nie jest czytana: `index` buduje nową i ostrzega, że starą można usunąć. Nic nie jest usuwane automatycznie.
- Wybór konfiguracji: `--config <plik>`, potem `MARIAN_KNOWS_CONFIG`, potem `marian-knows.yml` szukany w górę od bieżącego katalogu. Wyjątek: `init` używa tylko `--config` albo `./marian-knows.yml`.

## 4. Indeks

**Jednostka: sekcja.** Plik jest dzielony po nagłówkach H2 i H3 (H1 to tytuł dokumentu; H4+ zostają w treści sekcji nadrzędnej). Tekst przed pierwszym nagłówkiem to sekcja 0; plik bez nagłówków to jedna sekcja. Nagłówki w blokach kodu są ignorowane. Zbyt krótkie sekcje są łączone z poprzednimi, zbyt długie dzielone po akapitach. Każda sekcja ma kotwicę (slug, unikalny w pliku: `backup`, `backup-1`) i dziedziczy tytuł oraz tagi pliku.

**Szczegóły parsera:**
- Nagłówki: tylko ATX (`## Tytuł`), do 3 spacji wcięcia, spacja po `#` wymagana; nagłówki setext (`===`, `---`) nie są rozpoznawane. Bloki kodu: ```` ``` ```` i `~~~`, zamknięcie tym samym znakiem i co najmniej tą samą długością; niezamknięty blok trwa do końca pliku.
- Pierwszy H1 przed pierwszym H2/H3 nie trafia do treści sekcji 0 (jest tytułem). Pusta sekcja 0 jest pomijana.
- Kotwica w stylu GitHuba: małe litery, interpunkcja usunięta, polskie litery zachowane, każdy biały znak to `-`; pusty slug to `section`. Kotwice liczone są przed łączeniem, więc scalenie sekcji nie przesuwa pozostałych.
- Długość sekcji to długość treści bez nagłówka. Scalona sekcja trafia do poprzedniej razem z linią nagłówka. Pierwsza sekcja pliku nie ma z czym się połączyć i zostaje, nawet krótka.
- Części podzielonej sekcji mają ten sam nagłówek i kotwicę (kotwica to cel linku). Blok kodu i pojedynczy akapit dłuższy niż limit nie są cięte.
- `tags` jako string jest dzielony po przecinkach; elementy listy będące liczbami są zamieniane na tekst, inne pomijane; tagi są przycinane i deduplikowane. `title` i `tags` złego typu są ignorowane z ostrzeżeniem.
- Frontmatter musi zaczynać się w pierwszej linii (`---`) i kończyć `---` albo `...`. Niezamknięty frontmatter jest traktowany jako treść, z ostrzeżeniem.

**Metadane:** tytuł z `title` we frontmatterze, potem pierwszy H1, potem nazwa pliku; tagi z `tags`; cały frontmatter zapisany też jako JSON. Zepsuty frontmatter: plik jest indeksowany bez metadanych, z ostrzeżeniem. Kodowanie UTF-8, obsługa BOM, normalizacja CRLF i NFC.

```sql
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);   -- schema_version, indexed_at
CREATE TABLE docs(
  id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL,   -- ścieżka wirtualna
  title TEXT, tags TEXT, fm TEXT,                      -- fm: frontmatter jako JSON
  mtime INTEGER NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL
);
CREATE TABLE sections(
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL, anchor TEXT, heading TEXT, body TEXT NOT NULL
);
CREATE VIRTUAL TABLE sections_fts USING fts5(         -- rowid = sections.id
  title, heading, tags, body,
  tokenize='unicode61 remove_diacritics 2'            -- treść przechowywana: działa snippet()
);
```

**Synchronizacja inkrementalna** (diff zbioru plików, w jednej transakcji):
1. Skan katalogu źródłowego daje zbiór plików po rozstrzygnięciu kolizji wielkości liter.
2. Porównanie z indeksem: nowe, usunięte, potencjalnie zmienione (inny `mtime` lub `size`).
3. Dla potencjalnie zmienionych liczony jest hash: taki sam = tylko aktualizacja `mtime`, inny = przeindeksowanie wszystkich sekcji pliku.
4. Pliki usunięte lub wykluczone znikają, bo diff opiera się na zbiorze ścieżek.

**Pełna przebudowa:** przy niezgodności `schema_version` (schemat, tokenizer, parser sekcji) albo ręcznie `marian-knows index --full`.

**Źródło z gita.** Gdy konfiguracja ma blok `git`, `index` przed skanem aktualizuje kopię roboczą. Robi to wyłącznie `index`; `scan`, `search`, `status` i `serve` nigdy nie uruchamiają gita. Git jest wywoływany jako program `git` (brak programu: błąd `git not found; install git or remove the git block`), zawsze z `GIT_TERMINAL_PROMPT=0`, więc nigdy nie czeka na hasło. Dane logowania w adresach `http(s)://` są w wyjściu zastępowane `***@`.

- **Brak `path` albo pusty katalog:** `git clone --depth 1 --filter=blob:none --single-branch --branch <branch>`, z `--sparse` i `sparse-checkout set --cone <git.path>`, gdy ustawiono `git.path`. Klon powstaje obok, w `<path>.clone-<pid>`, i jest przemianowywany na `path` dopiero po zakończeniu; pozostałości po przerwanych klonach (`<path>.clone-*`) są usuwane. Nieudany klon to błąd (kod 2), nic nie jest indeksowane i nic nie zostaje na dysku.
- **`path` istnieje:** musi być korzeniem repo (`rev-parse --show-toplevel`, porównane po `realpath`) z `remote.origin.url` równym `git.url` (bez końcowego `/` i `.git`). Inaczej błąd (kod 2): `path exists and is not a git repository: <path>` albo `<path> is a clone of <origin>, config says <url>; remove the directory to re-clone`. MarianKnows nie pisze do katalogu, którego sam nie sklonował.
- Potem aktualizacja: `fetch origin <branch>` i `merge --ff-only FETCH_HEAD`. Nigdy `reset` ani `clean`, bo w kopii roboczej ktoś może pracować. Poniższe sytuacje dają ostrzeżenie, a indeks powstaje z tego, co leży na dysku:

| Sytuacja | Ostrzeżenie |
| --- | --- |
| niezacommitowane zmiany | `local changes in <path>, not updating` |
| inna gałąź albo detached HEAD | `<path> is on <gałąź\|detached HEAD>, config says <branch>; not updating` |
| `fetch` się nie udał (sieć, klucz, serwer) | `fetch failed, indexing the previous content: <komunikat gita>` |
| brak fast-forward (rozjechana historia, force push) | `cannot fast-forward <path>; indexing the local content` |
| `git.path` nie istnieje w repo | `git.path not found in the repository: <git.path>` |

- Klon rzadki (`core.sparseCheckout`) przy każdej aktualizacji dostaje `sparse-checkout set --cone <git.path>`, więc zmiana `git.path` nie wymaga ponownego klonowania. Pełny klon zrobiony ręcznie zostaje pełny.
- Gdy po kroku git katalog indeksowany (`path` + `git.path`) nie istnieje, `index` nie rusza indeksu: ostrzeżenie `not indexing: <katalog> does not exist; the previous index stays`, kod 0. Literówka w `git.path` nie opróżnia działającej bazy.
- Wyjście na stderr: `git: cloning <url> (<branch>)` przy klonie i zawsze na końcu `git: <url> (<branch>) at <krótki sha> <data commita ISO>`.

**Deploy key.** Tylko przy ustawionym `git.deployKey`; bez niego git używa zwykłego środowiska użytkownika (`~/.ssh`, agent, config).
- Brak pliku: `index` generuje klucz (`ssh-keygen -t ed25519`, uprawnienia `600`), wypisuje klucz publiczny z prośbą o dodanie go w repo jako deploy key tylko do odczytu i kończy się kodem 2 bez wołania gita.
- Klucz z uprawnieniami dla grupy lub innych dostaje `chmod 600` (ssh odrzuca takie klucze).
- `GIT_SSH_COMMAND` używa tylko tego klucza (`IdentitiesOnly`), `BatchMode`, `ConnectTimeout=15` i własnego pliku `<deployKey>.known_hosts` z `StrictHostKeyChecking=accept-new`.
- `Permission denied (publickey)`: komunikat powtarza klucz publiczny z `<deployKey>.pub`. Zmieniony klucz hosta: jedna linia `the git host key has changed; if expected, delete <deployKey>.known_hosts` zamiast banera ssh.

**Odporność i współbieżność:** WAL (`search` działa w trakcie `index`), blokada przed równoległymi `index`, nieczytelny plik to ostrzeżenie i kontynuacja. `status` pokazuje wiek indeksu.
- Blokada to plik `index.lock` w katalogu bazy (`.marian-knows/<nazwa>/`) z PID właściciela, zakładany atomowo i usuwany po zakończeniu. Gdy trzyma go żywy proces, `index` kończy się błędem `index is already running (pid N)` (kod 2); blokada po martwym procesie jest przejmowana.
- Plik, którego nie da się odczytać, jest traktowany jak nieobecny: jego poprzednia wersja znika z indeksu. Plik bez zmian `mtime` i `size` nie jest czytany, więc zostaje.
- Błąd w trakcie synchronizacji wycofuje całą transakcję; indeks zostaje w poprzednim stanie.

## 5. Wyszukiwanie

- Ranking `bm25` po sekcjach; wagi: tytuł 10, tagi 5, nagłówek sekcji 5 (do strojenia), treść 1. Wynik CLI jest na poziomie **plików**: pozycję pliku wyznacza jego najlepsza sekcja.
- Snippety z treści sekcji, dopasowania w `[...]`.
- Wiele słów łączonych przez AND (tryb ścisły). **Fallback:** gdy wyników jest mniej niż 3, a zapytanie ma więcej niż jedno znaczące słowo, dołączane są wyniki trybu OR, ścisłe wyżej.
- **Stop-słowa:** stała lista PL/EN w kodzie jest usuwana z zapytania; jeśli zostałyby same stop-słowa, nic nie jest usuwane.
- Polska fleksja prefiksem, bez stemmera: słowa dłuższe niż 4 znaki skracane o 2 ostatnie litery, ale nie krócej niż do 4 znaków, i dopasowywane jako prefiks (`konfiguracja` znajdzie „konfigurację", „konfiguracji"; `biura` → `biur*` znajdzie „biuro"); słowa do 4 znaków dopasowywane jako prefiks bez skracania. Znaki specjalne FTS5 są usuwane. Litery `ł`/`Ł` są sprowadzane do `l`/`L` w kolumnach FTS i w zapytaniu (tokenizer nie usuwa z nich diakrytyku), więc `zolw` znajdzie „żółw”; `docs`, `sections` i snippety zachowują oryginalny tekst.
- `-n <limit>`: domyślnie 10 plików. `--tag <tag>`: pliki z tym tagiem, bez rozróżniania wielkości liter; filtr działa przed fallbackiem i limitem. `--exact` wyłącza skracanie, prefiksy i fallback do OR.
- **Zestaw testowy jakości:** baza fixture (`test/fixtures/quality/kb/`) i plik z zapytaniami i oczekiwanymi trafieniami (`test/fixtures/quality/queries.yml`), mierzący trafność w top 5 (hit@5) i MRR; uruchamiany w `npm test` z progami regresji, służy do strojenia wag, progu fallbacku, stop-słów, skracania słów i rozmiarów sekcji. Szybki raport bez vitest: `npx tsx test/quality.ts`.
- **Zestaw zapytań agentowych** (`test/fixtures/quality/queries-agent.yml`): pełne pytania, synonimy słów ze strony, pytania po polsku o strony angielskie i odwrotnie. Tylko pomiar, bez progów regresji; punkt odniesienia do strojenia pod agentów. Pierwszy pomiar (23 zapytania): hit@5 91,3%, MRR 0,754.

**Zakres ścieżek**
- `--path <prefiks>` (w `search` i `list`): poddrzewo ścieżek wirtualnych na dowolnej głębokości. Prefiks z końcowym `/` obejmuje katalog (`/projekt/A/` nie obejmuje `/projekt/AB/`); bez końcowego `/` oznacza pojedynczy plik.
- `--path` można powtarzać (OR); `--exclude-path` wyklucza poddrzewa lub pliki.
- Filtr działa przed rankingiem i limitem (`-n` dotyczy wyników z zakresu), łączy się z innymi filtrami (`--tag`) przez AND.
- Zakres jest wyłącznie parametrem zapytania (nie ma go w konfiguracji, nie ma `--depth`) i dotyczy ścieżek wirtualnych.
- Składnia ścieżki wirtualnej: zaczyna się od `/`, separator `/`, Unicode NFC; zabronione puste segmenty (`//`), segmenty `.` i `..`, `\`, znaki sterujące, białe znaki na brzegach segmentu; maks. 512 znaków. Niepoprawna ścieżka to błąd (kod 2). Poprawna, ale bez plików w indeksie: brak wyników (kod 1) i ostrzeżenie na stderr (np. `no indexed files under /nope/`).

## 6. Interfejs CLI

```
marian-knows init <project_name>      # tworzy minimalny marian-knows.yml z polem name
marian-knows scan [--json] [--disk]   # pliki z katalogu źródłowego (bez indeksu)
marian-knows parse <file> [--json]    # parsowanie pliku wskazanego ścieżką dyskową
marian-knows index [--full]           # (re)indeksowanie, wcześniej aktualizacja źródła z gita
marian-knows search <query> [opcje]   # pliki wg rankingu
marian-knows list [opcje]             # pliki z indeksu, posortowane po ścieżce
marian-knows get <path>[#anchor]      # zawartość pliku albo jednej sekcji z indeksu (ścieżka wirtualna)
marian-knows status [--json]          # stan projektu: konfiguracja, liczba plików i sekcji, rozmiar, czas i wiek indeksu
marian-knows destroy                  # usuwa indeks i logi tej konfiguracji (.marian-knows/<nazwa>/); konfiguracja zostaje
marian-knows log [opcje]              # przegląd logu zapytań
marian-knows serve [--http [--port <n>] [--host <addr>]] # serwer MCP (domyślnie stdio)
marian-knows token add|list|revoke    # tokeny dostępu do serwera HTTP
marian-knows help                     # pomoc (także --help)
```

Opcja globalna: `--config <plik>` (dla `init`: plik, który ma zostać utworzony).

| Komenda  | Opcje                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| `search` | `-n <limit>`, `--json`, `--snippets`, `--tag <tag>`, `--exact`, `--path <prefiks>`, `--exclude-path <prefiks>` |
| `list`   | `--json`, `--tag <tag>`, `--path <prefiks>`, `--exclude-path <prefiks>`                                        |
| `scan`   | `--json`, `--disk` (dołącza ścieżki dyskowe, wyłącznie diagnostycznie)                                         |
| `get`    | `--max-chars <n>` (limit znaków odpowiedzi, `0` = bez limitu; sekcja 9)                                        |
| `log`    | `--zero`, `--days <n>`, `--json` (sekcja 9)                                                                    |
| `serve`  | `--http`, `--port <n>` (domyślnie 3000, `0` = dowolny wolny), `--host <adres>` (domyślnie `127.0.0.1`) (sekcja 9) |
| `token`  | `list --json` (sekcja 9)                                                                                       |

**`init <project_name>`:** nazwa podlega tym samym zasadom co `name`. Domyślny cel to `./marian-knows.yml`; istniejący plik nigdy nie jest nadpisywany (kod 2). Polecenie nie modyfikuje `.gitignore` i nie tworzy plików bazy danych.

**`parse <file>`:** diagnostyka parsera, nie wymaga konfiguracji. Domyślnie wypisuje tytuł, tagi, frontmatter i listę sekcji z podglądem treści; `--json` wypisuje jeden obiekt `{title, tags, frontmatter, sections}`. Ostrzeżenia idą na stderr; nieczytelny plik to kod 2.

**`get <path>`:** wypisuje plik bez zmian (bajty z dysku, bez normalizacji), z zastrzeżeniem limitu znaków (sekcja 9). Obsługuje wyłącznie pliki obecne w indeksie, więc nie odczyta niczego, czego nie pokazuje `list` (plików wykluczonych, ukrytych, spoza `.md`). Ścieżka z końcowym `/`, ścieżka spoza indeksu i plik usunięty po indeksowaniu to błąd (kod 2).

**`status`:** nazwa i opis (`description`) projektu, ścieżka pliku konfiguracji i katalogu źródłowego (diagnostycznie), `exclude`, stan indeksu (`ok`, `missing`, `outdated`), liczba plików i sekcji, rozmiar bazy (`index.db` z `-wal` i `-shm`), czas i wiek indeksowania. Brak indeksu nie jest błędem (kod 0).

**`destroy`:** usuwa katalog `.marian-knows/<nazwa>/` tej konfiguracji, a `.marian-knows/` tylko wtedy, gdy zostanie pusty; bazy innych konfiguracji zostają. Pliki `.md` i pliki konfiguracji zostają. Odmawia (kod 2), gdy trwa `index`. Brak indeksu to kod 0 i komunikat `No index to remove`.

**Język komunikatów:** wszystkie komunikaty CLI (pomoc, podsumowania, ostrzeżenia `! warning:`, błędy `error:`) są po angielsku.

Domyślne wyjście: jeden plik na linię, ścieżka wirtualna.

```
$ marian-knows search konfiguracja --path /server/
/server/deploy.md

$ marian-knows search backup --snippets
/server/deploy.md
  …codzienny [backup] bazy o 03:00…

$ marian-knows search backup --json -n 1
[{"path":"/server/deploy.md","title":"Deploy","tags":["ops"],"score":-8.41,"anchor":"harmonogram","snippet":"…[backup] bazy…"}]

$ marian-knows index
Files: 42
+ 42 added, ~ 0 changed, - 0 removed (0.4 s)
! warning: skipped /notes/x.md: name differs only by case from /Notes/x.md
```

- **Kontrakt `--json`** (stabilny, korzysta z niego m.in. przyszły MCP): `search` i `list` wypisują gołą tablicę obiektów, po jednym na plik, w kolejności rankingu (`list`: po ścieżce). Bez koperty i `schemaVersion` w v1.
- `search`: `path`, `title`, `tags` (tablica), `score`, `anchor` (najlepsza sekcja pliku), `heading` (jej nagłówek), `snippet` (wypełniony tylko z `--snippets`). `list`: `path`, `title`, `tags`. Pola nie są pomijane: brak wartości to `null` (`tags`: `[]`).
- `status --json`: jeden obiekt `{name, description, config, path, pathExists, exclude, index, files, sections, dbSize, indexedAt, ageSeconds}`; `index` to `ok`, `missing` albo `outdated`, pozostałe pola indeksu są `null`, gdy indeks nie jest `ok`; `description` jest `null`, gdy go nie ustawiono (`dbSize` także przy `outdated`).
- `score` to `bm25` (niższa wartość = lepiej), porównywalny tylko w obrębie jednego zapytania.
- Zmiany dodające pola są zgodne wstecz; usunięcie pola lub zmiana jego znaczenia wymaga podniesienia wersji głównej `marian-knows`.
- W trybie `--json` stdout zawiera wyłącznie JSON, ostrzeżenia i błędy idą na stderr; brak wyników w `search` i `list` to `[]` i kod 1.
- `get` zamienia ścieżkę wirtualną na dyskową względem `path` i może odczytać wyłącznie plik wewnątrz skonfigurowanego katalogu źródłowego, obecny w indeksie.

| Kod | Znaczenie                                                                                |
| --- | ---------------------------------------------------------------------------------------- |
| 0   | OK                                                                                       |
| 1   | brak wyników w `search`, `list` i `log` (jak `grep`)                                     |
| 2   | błąd: brak konfiguracji, zły YAML, błędna konfiguracja lub ścieżka, nieznana kotwica, brak indeksu, zła składnia wywołania (nieznana opcja, nadmiarowy argument), trwający `index`, każdy nieoczekiwany wyjątek |

Przy braku indeksu: `No index. Run: marian-knows index`.

## 7. Architektura

```
marian-knows/
├─ package.json     # bin: { "marian-knows": "dist/cli.js" }, exports: { "./core": ... }
└─ src/
   ├─ core/         # config, scan, init, indexer, search, list, get, log
   └─ cli.ts        # argumenty i formatowanie wyjścia
```

Cała logika (w tym walidacja ścieżek i filtr zakresu) w `core`, CLI jest cienką warstwą. Serwer MCP żyje w tym samym repozytorium jako drugi cienki adapter (`src/mcp.ts`) nad tym samym `core`; zakres ścieżek jest parametrem narzędzia. Log zapytań i tokeny też są w `core`, więc CLI i MCP dzielą jedną implementację.

## 8. Parametry do strojenia

Wartości startowe, bez decyzji z góry; do dostrojenia na zestawie testowym jakości (sekcja 5) po pierwszych realnych danych.

- Sekcje: łączenie z poprzednią, gdy krótsza niż 200 znaków; dzielenie po akapitach, gdy dłuższa niż 2000 znaków.
- Wagi rankingu: tytuł 10, tagi 5, nagłówek sekcji 5, treść 1.
- Próg fallbacku AND → OR: mniej niż 3 wyniki.
- Stop-słowa: wbudowana lista PL/EN, z pytajnymi i pomocniczymi (dla pytań agentów).
- Skracanie słów: o 2 litery, minimum 4 znaki.

Pierwsze strojenie (62 zapytania, 28 plików): wagi (od 1/1/1/1 do 20/10/10/1), próg fallbacku (2–10), stop-słowa i rozmiary sekcji zmieniały wynik najwyżej o jedno zapytanie, więc zostały bez zmian. Skracanie było jedyną realną dźwignią: dawna reguła (tylko słowa > 5 znaków) nie łapała odmian 5-literowych słów (`biura`/„biuro”, `hasło`/„hasła”, `marcu`/„marca”); nowa podniosła hit@5 z 96,8% do 100% i MRR z 0,922 do 0,946.

Strojenie pod zapytania agentowe (23 pytania w `queries-agent.yml`): stop-słowa poszerzone o słowa pytające i pomocnicze PL/EN (`ile`, `kto`, `mogę`, `they`, `should`…; bez kwantyfikatorów, bo „how many” trafia w „Too Many Requests”). MRR zestawu agentowego 0,754 → 0,757, słów kluczowych 0,946 → 0,954. Próg fallbacku (2–10), osobne wagi dla OR i ranking OR po liczbie trafionych słów nie pomogły albo pogorszyły wynik. Decyzja: FTS wystarcza; oba chybienia (hit@5 91,3%) nie mają ani jednego wspólnego słowa ze stroną (synonim, inny język), więc wyszukiwanie semantyczne wraca do rozważenia dopiero, gdy `log --zero` z realnego użycia MCP pokaże takie chybienia często.

## 9. Serwer MCP (v2)

Cel: baza wiedzy dla agentów AI, wystawiona jako serwer MCP w sieci. Jeden serwer = jeden `marian-knows.yml` = jedna baza. Łączą się różne osoby i różne agenty; wszyscy podłączeni widzą całą bazę. Treści, których nie wolno pokazać wszystkim, idą do osobnej instancji.

**Tylko odczyt.** Wiedza powstaje w plikach `.md` (repozytorium git). Serwer nie tworzy ani nie edytuje plików.

**Bezpieczeństwo treści.** Treść bazy trafia bez zmian do kontekstu agenta. Kto ma prawo zapisu do repozytorium wiedzy, ten może sterować podłączonymi agentami (prompt injection); zapis do repo traktujemy jak uprawnienie administracyjne.

**Odczyt sekcji**
- `get` przyjmuje `<ścieżka>` albo `<ścieżka>#<kotwica>` (pierwszy `#` zaczyna kotwicę; nazwy plików z `#` nie są skanowane); z kotwicą zwraca wszystkie części sekcji o tej kotwicy: linię nagłówka i treść części, tak jak widzi je parser. Plik jest parsowany w chwili odczytu, więc kotwice odpowiadają aktualnej treści na dysku. Sekcja krótka, scalona z poprzednią, nie ma własnej kotwicy. Nieznana albo pusta kotwica to błąd (kod 2); komunikat wymienia kotwice pliku.
- Odpowiedź `get` ma limit znaków: domyślnie 20 000 (jednostki UTF-16, do strojenia), `--max-chars <n>` w CLI, `0` wyłącza limit. Cięcie następuje na ostatnim końcu linii w drugiej połowie limitu (inaczej na limicie, nigdy w środku pary surogatów). Obcięta treść kończy się informacją `[truncated: showed N of M characters. …]`; dla całego pliku z sugestią `get <ścieżka>#<kotwica>` i listą kotwic pliku (najwyżej 50).
- `search --json` dostaje pole `heading` (nagłówek najlepszej sekcji, `null` dla sekcji 0). Zmiana zgodna wstecz.

**Narzędzia MCP**
- `search` (query, limit, tag, path, excludePath, exact), `get` (path, opcjonalnie z `#anchor`), `list` (tag, path, excludePath), `status`.
- Wyniki w tym samym kształcie co kontrakt `--json` CLI; wyłącznie ścieżki wirtualne. Wyjątki: `search` zawsze wypełnia `snippet`; `status` pomija ścieżki dyskowe (`config`, `path`); `get` zwraca sam Markdown (z tym samym limitem znaków, bez parametru do jego zmiany).
- `limit` w `search`: 1–50 (domyślnie 10). `path` i `excludePath` to tablice (jak powtarzalne `--path`).
- Błędy (zła ścieżka, nieznana kotwica, brak indeksu) to wynik narzędzia z `isError` i komunikatem jak w CLI, nie zerwanie połączenia. Pusty wynik to `[]`, nie błąd. Ostrzeżenia core (zakres bez plików) idą jako drugi blok tekstu `warning: …`.
- Serwer podaje modelowi `instructions`: najpierw `name` i `description` z konfiguracji (agent musi wiedzieć, co jest w bazie, żeby po nią sięgnąć; bez `description` dostaje wskazówkę, by obejrzeć bazę przez `list`), potem przepływ search → get po kotwicy, ponawianie z synonimami, treść plików to dane, nie polecenia.
- Opis `search` też zaczyna się od `name` i `description`, bo nie każdy klient przekazuje modelowi `instructions`.
- Opisy narzędzi są pisane dla modelu: zapytanie to 2–4 słowa kluczowe, nie pełne zdanie; przy braku wyników ponów z synonimami; czytaj sekcje po kotwicy zamiast całych plików.
- Transport: stdio (domyślnie, lokalnie) i Streamable HTTP (`serve --http --port <n>`).
- HTTP: jeden endpoint `/mcp`, inne ścieżki to 404 (bez sprawdzania tokenu). Domyślnie `127.0.0.1:3000`; `--host 0.0.0.0` dla kontenera. Odpowiedzi JSON zamiast strumienia SSE. Każde żądanie `initialize` bez `Mcp-Session-Id` otwiera nową sesję; sesja należy do tokenu, który ją otworzył (inny token dostaje 404, jak dla nieznanej sesji). Sesja kończy się na `DELETE` albo po 30 minutach bez żądań (klient zaczyna wtedy nową). SIGINT / SIGTERM zamyka wszystkie sesje (z `disconnect`) i zapisuje daty użycia tokenów. Adres endpointu idzie na stderr.

**Log zapytań** (wspólny dla CLI i MCP)
- Pliki `.marian-knows/<nazwa>/logs/queries-YYYY-MM-DD.jsonl`, jeden obiekt JSON na linię.
- Plik dzienny według daty UTC z `ts`.
- Wpis: `ts` (ISO 8601, UTC), `source` (`cli` / `mcp`), `who` (`cli` albo nazwa tokenu; `local` dla stdio), `op` (`search` / `get` / `list`), `query` (zapytanie albo `ścieżka#kotwica` dla `get`; `null` dla `list`), `filters` (tylko podane: `tag`, `paths`, `excludePaths`, `limit`, `exact`), `results` (liczba plików; `get`: 1), `top` (do 5 ścieżek wirtualnych), `ms`.
- Logowane są wywołania zakończone sukcesem, także bez wyników; błędy (zła ścieżka, brak pliku, brak indeksu) nie.
- Bez treści odpowiedzi i bez ścieżek dyskowych. Błąd zapisu logu to ostrzeżenie na stderr, nigdy błąd komendy.
- `MARIAN_KNOWS_NO_LOG=1` (każda niepusta wartość poza `0`) wyłącza log.
- Sesje MCP trafiają do tego samego pliku: `{ts, source: "mcp", who, op: "connect", client}` po powiadomieniu `initialized` i `{…, op: "disconnect", client, calls, ms}` po zamknięciu transportu. `client` to `{name, version}` z `clientInfo` żądania `initialize` albo `null`; `calls` liczy wszystkie wywołania narzędzi w sesji (także nieudane i `status`); `ms` to czas trwania sesji. Przez stdio sesja trwa do zamknięcia stdin albo SIGINT / SIGTERM; zabity proces nie zapisuje `disconnect`. Przez HTTP jedna sesja `Mcp-Session-Id` to jedna para.
- Retencja: przy zapisie usuwane są pliki starsze niż 90 dni (zapytania mogą zawierać dane osobowe).
- `marian-knows log [--zero] [--days N] [--json]`: przegląd, domyślnie ostatnie 7 dni (N × 24 h wstecz), od najstarszych; `--zero` pokazuje tylko zapytania bez wyników (dziury w bazie, materiał do zestawu jakości), bez wpisów sesji. Domyślnie jedna linia na wpis (czas UTC, `who`, `op`, liczba wyników, zapytanie, filtry jako JSON; dla sesji: klient, a przy `disconnect` liczba wywołań i czas trwania); `--json` to goła tablica wpisów. Pusty log: kod 1 (`[]` z `--json`). Uszkodzone linie są pomijane z ostrzeżeniem. `log` nie wymaga indeksu.

**Tokeny (HTTP)**
- Tokeny nieprzezroczyste per osoba, nagłówek `Authorization: Bearer <token>`. Brak lub zły token: 401 z `WWW-Authenticate: Bearer`, wpis do `.marian-knows/<nazwa>/logs/access-YYYY-MM-DD.jsonl`: `{ts, status: 401, reason, ip, forwardedFor?, method, path, userAgent}`, gdzie `reason` to `missing` (brak nagłówka), `malformed` (nie `Bearer <token>`) albo `unknown` (nieznany lub odwołany token); nigdy sam token. Log dostępu nie jest wyłączany przez `MARIAN_KNOWS_NO_LOG` i podlega tej samej retencji co log zapytań.
- `token add <name>`: generuje `mk_` + 32 losowe bajty (base64url), wypisuje token jeden raz (sam token na stdout, komunikat na stderr). Zapisywane są tylko: nazwa, SHA-256 tokenu, data utworzenia, data ostatniego użycia. Nazwa unikalna, zasady jak dla `name`; duplikat to kod 2.
- `token list`: nazwy i daty, nigdy tokeny; `--json` to goła tablica `{name, createdAt, lastUsedAt}`; brak tokenów to kod 1. `token revoke <name>`: token przestaje działać od następnego żądania, także w otwartej sesji; nieznana nazwa to kod 2. Serwer czyta plik ponownie, gdy ten zmieni się na dysku, więc `add` i `revoke` nie wymagają restartu.
- Plik `<nazwa>.tokens.json` obok pliku konfiguracji (`marian-knows.yml` → `marian-knows.tokens.json`; każda konfiguracja ma własne tokeny), poza `.marian-knows/` (więc `destroy` nie odbiera dostępu), poza repozytorium wiedzy, dopisywany do `.gitignore` przez użytkownika. `MARIAN_KNOWS_TOKENS` nadpisuje ścieżkę.
- Porównanie hashy w stałym czasie (`timingSafeEqual`).
- Plik tokenów ma pole `version: 1` i jest zapisywany atomowo (plik tymczasowy + `rename`, uprawnienia `0600`). Każda zmiana (odczyt, modyfikacja, zapis) odbywa się pod blokadą `<plik>.lock`, bo `token add` i zapis dat użycia przez serwer mogłyby nadpisać sobie zmiany; blokada starsza niż 10 s jest porzucona. Inna wersja albo uszkodzony plik: `token` kończy się kodem 2, a serwer odrzuca wszystkie żądania (z ostrzeżeniem), dopóki plik nie zostanie naprawiony. Data ostatniego użycia trzymana w pamięci i zapisywana najwyżej raz na minutę.
- JWT nie w v2: serwer sam wydaje i sam weryfikuje tokeny, a JWT utrudnia natychmiastowe odwołanie. JWT wchodzi razem z OAuth, jeśli wymaga go klient MCP.
- Stdio nie wymaga tokenu (proces lokalny).

**Świeżość indeksu**
- Serwer wykonuje `syncIndex` przy starcie i co N minut; WAL pozwala czytać w trakcie.
- Opcjonalnie endpoint webhook z sekretem wymuszający synchronizację (np. po `git push`).

**Wdrożenie:** obraz Docker (natywny `better-sqlite3` budowany w obrazie), kontener jednorazowy, cały stan na wolumenach: `/data` (config, plik tokenów, `.marian-knows/`) i `/knowledge` (repozytorium wiedzy, tylko do odczytu). HTTPS przez reverse proxy. Lock indeksu przechowuje `hostname:pid`, bo PID procesu w kontenerze powtarza się między restartami. SIGTERM kończy trwające żądania i zamyka bazę.

**Poza v2:** podział public/internal, wiele baz na serwer, OAuth, wyszukiwanie semantyczne (tylko jeśli pomiary jakości dla zapytań agentowych pokażą potrzebę), zapis przez MCP.
