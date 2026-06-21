#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ENV_FILE = "_ops/env/fg2-staging.env";
const REQUIRED_ENV_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_WEBHOOK_SECRET"
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2] ?? "install";
  if (command !== "install") {
    console.error("usage: node deploy/scripts/fg2-staging-secrets.mjs install [--env-file path] [--environment staging] [--dry-run]");
    process.exit(2);
  }
  await installSecrets(parseArgs(process.argv.slice(3)));
}

export async function installSecrets(options = {}) {
  const envFile = options.envFile ?? DEFAULT_ENV_FILE;
  const environment = options.environment ?? "staging";
  const dryRun = options.dryRun === true;
  const env = parseDotenv(await readFile(envFile, "utf8"));
  const privateKeyPath = env.GITHUB_APP_PRIVATE_KEY_PEM_PATH;
  const privateKeyPem = env.GITHUB_APP_PRIVATE_KEY_PEM ?? (privateKeyPath && !dryRun ? await readFile(privateKeyPath, "utf8") : "");
  const secrets = {
    GITHUB_APP_ID: env.GITHUB_APP_ID,
    GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
    GITHUB_APP_PRIVATE_KEY_PEM: privateKeyPem || (dryRun && privateKeyPath ? `<from:${privateKeyPath}>` : "")
  };

  for (const key of REQUIRED_ENV_KEYS) {
    if (!secrets[key]) throw new Error(`missing required env key: ${key}`);
  }
  if (!secrets.GITHUB_APP_PRIVATE_KEY_PEM) {
    throw new Error("missing required env key: GITHUB_APP_PRIVATE_KEY_PEM or GITHUB_APP_PRIVATE_KEY_PEM_PATH");
  }

  for (const [name, value] of Object.entries(secrets)) {
    if (dryRun) {
      console.log(`[fg2-staging-secrets] would install ${name} into Cloudflare env ${environment}`);
      continue;
    }
    const result = spawnSync("wrangler", ["secret", "put", name, "--env", environment, "--config", "wrangler.jsonc"], {
      cwd: resolve(fileURLToPath(new URL("../..", import.meta.url))),
      input: `${value}\n`,
      stdio: ["pipe", "inherit", "inherit"],
      encoding: "utf8"
    });
    if (result.status !== 0) throw new Error(`wrangler secret put failed: ${name}`);
  }
}

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--env-file") {
      options.envFile = requireValue(args[++index], arg);
    } else if (arg === "--environment") {
      options.environment = requireValue(args[++index], arg);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

export function parseDotenv(text) {
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
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n");
  }
  return trimmed;
}

function requireValue(value, flag) {
  if (!value) throw new Error(`missing value for ${flag}`);
  return value;
}
