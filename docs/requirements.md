# MarianKnows: wymagania (v1, wersja robocza)

## 1. Cel

Baza wiedzy z plików `.md`, przeszukiwalna pełnotekstowo z linii poleceń. Pliki `.md` są źródłem prawdy, a indeks SQLite to odtwarzalna pochodna.

Zastosowanie docelowe: karmienie asystenta AI, który pomaga klientowi. Ta sama baza może być też bazą wiedzy formową lub tematyczną. Przewidywana skala: dziesiątki plików, więc wydajność nie jest kryterium projektowym.

## 2. Zakres

- **W v1:** CLI `marian-knows` (Node.js 20+, ESM, TypeScript); indeks SQLite + FTS5 (`better-sqlite3`) na poziomie sekcji; wyszukiwanie (także w poddrzewie ścieżek), listowanie, odczyt plików; konfiguracja YAML (`yaml` + `zod`); skan katalogów (`fast-glob`).
- **Poza v1:** serwer MCP, `--watch`, wyszukiwanie semantyczne, synonimy i aliasy, wyjątki fleksyjne i indeks trigramowy, widoczność treści (public/internal), edycja plików, UI.

## 3. Konfiguracja: `marian-knows.yml`

Konfiguracja opisuje jeden projekt i jeden katalog źródłowy.

```yaml
name: Baza wiedzy klienta
path: ./docs
exclude:
  - "**/draft/**"
```

| Pole      | Opis                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| `name`    | wymagany identyfikator projektu                                                           |
| `path`    | katalog źródłowy; względny do katalogu z `marian-knows.yml` albo absolutny; opcjonalny     |
| `exclude` | string lub lista globów względnych do `path`; opcjonalne                                  |

**`name`**
- Po usunięciu białych znaków z brzegów: od 1 do 128 znaków, bez znaków sterujących.
- Na razie tylko metadane: nie wpływa na nazwę ani lokalizację bazy danych.

**`path`**
- Brak pola oznacza katalog pliku `marian-knows.yml`. Skanowanie jest zawsze rekurencyjne.
- Istniejące `path` musi wskazywać katalog; plik to błąd konfiguracji.
- Nieistniejący katalog nie jest błędem: `scan` wypisuje ostrzeżenie i nie znajduje plików.
- Błąd dostępu do katalogu (np. brak uprawnień) jest błędem konfiguracji.

**Walidacja:** nieznane pola są błędem; stare pole `sources` jest odrzucane z osobnym komunikatem. Walidacja zbiera wszystkie błędy naraz, kod wyjścia 2.

**Zasady skanowania**
- Indeksowane są tylko `.md`. Zawsze pomijane, niezależnie od `exclude`: ukryte pliki i katalogi (od kropki), `node_modules`.
- Pliki większe niż 1 MB oraz nazwy zawierające `#` lub `?` są pomijane z ostrzeżeniem.
- Ścieżka wirtualna pliku to `/` oraz jego ścieżka względna wobec `path`, z separatorami `/` i normalizacją Unicode NFC. Przykład: `path: ./docs` i plik `docs/api/readme.md` dają `/api/readme.md`.
- W indeksie są wyłącznie **ścieżki wirtualne**; ścieżki dyskowe żyją tylko w YAML-u i w wyjściu diagnostycznym (`scan --disk`), więc baza jest przenośna.
- Kolizja ścieżek różniących się wyłącznie wielkością liter (także w nazwach katalogów, np. `/Notes/x.md` i `/notes/x.md`): wygrywa pierwsza w porządku punktów kodowych, pozostałe są pomijane z ostrzeżeniem.

**Pozostałe**
- Baza leży w katalogu `.marian-knows/` obok pliku konfiguracyjnego (`index.db`, `-wal`, `-shm`), lokalizacji nie da się zmienić. Katalog powstaje przy pierwszym indeksowaniu; jako ukryty nigdy nie jest skanowany. Jedno `marian-knows.yml` = jedna baza; treści publiczne i wewnętrzne rozdziela się w v1 osobnymi `marian-knows.yml`.
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

