export interface LoadedConfig {
  configPath: string;
  configDir: string;
  /** Project identifier, trimmed. Metadata only for now. */
  name: string;
  /** Absolute source directory on disk. Never stored in the index. */
  sourceDir: string;
  sourceExists: boolean;
  exclude: string[];
}

export interface ScannedFile {
  virtualPath: string;
  diskPath: string;
  size: number;
}

export interface ScanResult {
  files: ScannedFile[];
  warnings: string[];
}
