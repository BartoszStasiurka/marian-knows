# Zmiana założeń

## `marian-knows.yml`

Konfiguracja opisuje jeden projekt i jeden katalog źródłowy. Punkty montowania (`sources`) nie istnieją.

```yaml
name: Baza wiedzy klienta
path: ./docs
exclude:
	- "**/draft/**"
```

- `name` jest wymaganym identyfikatorem projektu. Po usunięciu białych znaków z brzegów musi mieć od 1 do 128 znaków i nie może zawierać znaków kontrolnych. Na tym etapie jest metadanymi i nie wpływa na nazwę ani lokalizację przyszłej bazy danych.
- `path` jest opcjonalną ścieżką do katalogu. Ścieżka względna jest liczona względem katalogu pliku `marian-knows.yml`; brak pola oznacza ten katalog. Skanowanie jest zawsze rekurencyjne.
- Istniejące `path` musi wskazywać katalog. Nieistniejący katalog nie jest błędem konfiguracji: `scan` wypisuje ostrzeżenie i nie znajduje plików. Błąd dostępu do katalogu jest błędem konfiguracji.
- `exclude` jest opcjonalnym stringiem albo listą stringów. Globy są liczone względem `path`.
- Ukryte pliki i katalogi oraz `node_modules` są zawsze pomijane, niezależnie od `exclude`.
- Skanowane są tylko pliki `.md`. Pliki większe niż 1 MB oraz nazwy zawierające `#` lub `?` są pomijane z ostrzeżeniem.
- Ścieżka wirtualna pliku to `/` oraz jego ścieżka względna wobec `path`, z separatorami `/` i normalizacją Unicode NFC. Przykład: `path: ./docs` i plik `docs/api/readme.md` dają `/api/readme.md`.
- Kolizję nazw różniących się wyłącznie wielkością liter rozstrzyga pierwszy plik w porządku punktów kodowych; pozostałe są pomijane z ostrzeżeniem.

## Komendy

Globalny argument `--config <file>` wskazuje plik konfiguracji. Dla polecenia `init` wskazuje plik, który ma zostać utworzony.

- `scan [--json] [--disk]` skanuje jeden katalog źródłowy. Domyślnie wypisuje ścieżki wirtualne; `--disk` dołącza ścieżki dyskowe wyłącznie diagnostycznie.
- `init <project_name>` tworzy minimalny plik konfiguracji zawierający `name`. Domyślny cel to `./marian-knows.yml`; istniejący plik nigdy nie jest nadpisywany. Polecenie nie modyfikuje `.gitignore` i nie tworzy plików bazy danych.
- `help` oraz `--help` wyświetlają pomoc.

## Komendy do zrealizowania w kolejnych iteracjach

- `parse <file> [--json]` parsuje plik wskazany ścieżką dyskową.
- `reindex` przelicza indeksy projektu zgodnie z nowymi założeniami. 
- `status [--json]` wyświetla aktualny stan projektu, w tym informacje o indeksach i konfiguracji.
- `destroy` usuwa projekt i wszystkie jego dane.
- `search` i `list` zachowują dotychczasowe założenia; ich ścieżki zakresu pozostają ścieżkami wirtualnymi.
- `get <path>` przyjmuje ścieżkę wirtualną i może odczytać wyłącznie plik wewnątrz skonfigurowanego katalogu źródłowego.

Do czasu implementacji `parse`, `reindex`, `status`, `destroy`, `search` i `list` są rozpoznawane przez CLI, nie mają efektów ubocznych, zwracają kod 0 i wypisują `TODO: implementacja` na stderr. Także z `--json` nie udają jeszcze docelowego kontraktu JSON.

## Testy

Testy tworzą dynamiczne drzewa katalogów i plików w katalogach tymczasowych; nie używają rzeczywistych ścieżek użytkownika ani trwałych fixture'ów.

Zakres testów obejmuje:

- walidację `name`, domyślnego i jawnego `path`, `exclude` oraz odrzucenie starego pola `sources`;
- skan rekurencyjny, ścieżki wirtualne, wykluczenia, pliki ukryte, `node_modules`, pliki za duże, nazwy specjalne, NFC i kolizje wielkości liter;
- `init`, globalne `--config`, tryby `scan --json` i `scan --disk`, pomoc oraz stuby bez efektów ubocznych.

## Uwagi

- Dokumentacja i roadmapa nie mogą już używać pojęć mountów, nakładania mountów, `recursive: false`
- Baza danych pozostanie obok konfiguracji, gdy zostanie wprowadzona, ale `name` nie determinuje jej nazwy w tej iteracji.