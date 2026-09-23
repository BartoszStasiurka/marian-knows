# MarianKnows: wymagania (v1, wersja robocza)

## 1. Cel

Baza wiedzy z plików `.md`, przeszukiwalna pełnotekstowo z linii poleceń. Pliki `.md` są źródłem prawdy, a indeks SQLite to odtwarzalna pochodna.

Zastosowanie docelowe: karmienie asystenta AI, który pomaga klientowi. Ta sama baza może być też bazą wiedzy formową lub tematyczną. Przewidywana skala: dziesiątki plików, więc wydajność nie jest kryterium projektowym.

## 2. Zakres

- **W v1:** CLI `marian-knows` (Node.js 20+, ESM, TypeScript); indeks SQLite + FTS5 (`better-sqlite3`) na poziomie sekcji; wyszukiwanie (także w poddrzewie ścieżek), listowanie, odczyt plików; konfiguracja YAML (`yaml` + `zod`); skan katalogów (`fast-glob`).
- **Poza v1:** serwer MCP, `--watch`, wyszukiwanie semantyczne, synonimy i aliasy, wyjątki fleksyjne i indeks trigramowy, widoczność treści (public/internal), edycja plików, UI.

## 3. Konfiguracja: `marian-knows.yml`

Źródła to mapa punktów montowania: klucz = wirtualna ścieżka w indeksie, `path` = lokalizacja na dysku.

```yaml
sources:
  /:
    path: .
    recursive: true
  /server/:
    path: /full/path/to/server-dir
    recursive: false
    exclude: ["**/legacy/**"]
  /README.md:
    path: ./README.md
```

| Pole        | Opis                                                                |
| ----------- | ------------------------------------------------------------------- |
| klucz       | wirtualna ścieżka (zasady niżej)                                    |
| `path`      | plik lub katalog; względna do katalogu z `marian-knows.yml` albo absolutna |
| `recursive` | dla katalogów, domyślnie `true`; dla plików ignorowane              |
| `exclude`   | string lub lista globów względnych do `path`; opcjonalne            |

**Klucz mounta**
- Ścieżka absolutna z separatorem `/`, w Unicode NFC.
- Kończy się `/` wtedy i tylko wtedy, gdy `path` to katalog; niezgodność to błąd konfiguracji.
- Zabronione: puste segmenty (`//`), segmenty `.` i `..`, `\`, znaki sterujące, białe znaki na brzegach segmentu. Maks. 512 znaków.
- Wielkość liter jest rozróżniana, wielkie litery dozwolone, ale unikalność kluczy sprawdzana bez jej uwzględniania (`/Notes/` i `/notes/` to błąd).
- Walidacja zbiera wszystkie błędy naraz, kod wyjścia 2.

**Tryby:** plik (musi mieć `.md`); katalog płaski (`recursive: false`); katalog rekurencyjny.

**Zasady**
- Indeksowane są tylko `.md`. Zawsze pomijane: ukryte pliki i katalogi (od kropki), `node_modules`, pliki większe niż 1 MB (ostrzeżenie).
- W indeksie są wyłącznie **ścieżki wirtualne** (klucz + ścieżka względna, `/`, NFC, np. `/server/api/readme.md`); ścieżki dyskowe żyją tylko w YAML-u, więc baza jest przenośna.
- Nazwy plików ze znakami `#` i `?` są pomijane z ostrzeżeniem.
- Kolizja wielkości liter w jednym katalogu (`a.md`, `A.md`): do indeksu trafia pierwszy alfabetycznie, reszta jest pomijana z ostrzeżeniem.
- Nakładanie mountów: wygrywa najdłuższy prefiks (granica katalogu dzięki końcowemu `/`, więc `/server/` nie obejmuje `/server2/`); mount plikowy wygrywa z katalogowym dla tej samej ścieżki. Liczba przesłoniętych plików jest raportowana ostrzeżeniem.
- Nieistniejący `path` lub mount bez dopasowań to ostrzeżenie, nie błąd.
- Baza leży obok pliku konfiguracyjnego (`marian-knows.db`, `-wal`, `-shm`), lokalizacji nie da się zmienić. Jedno `marian-knows.yml` = jedna baza; treści publiczne i wewnętrzne rozdziela się w v1 osobnymi `marian-knows.yml`.
- Wybór konfiguracji: `--config <plik>`, potem `MARIAN_KNOWS_CONFIG`, potem `marian-knows.yml` szukany w górę od bieżącego katalogu.

