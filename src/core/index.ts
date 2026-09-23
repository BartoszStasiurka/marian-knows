export { CONFIG_ENV, CONFIG_FILENAME, findConfig, loadConfig } from "./config.js";
export { ConfigError } from "./errors.js";
export { MAX_FILE_BYTES, scanMounts } from "./scan.js";
export type { LoadedConfig, Mount, ScanResult, ScannedFile } from "./types.js";
export { validateVirtualPath } from "./virtual-path.js";
