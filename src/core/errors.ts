/** Configuration problem. Carries every error found, so the user fixes them in one go. */
export class ConfigError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join("\n"));
    this.name = "ConfigError";
    this.errors = errors;
  }
}
