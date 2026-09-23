export const MAX_VIRTUAL_PATH_LENGTH = 512;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Validates the syntax shared by mount keys and (later) --path scopes.
 * Returns a list of problems; empty list means valid.
 * The trailing-slash rule (dir vs file) is checked by the caller.
 */
export function validateVirtualPath(p: string): string[] {
  const errors: string[] = [];

  if (p.length > MAX_VIRTUAL_PATH_LENGTH) {
    errors.push(`longer than ${MAX_VIRTUAL_PATH_LENGTH} characters`);
  }
  if (!p.startsWith("/")) errors.push("must start with '/'");
  if (p.includes("\\")) errors.push("must not contain '\\'");
  if (CONTROL_CHARS.test(p)) errors.push("must not contain control characters");
  if (p !== p.normalize("NFC")) errors.push("must be Unicode NFC");
  if (p.includes("//")) errors.push("must not contain empty segments ('//')");

  for (const segment of p.split("/")) {
    if (segment === "") continue;
    if (segment === "." || segment === "..") {
      errors.push(`forbidden segment '${segment}'`);
    } else if (segment !== segment.trim()) {
      errors.push(`segment '${segment}' has leading or trailing whitespace`);
    }
  }
  return errors;
}
