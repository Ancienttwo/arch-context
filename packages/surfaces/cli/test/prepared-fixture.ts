import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A repository that several cases of one test file start from, built on first use and copied into
 * each case's own root. No case writes to the template, so test order cannot change an outcome.
 * Only for fixtures whose bytes do not name their own path.
 */
export function preparedFixture(prefix: string, build: (root: string) => void | Promise<void>) {
  let template: Promise<string> | undefined;
  const create = async () => {
    const root = mkdtempSync(join(tmpdir(), prefix));
    try {
      await build(root);
      return root;
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  };
  return {
    async copyTo(root: string): Promise<void> {
      template ??= create();
      cpSync(await template, root, { recursive: true });
    },
    async dispose(): Promise<void> {
      const built = await template?.catch(() => undefined);
      if (built) rmSync(built, { recursive: true, force: true });
    }
  };
}
