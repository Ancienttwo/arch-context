export function isArchContextGeneratedProjectionPath(path: string): boolean {
  return path.replace(/\\/g, "/").startsWith(".archcontext/generated/");
}
