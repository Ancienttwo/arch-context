import type { JsonEnvelope } from "@archcontext/contracts";
import type { DeveloperReviewAttestation, DeveloperReviewRunPreparation } from "../src/index";
import type { RuntimeRpcClient } from "../src/rpc-client";
import type { RuntimeDaemonClient } from "../src/rpc-protocol";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// Public signatures must remain precise when inferred from defaulted table callbacks.
type ContextParameters = Expect<Equal<Parameters<RuntimeDaemonClient["context"]>, [root: string, task: string, maxSymbols?: number]>>;
type PrepareParameters = Expect<Equal<Parameters<RuntimeDaemonClient["prepare"]>, [root: string, task: string, maxBytes?: number, maxItems?: number, taskSessionId?: string]>>;
type ExplorerParameters = Expect<Equal<Parameters<RuntimeDaemonClient["explorerServiceContract"]>, [tokenTtlSeconds?: number]>>;
type LandscapeParameters = Expect<Equal<Parameters<RuntimeDaemonClient["contextLandscape"]>, [task: string, maxSymbols?: number]>>;
type ClientEnvelope = Expect<Equal<ReturnType<RuntimeRpcClient["context"]>, Promise<JsonEnvelope>>>;
type ClientPreparation = Expect<Equal<ReturnType<RuntimeRpcClient["startDeveloperReviewRun"]>, Promise<DeveloperReviewRunPreparation>>>;
type ClientAttestation = Expect<Equal<ReturnType<RuntimeRpcClient["runSignedDeveloperReviewAttestation"]>, Promise<DeveloperReviewAttestation>>>;