## 4. Indeks

**Jednostka: sekcja.** Plik jest dzielony po nagłówkach H2 i H3 (H1 to tytuł dokumentu; H4+ zostają w treści sekcji nadrzędnej). Tekst przed pierwszym nagłówkiem to sekcja 0; plik bez nagłówków to jedna sekcja. Nagłówki w blokach kodu są ignorowane. Zbyt krótkie sekcje są łączone z poprzednimi, zbyt długie dzielone po akapitach. Każda sekcja ma kotwicę (slug, unikalny w pliku: `backup`, `backup-1`) i dziedziczy tytuł oraz tagi pliku.

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
1. Skan mountów daje zbiór plików po rozstrzygnięciu nakładania i kolizji.
2. Porównanie z indeksem: nowe, usunięte, potencjalnie zmienione (inny `mtime` lub `size`).
3. Dla potencjalnie zmienionych liczony jest hash: taki sam = tylko aktualizacja `mtime`, inny = przeindeksowanie wszystkich sekcji pliku.
4. Pliki usunięte, wykluczone lub przesłonięte znikają, bo diff opiera się na zbiorze ścieżek.

**Pełna przebudowa:** przy niezgodności `schema_version` (schemat, tokenizer, parser sekcji) albo ręcznie `marian-knows index --full`.

**Odporność i współbieżność:** WAL (`search` działa w trakcie `index`), blokada przed równoległymi `index`, nieczytelny plik to ostrzeżenie i kontynuacja. `stats` pokazuje wiek indeksu.

## 5. Wyszukiwanie

- Ranking `bm25` po sekcjach; wagi: tytuł 10, tagi 5, nagłówek sekcji 5 (do strojenia), treść 1. Wynik CLI jest na poziomie **plików**: pozycję pliku wyznacza jego najlepsza sekcja.
- Snippety z treści sekcji, dopasowania w `[...]`.
- Wiele słów łączonych przez AND (tryb ścisły). **Fallback:** gdy wyników jest mniej niż 3, a zapytanie ma więcej niż jedno znaczące słowo, dołączane są wyniki trybu OR, ścisłe wyżej.
- **Stop-słowa:** stała lista PL/EN w kodzie jest usuwana z zapytania; jeśli zostałyby same stop-słowa, nic nie jest usuwane.
- Polska fleksja prefiksem, bez stemmera: słowa dłuższe niż 5 znaków skracane o 2 ostatnie litery i dopasowywane jako prefiks (`konfiguracja` znajdzie „konfigurację", „konfiguracji"); krótsze dopasowywane jako prefiks bez skracania. Znaki specjalne FTS5 są usuwane. `--exact` wyłącza skracanie, prefiksy i fallback do OR.
- **Zestaw testowy jakości:** plik z zapytaniami i oczekiwanymi trafieniami, mierzący trafność w top 5; uruchamiany w testach, służy do strojenia wag, progu fallbacku i stop-słów.

**Zakres ścieżek**
- `--path <prefiks>` (w `search` i `list`): poddrzewo ścieżek wirtualnych na dowolnej głębokości. Prefiks z końcowym `/` obejmuje katalog (`/projekt/A/` nie obejmuje `/projekt/AB/`); bez końcowego `/` oznacza pojedynczy plik.
- `--path` można powtarzać (OR); `--exclude-path` wyklucza poddrzewa lub pliki.
- Filtr działa przed rankingiem i limitem (`-n` dotyczy wyników z zakresu), łączy się z innymi filtrami (`--tag`) przez AND.
- Zakres jest wyłącznie parametrem zapytania (nie ma go w konfiguracji, nie ma `--depth`) i dotyczy ścieżek wirtualnych.
- Składnia jak klucz mounta; niepoprawna ścieżka to błąd (kod 2). Poprawna, ale bez plików w indeksie: brak wyników (kod 1 w `search`) i ostrzeżenie na stderr.

