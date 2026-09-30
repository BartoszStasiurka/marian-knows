export {
  CONFIG_ENV,
  CONFIG_FILENAME,
  MAX_NAME_LENGTH,
  findConfig,
  loadConfig,
  validateProjectName,
} from "./config.js";
export {
  ConfigError,
  DocNotFoundError,
  IndexLockedError,
  IndexMissingError,
  InvalidPathError,
} from "./errors.js";
export { hasTag, inScope, matchesPath, validateScope } from "./filter.js";
export { fold } from "./fold.js";
export { initConfig } from "./init.js";
export { getDoc, list } from "./list.js";
export {
  INDEX_DIRNAME,
  INDEX_FILENAME,
  LOCK_FILENAME,
  SCHEMA_VERSION,
  acquireIndexLock,
  destroyIndex,
  indexDir,
  indexPath,
  openIndex,
  openIndexReadonly,
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
export { status } from "./status.js";
export type { DocFilterOptions } from "./filter.js";
export type { IndexOptions } from "./indexer.js";
export type { GetResult, ListItem, ListResult } from "./list.js";
export type { PreparedQuery, SearchHit, SearchOptions, SearchResult } from "./search.js";
export type { ProjectStatus } from "./status.js";
export type { IndexResult, LoadedConfig, ParsedDoc, ScanResult, ScannedFile, Section } from "./types.js";
export { validateVirtualPath } from "./virtual-path.js";
