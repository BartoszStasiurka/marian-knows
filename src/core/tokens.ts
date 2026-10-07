import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { validateProjectName } from "./config.js";
import { TokenError } from "./errors.js";
import type { LoadedConfig } from "./types.js";

/** Overrides the tokens file path. */
export const TOKENS_ENV = "MARIAN_KNOWS_TOKENS";
export const TOKENS_FILE_VERSION = 1;
export const TOKEN_PREFIX = "mk_";
/** Last use is written to the file at most this often. */
export const LAST_USE_FLUSH_MS = 60_000;
/** A lock older than this is left over from a killed process. */
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

const TokenEntrySchema = z
  .object({
    name: z.string(),
    /** SHA-256 of the token, hex. */
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
  })
  .strict();

const TokensFileSchema = z.object({ version: z.number().int(), tokens: z.array(TokenEntrySchema) }).strict();

export type TokenEntry = z.infer<typeof TokenEntrySchema>;
/** What `token list` shows: never the token, never its hash. */
export type TokenInfo = Omit<TokenEntry, "hash">;

/**
 * Disk path of the tokens file: `<config name>.tokens.json` next to the config, outside `.marian-knows/`,
 * so `destroy` does not revoke everyone. `MARIAN_KNOWS_TOKENS` overrides it.
 */
export function tokensPath(config: LoadedConfig, env: NodeJS.ProcessEnv = process.env): string {
  const given = env[TOKENS_ENV];
  if (given) return path.resolve(config.configDir, given);
  return path.join(config.configDir, `${path.parse(config.configPath).name}.tokens.json`);
}

export const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** Reads the tokens file; a missing file is an empty list. Another `version` is an error, never a guess. */
export function readTokens(file: string): TokenEntry[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    const reason = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
    throw new TokenError(`cannot read tokens file ${file} (${reason})`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new TokenError(`tokens file is not valid JSON: ${file}`);
  }
  const version = (data as { version?: unknown } | null)?.version;
  if (version !== TOKENS_FILE_VERSION) {
    throw new TokenError(`tokens file ${file} has version ${String(version)}; this marian-knows reads version 1`);
  }
  const parsed = TokensFileSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new TokenError(`invalid tokens file ${file}: ${issue.path.join(" > ") || "(root)"}: ${issue.message}`);
  }
  return parsed.data.tokens;
}

/** Writes the whole file atomically (temp file + rename), readable by the owner only. */
function writeTokens(file: string, tokens: TokenEntry[]): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: TOKENS_FILE_VERSION, tokens }, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Read-modify-write under `<file>.lock`: `token add` (e.g. over `docker compose exec`) and the server's last-use
 * flush both rewrite the file, and without the lock one would drop the other's change.
 */
function updateTokens<T>(file: string, change: (tokens: TokenEntry[]) => T): T {
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new TokenError(`cannot lock tokens file ${file} (${(e as NodeJS.ErrnoException).code})`);
      }
    }
    try {
      if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock);
    } catch {
      // Released meanwhile.
    }
    if (Date.now() > deadline) throw new TokenError(`tokens file is locked: ${lock}`);
    sleep(20);
  }
  try {
    const tokens = readTokens(file);
    const result = change(tokens);
    writeTokens(file, tokens);
    return result;
  } finally {
    unlinkSync(lock);
  }
}

function checkName(raw: string): string {
  const problems = validateProjectName(raw);
  if (problems.length) throw new TokenError(`invalid token name: ${problems.join("; ")}`);
  return raw.trim();
}

/** Creates a token for `name` and returns it; only its SHA-256 is stored, so this is the one time it is seen. */
export function addToken(file: string, rawName: string, now: Date = new Date()): string {
  const name = checkName(rawName);
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  updateTokens(file, (tokens) => {
    if (tokens.some((t) => t.name === name)) throw new TokenError(`a token named '${name}' already exists`);
    tokens.push({ name, hash: hashToken(token), createdAt: now.toISOString(), lastUsedAt: null });
  });
  return token;
}

/** Tokens without their hashes, in file (creation) order. */
export function listTokens(file: string): TokenInfo[] {
  return readTokens(file).map(({ hash: _hash, ...info }) => info);
}

/** Removes the token; a running server rejects it from the next request on. */
export function revokeToken(file: string, rawName: string): void {
  const name = rawName.trim();
  updateTokens(file, (tokens) => {
    const i = tokens.findIndex((t) => t.name === name);
    if (i < 0) throw new TokenError(`no token named '${name}'`);
    tokens.splice(i, 1);
  });
}

/**
 * Checks bearer tokens for the HTTP server. Re-reads the file when it changes on disk, so `token add` and
 * `token revoke` from another process apply from the next request on. Last use is kept in memory and written
 * at most once per `LAST_USE_FLUSH_MS`.
 */
export class TokenVerifier {
  readonly file: string;
  private tokens: { name: string; hash: Buffer }[] = [];
  private stamp = "";
  private pending = new Map<string, { hash: string; at: string }>();
  private lastFlush = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly onWarning: (warning: string) => void;

  constructor(file: string, onWarning: (warning: string) => void = () => {}) {
    this.file = file;
    this.onWarning = onWarning;
    this.reload();
  }

  /** Number of tokens currently accepted. */
  get size(): number {
    this.reload();
    return this.tokens.length;
  }

  /** Name of the token, or null when it is unknown or revoked. */
  verify(token: string, now: Date = new Date()): string | null {
    this.reload();
    const hash = Buffer.from(hashToken(token), "hex");
    let match: { name: string; hash: Buffer } | null = null;
    // Every stored hash is compared, in constant time each.
    for (const t of this.tokens) if (timingSafeEqual(t.hash, hash)) match = t;
    if (!match) return null;
    this.pending.set(match.name, { hash: match.hash.toString("hex"), at: now.toISOString() });
    this.scheduleFlush();
    return match.name;
  }

  /** Writes pending last-use dates now; for shutdown. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.size) return;
    const pending = this.pending;
    this.pending = new Map();
    this.lastFlush = Date.now();
    try {
      updateTokens(this.file, (tokens) => {
        for (const t of tokens) {
          // Same name and hash: a token revoked and re-added under the same name keeps its own dates.
          const use = pending.get(t.name);
          if (use && use.hash === t.hash) t.lastUsedAt = use.at;
        }
      });
    } catch (e) {
      this.onWarning(`cannot record token use (${(e as Error).message})`);
    }
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.lastFlush + LAST_USE_FLUSH_MS - Date.now());
    this.timer = setTimeout(() => this.flush(), wait);
    this.timer.unref();
  }

  /**
   * Re-reads the file when its inode, size or mtime changed. A file that cannot be read accepts no token
   * (fails closed), with one warning per change.
   */
  private reload(): void {
    let stamp: string;
    try {
      const st = statSync(this.file);
      stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch (e) {
      stamp = (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
    }
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    try {
      this.tokens = readTokens(this.file).map((t) => ({ name: t.name, hash: Buffer.from(t.hash, "hex") }));
    } catch (e) {
      this.tokens = [];
      this.onWarning(`${(e as Error).message}; every request is rejected until it is fixed`);
    }
  }
}
