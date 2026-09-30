/** Configuration problem. Carries every error found, so the user fixes them in one go. */
export class ConfigError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join("\n"));
    this.name = "ConfigError";
    this.errors = errors;
  }
}

/** Another `index` run holds the lock. */
export class IndexLockedError extends Error {
  readonly pid: number;

  constructor(pid: number) {
    super(`index is already running (pid ${pid})`);
    this.name = "IndexLockedError";
    this.pid = pid;
  }
}

/** No index next to the config, or one from another schema version: `index` has to run first. */
export class IndexMissingError extends Error {
  /** True when an index exists but has another schema version. */
  readonly outdated: boolean;

  constructor(outdated = false) {
    super("No index. Run: marian-knows index");
    this.name = "IndexMissingError";
    this.outdated = outdated;
  }
}

/** A virtual path given by the user (`--path`, `--exclude-path`, `get`) breaks the syntax rules. */
export class InvalidPathError extends Error {
  readonly path: string;
  readonly problems: string[];

  constructor(path: string, problems: string[]) {
    super(`invalid path '${path}': ${problems.join("; ")}`);
    this.name = "InvalidPathError";
    this.path = path;
    this.problems = problems;
  }
}

/** `get`: the path is not in the index, or its file cannot be read. */
export class DocNotFoundError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = "DocNotFoundError";
    this.path = path;
  }
}
