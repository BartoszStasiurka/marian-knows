export {
  CONFIG_ENV,
  CONFIG_FILENAME,
  MAX_NAME_LENGTH,
  findConfig,
  loadConfig,
  validateProjectName,
} from "./config.js";
export { ConfigError } from "./errors.js";
export { initConfig } from "./init.js";
export { INDEX_DIRNAME, INDEX_FILENAME, SCHEMA_VERSION, indexPath, openIndex, rebuildIndex } from "./indexer.js";
export {
  MAX_SECTION_CHARS,
  MIN_SECTION_CHARS,
  decodeMarkdown,
  parseFile,
  parseMarkdown,
  slugify,
} from "./parse.js";
export { MAX_FILE_BYTES, scanSource } from "./scan.js";
export type { IndexResult, LoadedConfig, ParsedDoc, ScanResult, ScannedFile, Section } from "./types.js";
export { validateVirtualPath } from "./virtual-path.js";
