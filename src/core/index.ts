export {
  CONFIG_ENV,
  CONFIG_FILENAME,
  MAX_NAME_LENGTH,
  findConfig,
  loadConfig,
  validateProjectName,
} from "./config.js";
export { ConfigError, IndexLockedError, IndexMissingError } from "./errors.js";
export { fold } from "./fold.js";
export { initConfig } from "./init.js";
export {
  INDEX_DIRNAME,
  INDEX_FILENAME,
  LOCK_FILENAME,
  SCHEMA_VERSION,
  acquireIndexLock,
  indexPath,
  openIndex,
  rebuildIndex,
  syncIndex,
} from "./indexer.js";
export {
  MAX_SECTION_CHARS,
  MIN_SECTION_CHARS,
  decodeMarkdown,
  parseFile,
  parseMarkdown,
  slugify,
} from "./parse.js";
export { MAX_FILE_BYTES, scanSource } from "./scan.js";
export {
  DEFAULT_LIMIT,
  FALLBACK_THRESHOLD,
  RANK_WEIGHTS,
  SNIPPET_CHARS,
  SNIPPET_CONTEXT,
  STOP_WORDS,
  TRIM_ABOVE,
  TRIM_CHARS,
  prepareQuery,
  search,
} from "./search.js";
export type { IndexOptions } from "./indexer.js";
export type { PreparedQuery, SearchHit, SearchOptions } from "./search.js";
export type { IndexResult, LoadedConfig, ParsedDoc, ScanResult, ScannedFile, Section } from "./types.js";
export { validateVirtualPath } from "./virtual-path.js";
