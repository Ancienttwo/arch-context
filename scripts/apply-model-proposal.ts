#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import type { ChangeOperation } from "@archcontext/core/changeset-engine";
import { canonicalize, type Json } from "@archcontext/contracts";
import { defaultLocalStorePath } from "@archcontext/local-runtime/local-store-sqlite";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";

export const MODEL_PROPOSAL_SCHEMA_VERSION = "archcontext.model-proposal/v1" as const;
export const MODEL_PROPOSAL_RECEIPT_SCHEMA_VERSION = "archcontext.model-proposal-receipt/v1" as const;

const MODEL_PATH = /^\.archcontext\/model\/(?:nodes|relations|flows)\/[a-z0-9][a-z0-9._-]*\.ya?ml$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_BODY = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i
] as const;

export interface ModelProposalV1 {
  schemaVersion: typeof MODEL_PROPOSAL_SCHEMA_VERSION;
  changeSetId: string;
  taskSessionId: string;
  operations: Array<{
    op: "create_entity" | "update_entity_fields" | "delete_entity";
    path: string;
    entityId: string;
    expectedHash: "missing" | `sha256:${string}`;
    body?: string;
  }>;
}

export interface ModelProposalReceiptV1 {
  schemaVersion: typeof MODEL_PROPOSAL_RECEIPT_SCHEMA_VERSION;
  mode: "preview" | "applied";
  changeSetId: string;
  proposalDigest: `sha256:${string}`;
  worktreeDigest: string;
  modelDigest: string;
  operationCount: number;
  paths: string[];
  status: string;
}

export function parseModelProposal(value: unknown): ModelProposalV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("proposal must be an object");
  const proposal = value as Partial<ModelProposalV1>;
  if (proposal.schemaVersion !== MODEL_PROPOSAL_SCHEMA_VERSION) throw new Error(`proposal schemaVersion must be ${MODEL_PROPOSAL_SCHEMA_VERSION}`);
  if (!isId(proposal.changeSetId)) throw new Error("proposal changeSetId must be a stable id");
  if (!isId(proposal.taskSessionId)) throw new Error("proposal taskSessionId must be a stable id");
  if (!Array.isArray(proposal.operations) || proposal.operations.length === 0) throw new Error("proposal operations must be non-empty");
  const seen = new Set<string>();
  for (const operation of proposal.operations) {
    if (!operation || typeof operation !== "object") throw new Error("proposal operation must be an object");
    if (operation.op !== "create_entity" && operation.op !== "update_entity_fields" && operation.op !== "delete_entity") throw new Error(`unsupported model operation: ${String(operation.op)}`);
    if (!MODEL_PATH.test(operation.path)) throw new Error(`model operation path is outside the model authority: ${operation.path}`);
    if (seen.has(operation.path)) throw new Error(`duplicate model operation path: ${operation.path}`);
    seen.add(operation.path);
    if (!isId(operation.entityId)) throw new Error(`model operation entityId must be a stable id: ${operation.path}`);
    if (operation.expectedHash !== "missing" && !SHA256.test(operation.expectedHash)) throw new Error(`invalid expectedHash: ${operation.path}`);
    if (operation.op === "delete_entity") {
      if (operation.body !== undefined) throw new Error(`delete operation body must be omitted: ${operation.path}`);
    } else {
      const body = operation.body;
      if (typeof body !== "string" || body.trim().length === 0) throw new Error(`model operation body is required: ${operation.path}`);
      if (!body.endsWith("\n")) throw new Error(`model operation body must end with a newline: ${operation.path}`);
      if (FORBIDDEN_BODY.some((pattern) => pattern.test(body))) throw new Error(`model operation body contains forbidden secret material: ${operation.path}`);
    }
  }
  return proposal as ModelProposalV1;
}

export function modelProposalDigest(proposal: ModelProposalV1): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalize(proposal as unknown as Json), "utf8").digest("hex")}`;
}

export function modelProposalReceipt(input: {
  proposal: ModelProposalV1;
  mode: "preview" | "applied";
  worktreeDigest: string;
  modelDigest: string;
  status: string;
}): ModelProposalReceiptV1 {
  return {
    schemaVersion: MODEL_PROPOSAL_RECEIPT_SCHEMA_VERSION,
    mode: input.mode,
    changeSetId: input.proposal.changeSetId,
    proposalDigest: modelProposalDigest(input.proposal),
    worktreeDigest: input.worktreeDigest,
    modelDigest: input.modelDigest,
    operationCount: input.proposal.operations.length,
    paths: input.proposal.operations.map((operation) => operation.path).sort(),
    status: input.status
  };
}

async function main(args: string[]) {
  const repo = resolve(requireFlag(args, "--repo"));
  const proposalPath = resolve(requireFlag(args, "--proposal"));
  if (!existsSync(proposalPath)) throw new Error(`proposal file not found: ${proposalPath}`);
  const proposal = parseModelProposal(JSON.parse(readFileSync(proposalPath, "utf8")));
  const digest = modelProposalDigest(proposal);
  const approved = args.includes("--approved");
  const expectedProposalDigest = readFlag(args, "--expected-proposal-digest");
  const expectedWorktreeDigest = readFlag(args, "--expected-worktree-digest");
  if (approved) {
    if (expectedProposalDigest !== digest) throw new Error("approved apply requires the exact preview proposal digest");
    if (!expectedWorktreeDigest) throw new Error("approved apply requires --expected-worktree-digest");
    if (computeWorktreeDigest(repo) !== expectedWorktreeDigest) throw new Error("worktree changed after proposal preview");
  }
  const daemon = await createStartedDaemon({ localStorePath: defaultLocalStorePath(repo) });
  try {
    const planned = await daemon.planUpdate(repo, {
      id: proposal.changeSetId,
      reason: { taskSessionId: proposal.taskSessionId },
      operations: proposal.operations as ChangeOperation[]
    });
    if (!planned.ok) throw new Error(planned.error?.message ?? "ChangeSet plan failed");
    const draft = planned.data as unknown as { draft: { base: { worktreeDigest: string; modelDigest: string }; status: string } };
    if (!approved) return modelProposalReceipt({ proposal, mode: "preview", ...draft.draft.base, status: draft.draft.status });
    const applied = await daemon.applyUpdate(repo, {
      id: proposal.changeSetId,
      approved: true,
      expectedWorktreeDigest: expectedWorktreeDigest!
    });
    if (!applied.ok) throw new Error(applied.error?.message ?? "ChangeSet apply failed");
    const result = applied.data as unknown as { status?: string };
    return modelProposalReceipt({ proposal, mode: "applied", ...draft.draft.base, status: result.status ?? "applied" });
  } finally {
    await daemon.stop();
  }
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{2,127}$/.test(value);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function requireFlag(args: string[], flag: string): string {
  const value = readFlag(args, flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (receipt) => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`),
    (error) => {
      process.stderr.write(`[apply-model-proposal] ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}