**Odporność i współbieżność:** WAL (`search` działa w trakcie `index`), blokada przed równoległymi `index`, nieczytelny plik to ostrzeżenie i kontynuacja. `status` pokazuje wiek indeksu.
- Blokada to plik `.marian-knows/index.lock` z PID właściciela, zakładany atomowo i usuwany po zakończeniu. Gdy trzyma go żywy proces, `index` kończy się błędem `index is already running (pid N)` (kod 2); blokada po martwym procesie jest przejmowana.
- Plik, którego nie da się odczytać, jest traktowany jak nieobecny: jego poprzednia wersja znika z indeksu. Plik bez zmian `mtime` i `size` nie jest czytany, więc zostaje.
- Błąd w trakcie synchronizacji wycofuje całą transakcję; indeks zostaje w poprzednim stanie.

## 5. Wyszukiwanie

- Ranking `bm25` po sekcjach; wagi: tytuł 10, tagi 5, nagłówek sekcji 5 (do strojenia), treść 1. Wynik CLI jest na poziomie **plików**: pozycję pliku wyznacza jego najlepsza sekcja.
- Snippety z treści sekcji, dopasowania w `[...]`.
- Wiele słów łączonych przez AND (tryb ścisły). **Fallback:** gdy wyników jest mniej niż 3, a zapytanie ma więcej niż jedno znaczące słowo, dołączane są wyniki trybu OR, ścisłe wyżej.
- **Stop-słowa:** stała lista PL/EN w kodzie jest usuwana z zapytania; jeśli zostałyby same stop-słowa, nic nie jest usuwane.
- Polska fleksja prefiksem, bez stemmera: słowa dłuższe niż 5 znaków skracane o 2 ostatnie litery i dopasowywane jako prefiks (`konfiguracja` znajdzie „konfigurację", „konfiguracji"); krótsze dopasowywane jako prefiks bez skracania. Znaki specjalne FTS5 są usuwane. Litery `ł`/`Ł` są sprowadzane do `l`/`L` w kolumnach FTS i w zapytaniu (tokenizer nie usuwa z nich diakrytyku), więc `zolw` znajdzie „żółw”; `docs`, `sections` i snippety zachowują oryginalny tekst.
- `-n <limit>`: domyślnie 10 plików. `--tag <tag>`: pliki z tym tagiem, bez rozróżniania wielkości liter; filtr działa przed fallbackiem i limitem. `--exact` wyłącza skracanie, prefiksy i fallback do OR.
- **Zestaw testowy jakości:** plik z zapytaniami i oczekiwanymi trafieniami, mierzący trafność w top 5; uruchamiany w testach, służy do strojenia wag, progu fallbacku i stop-słów.

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
marian-knows index [--full]           # (re)indeksowanie
marian-knows search <query> [opcje]   # pliki wg rankingu
marian-knows list [opcje]             # pliki z indeksu, posortowane po ścieżce
marian-knows get <path>               # zawartość pliku z indeksu (ścieżka wirtualna)
marian-knows status [--json]          # stan projektu: konfiguracja, liczba plików i sekcji, rozmiar, czas i wiek indeksu
marian-knows destroy                  # usuwa indeks (katalog .marian-knows/); konfiguracja zostaje
marian-knows help                     # pomoc (także --help)
```

Opcja globalna: `--config <plik>` (dla `init`: plik, który ma zostać utworzony).

| Komenda  | Opcje                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| `search` | `-n <limit>`, `--json`, `--snippets`, `--tag <tag>`, `--exact`, `--path <prefiks>`, `--exclude-path <prefiks>` |
| `list`   | `--json`, `--tag <tag>`, `--path <prefiks>`, `--exclude-path <prefiks>`                                        |
| `scan`   | `--json`, `--disk` (dołącza ścieżki dyskowe, wyłącznie diagnostycznie)                                         |

**`init <project_name>`:** nazwa podlega tym samym zasadom co `name`. Domyślny cel to `./marian-knows.yml`; istniejący plik nigdy nie jest nadpisywany (kod 2). Polecenie nie modyfikuje `.gitignore` i nie tworzy plików bazy danych.

**`parse <file>`:** diagnostyka parsera, nie wymaga konfiguracji. Domyślnie wypisuje tytuł, tagi, frontmatter i listę sekcji z podglądem treści; `--json` wypisuje jeden obiekt `{title, tags, frontmatter, sections}`. Ostrzeżenia idą na stderr; nieczytelny plik to kod 2.

**`get <path>`:** wypisuje plik bez zmian (bajty z dysku, bez normalizacji). Obsługuje wyłącznie pliki obecne w indeksie, więc nie odczyta niczego, czego nie pokazuje `list` (plików wykluczonych, ukrytych, spoza `.md`). Ścieżka z końcowym `/`, ścieżka spoza indeksu i plik usunięty po indeksowaniu to błąd (kod 2).

**`status`:** nazwa projektu, ścieżka pliku konfiguracji i katalogu źródłowego (diagnostycznie), `exclude`, stan indeksu (`ok`, `missing`, `outdated`), liczba plików i sekcji, rozmiar bazy (`index.db` z `-wal` i `-shm`), czas i wiek indeksowania. Brak indeksu nie jest błędem (kod 0).

**`destroy`:** usuwa katalog `.marian-knows/`. Pliki `.md` i `marian-knows.yml` zostają. Odmawia (kod 2), gdy trwa `index`. Brak indeksu to kod 0 i komunikat `No index to remove`.

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
- `search`: `path`, `title`, `tags` (tablica), `score`, `anchor` (najlepsza sekcja pliku), `snippet` (wypełniony tylko z `--snippets`). `list`: `path`, `title`, `tags`. Pola nie są pomijane: brak wartości to `null` (`tags`: `[]`).
- `status --json`: jeden obiekt `{name, config, path, pathExists, exclude, index, files, sections, dbSize, indexedAt, ageSeconds}`; `index` to `ok`, `missing` albo `outdated`, pozostałe pola indeksu są `null`, gdy indeks nie jest `ok` (`dbSize` także przy `outdated`).
- `score` to `bm25` (niższa wartość = lepiej), porównywalny tylko w obrębie jednego zapytania.
- Zmiany dodające pola są zgodne wstecz; usunięcie pola lub zmiana jego znaczenia wymaga podniesienia wersji głównej `marian-knows`.
- W trybie `--json` stdout zawiera wyłącznie JSON, ostrzeżenia i błędy idą na stderr; brak wyników w `search` i `list` to `[]` i kod 1.
- `get` zamienia ścieżkę wirtualną na dyskową względem `path` i może odczytać wyłącznie plik wewnątrz skonfigurowanego katalogu źródłowego, obecny w indeksie.

| Kod | Znaczenie                                                                                |
| --- | ---------------------------------------------------------------------------------------- |
| 0   | OK                                                                                       |
| 1   | brak wyników w `search` i `list` (jak `grep`)                                            |
| 2   | błąd: brak konfiguracji, zły YAML, błędna konfiguracja lub ścieżka, brak indeksu, zła składnia wywołania (nieznana opcja, nadmiarowy argument), trwający `index`, każdy nieoczekiwany wyjątek |

Przy braku indeksu: `No index. Run: marian-knows index`.

## 7. Architektura

```
marian-knows/
├─ package.json     # bin: { "marian-knows": "dist/cli.js" }, exports: { "./core": ... }
└─ src/
   ├─ core/         # config, scan, init, indexer, search, list
   └─ cli.ts        # argumenty i formatowanie wyjścia
```

Cała logika (w tym walidacja ścieżek i filtr zakresu) w `core`, CLI jest cienką warstwą. Przyszły MCP może być (A) osobnym procesem wołającym `marian-knows ... --json` albo (B) konsumentem `marian-knows/core`; oba warianty nie wymagają zmian w CLI, a zakres ścieżek jest wtedy parametrem narzędzia.

## 8. Parametry do strojenia

Wartości startowe, bez decyzji z góry; do dostrojenia na zestawie testowym jakości (sekcja 5) po pierwszych realnych danych.

- Sekcje: łączenie z poprzednią, gdy krótsza niż 200 znaków; dzielenie po akapitach, gdy dłuższa niż 2000 znaków.
- Wagi rankingu: tytuł 10, tagi 5, nagłówek sekcji 5, treść 1.
- Próg fallbacku AND → OR: mniej niż 3 wyniki.
- Stop-słowa: wbudowana lista PL/EN.