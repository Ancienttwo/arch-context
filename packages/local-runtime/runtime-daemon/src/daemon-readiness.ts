import { statSync } from "node:fs";

export type DaemonReadiness =
  | { ready: true }
  | { ready: false; code: "AC_RUNTIME_UNAVAILABLE"; reasonCode: "daemon-root-missing" };

/** Probe the captured start root, never the process cwd (which the foreground CLI relocates). */
export function daemonReadiness(root: string): DaemonReadiness {
  try {
    if (statSync(root).isDirectory()) return { ready: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
  }
  return { ready: false, code: "AC_RUNTIME_UNAVAILABLE", reasonCode: "daemon-root-missing" };
}
