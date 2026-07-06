import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org/";

const NPMRC_TEMP_PREFIX = "archctx-npm-publish-npmrc.";
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

/**
 * Run `callback` with an npm-flavored env that carries a short-lived,
 * token-scoped npmrc when a publish token is available. The temp npmrc
 * directory is always removed before this function returns or throws,
 * including when the process receives SIGINT/SIGTERM while the callback
 * is in flight. If the callback throws an error whose message or stack
 * happens to contain the raw token, the rethrown error has the token
 * replaced with "[REDACTED]" so it never reaches a log or console.
 *
 * envFilePath: path to a dotenv file with NPM_TOKEN/NODE_AUTH_TOKEN/CI_TOKEN, or
 * null/undefined to resolve the token from `baseEnv` only.
 * callback: receives the env object to pass as `spawnSync(..., { env })`.
 */
export async function withNpmPublishCredentials(envFilePath, callback, options = {}) {
  const { registry = DEFAULT_NPM_REGISTRY, baseEnv = process.env } = options;
  const env = { ...baseEnv };

  if (env.NPM_CONFIG_USERCONFIG) {
    return callback(env);
  }

  const token = resolveNpmToken(envFilePath, baseEnv);
  if (!token) {
    return callback(env);
  }

  const npmrcDir = mkdtempSync(join(tmpdir(), NPMRC_TEMP_PREFIX));
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(npmrcDir, { recursive: true, force: true });
  };
  const removeSignalHandlers = installSignalCleanup(cleanup);

  try {
    const npmrcPath = join(npmrcDir, "npmrc");
    writeFileSync(npmrcPath, `//registry.npmjs.org/:_authToken=${token}\nregistry=${registry}\n`, "utf8");
    chmodSync(npmrcPath, 0o600);
    env.NPM_CONFIG_USERCONFIG = npmrcPath;
    return await callback(env);
  } catch (error) {
    throw maskTokenInError(error, token);
  } finally {
    cleanup();
    removeSignalHandlers();
  }
}

function resolveNpmToken(envFilePath, baseEnv) {
  const fromEnv = baseEnv.NODE_AUTH_TOKEN || baseEnv.CI_TOKEN || baseEnv.NPM_TOKEN;
  if (fromEnv) return fromEnv;
  if (!envFilePath) return "";
  const dotenv = parseDotenv(readFileSync(envFilePath, "utf8"));
  return dotenv.NODE_AUTH_TOKEN || dotenv.CI_TOKEN || dotenv.NPM_TOKEN || "";
}

function installSignalCleanup(cleanup) {
  const handlers = {};
  for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
    const handler = () => {
      cleanup();
      process.exit(SIGNAL_EXIT_CODES[signal]);
    };
    handlers[signal] = handler;
    process.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of Object.entries(handlers)) {
      process.removeListener(signal, handler);
    }
  };
}

function maskTokenInError(error, token) {
  if (!token) return error;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
  if (!message.includes(token) && !stack.includes(token)) return error;
  const masked = new Error(message.split(token).join("[REDACTED]"));
  if (error instanceof Error) masked.name = error.name;
  if (stack) masked.stack = stack.split(token).join("[REDACTED]");
  return masked;
}

function parseDotenv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) throw new Error(`invalid dotenv line: ${line}`);
    env[match[1]] = unquote(match[2] ?? "");
  }
  return env;
}

function unquote(value) {
  const trimmed = String(value).trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n");
  }
  return trimmed;
}
