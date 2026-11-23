import { openScratchReadOnlyCodeGraph, type CodeGraphReadProvider, type CodeGraphReadSessionOpenV1 } from "./read-session";

/**
 * Opens an isolated read-only copy of the workspace CodeGraph index so SQLite creates zero
 * `-wal`, `-shm`, or `.gitignore` sidecars inside the workspace.
 */
export function withWorkspaceReadOnlyCodeGraph<T>(root: string, read: (opened: CodeGraphReadSessionOpenV1) => T, readProvider?: CodeGraphReadProvider): T {
  const opened = openScratchReadOnlyCodeGraph(root, readProvider);
  try { return read(opened); }
  finally { if (opened.state === "open") opened.session.close(); }
}
