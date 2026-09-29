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
