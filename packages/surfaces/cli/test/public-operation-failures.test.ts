import { expect, test } from "bun:test";
import { failureIssues } from "@archcontext/contracts";
import { runNativeContextCommand } from "../src/native-context";

test("C1 native CLI does not label an unknown reader exception as an observed input refusal", () => {
  const sentinel="/private/native Authorization=private-body";
  const result=runNativeContextCommand(["--worktree"], "/unused", (()=>{throw new Error(sentinel);}) as any);
  expect(result.error?.code).toBe("AC_UNCLASSIFIED_FAILURE");
  expect(result.error?.reasonCode).toBe("failure-unclassified");
  expect(failureIssues(result.error)).toEqual([]);expect(JSON.stringify(result)).not.toContain(sentinel);
});


test("C1 native preflight retains its existing arguments/profile reasons without reading", () => {
  let reads=0;const reader=(()=>{reads++;throw new Error("unexpected read");}) as any;
  for(const [args,reasonCode] of [ [["--worktree","--profile","invalid"],"native-context-profile-invalid"], [["--worktree","--unknown"],"native-context-arguments-invalid"], [["--worktree","unexpected"],"native-context-arguments-invalid"] ] as const) {
    const result=runNativeContextCommand([...args],"/unused",reader);
    expect(result.error).toMatchObject({code:"AC_SCHEMA_INVALID",reasonCode,action:"repair-native-input"});
    expect(failureIssues(result.error)).toEqual([]);
  }
  expect(reads).toBe(0);
});

test("C1 native CLI safely normalizes an uninspectable thrown value", () => {
  const result=runNativeContextCommand(["--worktree"],"/unused",(()=>{const p=Proxy.revocable({},{});p.revoke();throw p.proxy;}) as any);
  expect(result.error?.code).toBe("AC_UNCLASSIFIED_FAILURE");expect(failureIssues(result.error)).toEqual([]);
});
