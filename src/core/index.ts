export {
  CONFIG_ENV,
  CONFIG_FILENAME,
  DEFAULT_SYNC_MINUTES,
  MAX_DESCRIPTION_LENGTH,
  MAX_SYNC_MINUTES,
  MAX_NAME_LENGTH,
  findConfig,
  loadConfig,
  validateProjectName,
} from "./config.js";
export {
  ConfigError,
  DocNotFoundError,
  GitError,
  IndexLockedError,
  IndexMissingError,
  InvalidPathError,
  TokenError,
} from "./errors.js";
export { hasTag, inScope, matchesPath, validateScope } from "./filter.js";
export { fold } from "./fold.js";
export { initConfig } from "./init.js";
export { GET_MAX_CHARS, NOTICE_MAX_ANCHORS, get, getDoc, getSection, parseDocRef } from "./get.js";
export { list } from "./list.js";
export {
  DEFAULT_LOG_DAYS,
  LOG_DIRNAME,
  LOG_RETENTION_DAYS,
  LOG_TOP,
  NO_LOG_ENV,
  isSessionEntry,
  logDir,
  logAccess,
  logDisabled,
  logQuery,
  logSession,
  readQueryLog,
} from "./log.js";
export {
  INDEX_DIRNAME,
  INDEX_FILENAME,
  LOCK_FILENAME,
  SCHEMA_VERSION,
  acquireIndexLock,
  destroyIndex,
  indexDir,
  indexDirName,
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
export { redactUrl, syncGitSource } from "./git.js";
export { refreshIndex, startIndexRefresh } from "./refresh.js";
export {
  DEFAULT_LIMIT,
  FALLBACK_THRESHOLD,
  MIN_STEM,
  RANK_WEIGHTS,
  SNIPPET_CHARS,
  SNIPPET_CONTEXT,
  STOP_WORDS,
  TRIM_CHARS,
  prepareQuery,
  search,
} from "./search.js";
export { status } from "./status.js";
export {
  LAST_USE_FLUSH_MS,
  TOKEN_PREFIX,
  TOKENS_ENV,
  TOKENS_FILE_VERSION,
  TokenVerifier,
  addToken,
  hashToken,
  listTokens,
  readTokens,
  revokeToken,
  tokensPath,
} from "./tokens.js";
export type { DocFilterOptions } from "./filter.js";
export type { GitSyncResult } from "./git.js";
export type { IndexOptions } from "./indexer.js";
export type { IndexRefresher, RefreshOptions, RefreshResult, RefreshScheduleOptions } from "./refresh.js";
export type { DocRef, GetOptions, GetResult } from "./get.js";
export type { ListItem, ListResult } from "./list.js";
export type {
  AccessDenial,
  AccessLogEntry,
  AccessRecord,
  ClientInfo,
  LogEntry,
  LogOp,
  LogSource,
  QueryLogEntry,
  QueryRecord,
  ReadLogOptions,
  ReadLogResult,
  SessionLogEntry,
  SessionOp,
  SessionRecord,
} from "./log.js";
export type { PreparedQuery, SearchHit, SearchOptions, SearchResult } from "./search.js";
export type { ProjectStatus } from "./status.js";
export type { TokenEntry, TokenInfo } from "./tokens.js";
export type { GitSource, IndexResult, LoadedConfig, ParsedDoc, ScanResult, ScannedFile, Section } from "./types.js";
export { validateVirtualPath } from "./virtual-path.js";
