/**
 * The environment of the CodeGraph `sync` child. CodeGraph runs `git status` in the checkout;
 * without GIT_OPTIONAL_LOCKS=0, git refreshes stale stat data and rewrites .git/index, so archctx
 * would change tracked git state.
 */
export function codeGraphChildEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
}
