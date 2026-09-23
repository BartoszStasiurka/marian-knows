export interface Mount {
  /** Virtual path key, e.g. "/server/" (dir) or "/README.md" (file). */
  key: string;
  /** Derived from the key: trailing "/" means directory. */
  kind: "file" | "dir";
  /** Absolute path on disk. Never stored in the index. */
  diskPath: string;
  exists: boolean;
  recursive: boolean;
  exclude: string[];
}

export interface LoadedConfig {
  configPath: string;
  configDir: string;
  mounts: Mount[];
}

export interface ScannedFile {
  virtualPath: string;
  diskPath: string;
  mountKey: string;
  size: number;
}

export interface ScanResult {
  files: ScannedFile[];
  warnings: string[];
}
