export {
  CONFIG_ENV,
  CONFIG_FILENAME,
  MAX_NAME_LENGTH,
  findConfig,
  loadConfig,
  validateProjectName,
} from "./config.js";
export { ConfigError } from "./errors.js";
export { MAX_FILE_BYTES, scanSource } from "./scan.js";
export type { LoadedConfig, ScanResult, ScannedFile } from "./types.js";
export { validateVirtualPath } from "./virtual-path.js";
