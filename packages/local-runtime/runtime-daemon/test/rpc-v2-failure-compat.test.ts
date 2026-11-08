import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FailureError, failureIssues, okEnvelope } from "@archcontext/contracts";
import { RuntimeRpcClient } from "../src/rpc-client";
import { ArchctxRuntimeRpcServer } from "../src/rpc-server";
import { frozenV2 } from "./fixtures/runtime-rpc-v2-386d";
const privateText="Authorization=private /private/customer";
test("actual frozen v2 client × candidate server and candidate client × actual frozen v2 server",async()=>{
 const root=mkdtempSync(join(tmpdir(),"archctx-v2-compat-"));
 const old=await frozenV2(root);
 const success=okEnvelope("fixture",{marker:"unchanged"});
 try {
  for(const direction of ["old-client","old-server"]) {
   let running=true, mode="success";
   const known=new FailureError("AC_PRECONDITION_FAILED","projection-manifest-invalid",{}, {severity:"critical",retryable:false,action:"run-diagnostics"});
   const operation=()=>{if(mode==="known") throw known;if(mode==="unknown") throw new Error(privateText);return success;};
   const target={start:async()=>{running=true;},stop:async()=>{running=false;},status:()=>({running}),hasActiveBackgroundWork:async()=>false,compositionReport:()=>({}),egressReport:async()=>({}),applyUpdate:operation};
   const Server=direction==="old-client" ? ArchctxRuntimeRpcServer : old.server.ArchctxRuntimeRpcServer;
   const Client=direction==="old-client" ? old.client.RuntimeRpcClient : RuntimeRpcClient;
   const server=new Server(target as any,{root,lockPath:join(root,direction+".lock"),connectionPath:join(root,direction+".json"),idleTimeoutMs:0});
   const connection=await server.start();const client=new Client(connection);
   try {
    expect(await client.applyUpdate(root,{id:"changeset.fixture",approved:true,expectedWorktreeDigest:`sha256:${"a".repeat(64)}`})).toEqual(success);
    for(const failMode of ["known","unknown"]) {
     mode=failMode;
     const failure=await client.applyUpdate(root,{});
     expect(failure.ok).toBe(false);
     expect(failureIssues(failure.error)).toEqual([]);
     if(direction==="old-client" && failMode==="known") expect(failure.error).toEqual(known.failure);
     else expect(failure.error.code).toBe("AC_UNCLASSIFIED_FAILURE");
     expect(JSON.stringify(failure)).not.toContain(privateText);
    }
    // Negotiation authority is an existing v2 protocol refusal, consumed before domain responses.
    const mismatch=await fetch(connection.url+"rpc",{method:"POST",headers:{Authorization:`Bearer ${connection.token}`,"Content-Type":"application/json"},body:JSON.stringify({schemaVersion:"archcontext.runtime-rpc/v1",method:"applyUpdate",params:[]})});
    expect(mismatch.status).toBe(426);
    expect(await mismatch.json()).toMatchObject({error:"runtime RPC version mismatch",expected:"archcontext.runtime-rpc/v2",received:"archcontext.runtime-rpc/v1",action:"upgrade-archctx-runtime",upgradeCommand:"archctx daemon upgrade"});
   } finally {await server.stop();}
  }
 } finally {rmSync(root,{recursive:true,force:true});}
});