## 6. Interfejs CLI

```
marian-knows init                     # tworzy marian-knows.yml, dopisuje marian-knows.db* do .gitignore
marian-knows index [--full]           # (re)indeksowanie
marian-knows search <query> [opcje]   # pliki wg rankingu
marian-knows list [opcje]             # pliki z indeksu, posortowane po ścieżce
marian-knows get <path>               # zawartość pliku
marian-knows stats                    # liczba plików i sekcji, rozmiar, czas i wiek indeksu
```

Opcja globalna: `--config <plik>`.

| Komenda  | Opcje                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| `search` | `-n <limit>`, `--json`, `--snippets`, `--tag <tag>`, `--exact`, `--path <prefiks>`, `--exclude-path <prefiks>` |
| `list`   | `--json`, `--tag <tag>`, `--path <prefiks>`, `--exclude-path <prefiks>`                                        |

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
Mounty: 3, plików .md: 42
+ 42 nowych, ~ 0 zmienionych, - 0 usuniętych (0.4 s)
! ostrzeżenie: mount /server/ przesłania 3 pliki z mountu /
```

- **Kontrakt `--json`** (stabilny, korzysta z niego m.in. przyszły MCP): goła tablica obiektów, po jednym na plik, w kolejności rankingu (`list`: po ścieżce). Bez koperty i `schemaVersion` w v1.
- `search`: `path`, `title`, `tags` (tablica), `score`, `anchor` (najlepsza sekcja pliku), `snippet` (wypełniony tylko z `--snippets`). `list`: `path`, `title`, `tags`. Pola nie są pomijane: brak wartości to `null` (`tags`: `[]`).
- `score` to `bm25` (niższa wartość = lepiej), porównywalny tylko w obrębie jednego zapytania.
- Zmiany dodające pola są zgodne wstecz; usunięcie pola lub zmiana jego znaczenia wymaga podniesienia wersji głównej `marian-knows`.
- W trybie `--json` stdout zawiera wyłącznie JSON, ostrzeżenia i błędy idą na stderr; brak wyników to `[]` i kod 1.
- `get` zamienia ścieżkę wirtualną na dyskową przez mounty i odrzuca wyjście poza katalog mountu.

| Kod | Znaczenie                                                                                |
| --- | ---------------------------------------------------------------------------------------- |
| 0   | OK                                                                                       |
| 1   | brak wyników w `search` (jak `grep`)                                                     |
| 2   | błąd: brak konfiguracji, zły YAML, błędny klucz mounta lub ścieżka zakresu, brak indeksu |

Przy braku indeksu: `Brak indeksu. Uruchom: marian-knows index`.

## 7. Architektura

```
marian-knows/
├─ package.json     # bin: { "marian-knows": "dist/cli.js" }, exports: { "./core": ... }
└─ src/
   ├─ core/         # config, mounty, indexer, search, list
   └─ cli.ts        # argumenty i formatowanie wyjścia
```

Cała logika (w tym walidacja ścieżek i filtr zakresu) w `core`, CLI jest cienką warstwą. Przyszły MCP może być (A) osobnym procesem wołającym `marian-knows ... --json` albo (B) konsumentem `marian-knows/core`; oba warianty nie wymagają zmian w CLI, a zakres ścieżek jest wtedy parametrem narzędzia.

## 8. Parametry do strojenia

Wartości startowe, bez decyzji z góry; do dostrojenia na zestawie testowym jakości (sekcja 5) po pierwszych realnych danych.

- Sekcje: łączenie z poprzednią, gdy krótsza niż 200 znaków; dzielenie po akapitach, gdy dłuższa niż 2000 znaków.
- Wagi rankingu: tytuł 10, tagi 5, nagłówek sekcji 5, treść 1.
- Próg fallbacku AND → OR: mniej niż 3 wyniki.
- Stop-słowa: wbudowana lista PL/EN.