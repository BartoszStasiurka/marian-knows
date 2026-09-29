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

export interface Section {
  /** Position in the file, from 0. */
  ord: number;
  /** 2 or 3; null for text before the first heading. */
  level: 2 | 3 | null;
  heading: string | null;
  /** Slug of the heading, unique per file; null for text before the first heading. */
  anchor: string | null;
  body: string;
}

export interface ParsedDoc {
  title: string;
  tags: string[];
  /** Whole frontmatter; null when missing or broken. */
  frontmatter: Record<string, unknown> | null;
  sections: Section[];
  warnings: string[];
}

export interface IndexResult {
  /** Files indexed. */
  files: number;
  sections: number;
  /** Compared with the previous index content: new paths, same path with a different hash, paths gone. */
  added: number;
  changed: number;
  removed: number;
  warnings: string[];
}
