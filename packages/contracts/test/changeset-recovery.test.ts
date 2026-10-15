import { expect, test } from "bun:test";
import { CHANGESET_RECOVERY_DETAILS_LIMIT_BYTES as LIMIT, changeSetRecoveryDetails, changeSetRecoveryDetailsSnapshot, digestJson, failureEnvelope, failureIssues, knownFailure } from "../src";
const journal = {journalId:"journal."+"j".repeat(300),changeSetId:"changeset."+"c".repeat(300),root:"/root/"+"r".repeat(400),reason:"original failure"};
test("dedicated unresolved authority preserves full IDs, copies data, and retains catalog remedy",()=>{
  const input=[{...journal}];
  const details=changeSetRecoveryDetails(input);
  const failure=knownFailure("AC_PRECONDITION_FAILED","changeset-recovery-unresolved",details);
  expect(failure.details).toEqual({unresolvedJournals:input});
  expect(failure).toMatchObject({action:"rebuild-plan",severity:"warning",retryable:true});
  input[0]!.journalId="mutated";
  expect((failure.details.unresolvedJournals as any[])[0].journalId).toBe(journal.journalId);
  expect(failureIssues(failure)).toEqual([]);
});
test("oversized journals use existing complete readback with a complete digest, never partial IDs",()=>{
  const input=[{...journal,reason:"界".repeat(100000)}];
  const details=changeSetRecoveryDetails(input);
  expect(details).toEqual({manualRecoveryRequired:true,authorityReadbackRequired:true,authorityReadback:"runtimeStatus.changeSetRecovery.unresolvedJournals",journalCount:1,authorityDigest:digestJson(input)});
  const failure=knownFailure("AC_PRECONDITION_FAILED","changeset-recovery-unresolved",details);
  expect(Buffer.byteLength(JSON.stringify(failureEnvelope("recovery",failure)))).toBeLessThan(LIMIT);
  expect(failureIssues(failure)).toEqual([]);
  expect(input[0]!.reason.length).toBe(100000);
});
test("exact UTF8 budget is accepted, one byte over requires full-readback, and no getter runs",()=>{
  const overhead=Buffer.byteLength(JSON.stringify({unresolvedJournals:[{...journal,reason:""}]}));
  const input=[{...journal,reason:"x".repeat(LIMIT-overhead)}];
  expect(changeSetRecoveryDetails(input)).toHaveProperty("unresolvedJournals");
  input[0]!.reason+="x";
  expect(changeSetRecoveryDetails(input)).toHaveProperty("authorityReadbackRequired",true);
  let getters=0;
  const hostile={unresolvedJournals:[Object.defineProperty({...journal},"journalId",{get(){getters++;return "hidden";}})]};
  expect(()=>changeSetRecoveryDetailsSnapshot(hostile)).toThrow();
  expect(getters).toBe(0);
  expect(()=>changeSetRecoveryDetailsSnapshot({unresolvedJournals:[journal],hidden:true})).toThrow();
});
