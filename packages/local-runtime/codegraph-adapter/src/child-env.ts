/**
 * The environment of every CodeGraph child process. CodeGraph runs `git status` in the checkout
 * (`status`, `sync`); without GIT_OPTIONAL_LOCKS=0, git refreshes stale stat data and rewrites
 * .git/index, so a read-only archctx command would change tracked git state.
 */
export function codeGraphChildEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides, GIT_OPTIONAL_LOCKS: "0" };
}
