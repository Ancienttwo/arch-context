import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const FORBIDDEN_CAPTURE_KEYS = new Set([
  "sourceCode",
  "source_code",
  "sourceBody",
  "source_body",
  "diff",
  "diffBody",
  "diff_body",
  "symbolPayload",
  "symbol_payload",
  "codegraph",
  "codeGraph",
  "architectureModelBody",
  "architecture_model_body",
  "findingDetail",
  "finding_detail",
  "embedding",
  "fileBody",
  "file_body",
  "modelBody",
  "model_body",
  "findings"
]);

export const FORBIDDEN_CAPTURE_VALUE_PATTERNS = [
  /source\s*code/i,
  /diff\s*body/i,
  /symbol\s*payload/i,
  /architecture\s*model\s*body/i,
  /finding\s*detail/i,
  /codegraph/i,
  /\/Users\/[^/\s]+\/Projects\//,
  /file:\/\/\//i,
  /Bearer\s+(?!\[REDACTED\])/i,
  /(access|refresh|secret|token)_[A-Za-z0-9_-]+/
];

export async function auditCaptureFile(path) {
  const capture = JSON.parse(await readFile(path, "utf8"));
  return auditPacketCapture(capture);
}

export async function digestFile(path) {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}

export function auditPacketCapture(capture) {
  const entries = normalizeCaptureEntries(capture);
  const findings = [];
  let checkedValues = 0;
  for (const entry of entries) {
    checkedValues += inspectValue(entry.payload, entry.id, "$", findings);
  }
  return { ok: findings.length === 0, entries: entries.length, checkedValues, findings };
}

export function normalizeCaptureEntries(capture) {
  if (capture && typeof capture === "object" && "log" in capture) {
    const entries = capture.log?.entries ?? [];
    return entries.map((entry, index) => ({ id: `har.entries[${index}]`, payload: projectHarEntry(entry) }));
  }
  if (Array.isArray(capture)) {
    return capture.map((entry, index) => ({ id: `entries[${index}]`, payload: entry }));
  }
  return [{ id: "capture", payload: capture }];
}

function projectHarEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;
  return {
    request: {
      method: entry.request?.method,
      url: entry.request?.url,
      headers: entry.request?.headers,
      postData: entry.request?.postData?.text
    },
    response: {
      status: entry.response?.status,
      headers: entry.response?.headers,
      content: entry.response?.content?.text
    }
  };
}

function inspectValue(value, entry, path, findings) {
  if (value === null || value === undefined) return 0;
  let checked = 1;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      checked += inspectValue(item, entry, `${path}[${index}]`, findings);
    });
    return checked;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_CAPTURE_KEYS.has(key)) {
        findings.push({ entry, path: childPath, pattern: `key:${key}`, valuePreview: preview(child) });
      }
      checked += inspectValue(child, entry, childPath, findings);
    }
    return checked;
  }
  if (typeof value === "string") {
    for (const pattern of FORBIDDEN_CAPTURE_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        findings.push({ entry, path, pattern: pattern.toString(), valuePreview: preview(value) });
      }
    }
  }
  return checked;
}

function preview(value) {
  return JSON.stringify(value).slice(0, 120);
}
