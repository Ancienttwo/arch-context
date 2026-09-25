// Source-wiring witnesses only. The readbacks still require independent behavior tests.
// Keep each check inside its known declaration boundaries; a move requires an explicit update.
function functions(source: string): { get(name: string): string | undefined } {
  return { get(name) {
    const matches = [...source.matchAll(new RegExp(`^( *)(?:(?:export )?function |(?:private )?async )${name}\\(`, "gm"))];
    if (matches.length !== 1) return undefined;
    const match = matches[0]!;
    const start = match.index!;
    const end = source.indexOf(`\n${match[1]}}`, start);
    return end < 0 ? undefined : source.slice(start, end + match[1]!.length + 2);
  } };
}

function contains(body: string | undefined, ...witnesses: string[]): boolean {
  return body !== undefined && witnesses.every((witness) => body.includes(witness));
}

export function inspectDataEngineIndexedBacklinks(daemonSource: string, storeSource: string): boolean {
  const daemon = functions(daemonSource).get("buildExplorerProjectionV2");
  const store = functions(storeSource);
  return contains(daemon,
    "this.localStore.readExplorerProjectionInputs({ ...scope, query, plan: readPlan, authorityCursor })",
    "this.localStore.readExplorerProjectionMetadata({",
    "eventBacklinks = planned.eventBacklinks;", "eventBacklinks = ledgerMetadata.eventBacklinks;")
    && !daemon!.includes("listArchitectureEventBacklinks(")
    && !daemonSource.includes("function explorerEventBacklinks(")
    && contains(store.get("readExplorerProjectionInputs"), "readExplorerProjectionInputsFromDb(db, input)")
    && contains(store.get("readExplorerProjectionMetadata"), "readExplorerProjectionMetadataFromDb(db, input)")
    && contains(store.get("readExplorerProjectionInputsFromDb"), "readExplorerProjectionBacklinksFromDb(db, input, selectedSubjectIds)", "eventBacklinks: backlinkRead.items")
    && contains(store.get("readExplorerProjectionMetadataFromDb"), "readExplorerProjectionBacklinksFromDb(db, input, subjectIds)", "eventBacklinks: backlinkRead.items")
    && contains(store.get("readExplorerProjectionBacklinksFromDb"),
      "FROM architecture_event_subjects JOIN architecture_change_feed",
      "architecture_event_subjects.storage_repository_id = ?",
      "architecture_event_subjects.storage_workspace_id = ?",
      "architecture_event_subjects.subject_id IN (${placeholders})",
      "LIMIT ?", ".all(...params, input.plan.limits.maxBacklinks)",
      "record.eventHash !== event.eventHash", "explorer-projection-backlink-authority-mismatch");
}

export function inspectDataEngineRequiredDomains(compilerSource: string, daemonSource: string): boolean {
  const compiler = functions(compilerSource);
  const manifest = compiler.get("compileProjectionInputManifest");
  return contains(manifest,
    'input.observedAvailability?.status === "unavailable"',
    "required-input-unavailable:observed:",
    "const actualGraphDigest = architectureLedgerStateDigest(input.graph)",
    "assertProjectionReadContract(input, actualGraphDigest)",
    'projectionInputDomain("bindings", requirements.bindings, bindingsDigest)')
    && contains(compiler.get("assertProjectionReadContract"),
      "digestJson(input.readPlan as unknown as Json) !== digestJson(canonicalPlan as unknown as Json)",
      "digestJson(readSetWithoutDigest as unknown as Json) !== readSetDigest",
      "input.readSet.selectedGraphDigest !== selectedGraphDigest",
      'throw new ExplorerProjectionCompileError("precondition-failed", "projection-read-plan-mismatch")')
    && contains(compiler.get("projectionInputDomain"), 'digest === null', 'requirement === "required"',
      'throw new ExplorerProjectionCompileError("precondition-failed", `required-input-unavailable:${domain}:not-provided`)')
    && contains(functions(daemonSource).get("buildExplorerProjectionV2"),
      'throw new ExplorerProjectionCompileError("precondition-failed", `required-input-unavailable:observed:${reasonCode}`)')
    && !daemonSource.includes("observed = { task, symbols: [], edges: [], evidence: []");
}

export function inspectDataEngineAuthorityBinding(compilerSource: string, daemonSource: string): boolean {
  const compiler = functions(compilerSource);
  return contains(compiler.get("compileProjectionInputManifest"), "assertAuthorityBinding(input)")
    && contains(compiler.get("assertAuthorityBinding"),
      'input.authoritySource === "git"', "input.authorityCursor !== null",
      "authority-source-cursor-mismatch:git",
      "evidenceCursor.evidenceStateDigest !== input.evidenceStateDigest",
      "required-input-digest-mismatch:evidence-authority",
      "cursor === null || input.evidenceAuthorityCursor === null",
      "required-input-unavailable:authority:ledger-cursor-not-provided",
      "digestJson(cursor.repository as unknown as Json) !== digestJson(input.repository as unknown as Json)",
      "digestJson(cursor.worktree as unknown as Json) !== digestJson(input.worktree as unknown as Json)",
      "digestJson(cursor as unknown as Json) !== digestJson(input.evidenceAuthorityCursor as unknown as Json)",
      "cursor.graphDigest !== input.graphDigest", "cursor.evidenceStateDigest !== input.evidenceStateDigest",
      'throw new ExplorerProjectionCompileError("precondition-failed", "required-input-digest-mismatch:authority")')
    && contains(functions(daemonSource).get("buildExplorerProjectionV2"),
      'this.architectureLedger.readMode === "ledger" && !ledgerAuthority',
      "required-input-unavailable:architecture-ledger:no-current-event",
      'const authoritySource = ledgerAuthority && (this.architectureLedger.readMode === "ledger" || (ledgerMatchesGit && ledgerMatchesGitScope)) ? "ledger" as const : "git" as const',
      'const authorityCursor: AuthorityCursorV1 | null = authoritySource === "ledger" ? ledgerAuthority!.authorityCursor : null',
      "compileProjectionInputManifest(projectionInput)", "authoritySource,", "authorityCursor,", "evidenceAuthorityCursor,");
}
