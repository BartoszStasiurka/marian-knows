/**
 * Folds `ł`/`Ł` to `l`/`L`. The `unicode61 remove_diacritics 2` tokenizer strips only letters with a
 * Unicode decomposition (ą ć ę ń ó ś ź ż); `ł` has none. Applied to the FTS columns at index time and
 * to the query at search time. One UTF-16 unit maps to one, so offsets in folded text match the original.
 */
export function fold(text: string): string {
  return text.replace(/[łŁ]/g, (c) => (c === "ł" ? "l" : "L"));
}
