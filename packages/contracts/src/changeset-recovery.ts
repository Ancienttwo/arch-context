import { digestJson, type Json } from "./schema";
export const CHANGESET_RECOVERY_DETAILS_LIMIT_BYTES = 262144;
export const CHANGESET_RECOVERY_READBACK = "runtimeStatus.changeSetRecovery.unresolvedJournals";
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") throw new Error("Recovery metadata must be own data");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) throw new Error("Recovery metadata cannot contain accessors");
  return descriptor.value;
}
function record(value: unknown, fields: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new Error("Recovery metadata must be a plain record");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key=>typeof key !== "string" || !fields.includes(key))) throw new Error("Recovery metadata has unknown fields");
}
function journalsSnapshot(value: unknown): Json[] {
  if (!Array.isArray(value)) throw new Error("Recovery journals must be an array");
  const length = own(value,"length");
  if (!Number.isSafeInteger(length) || (length as number) < 0 || Reflect.ownKeys(value).length !== (length as number)+1) throw new Error("Recovery journals must be dense own data");
  return Array.from({length: length as number},(_,index)=>{
    const journal=own(value,String(index));
    const fields=["journalId","changeSetId","root","reason"];
    record(journal,fields);
    return Object.fromEntries(fields.map(key=>{
      const item=own(journal,key);
      if(typeof item!=="string") throw new Error("Recovery authority must be strings");
      return [key,item];
    }));
  });
}
/** Complete authority is copied whole. Oversized authority remains available through existing status/health. */
export function changeSetRecoveryDetails(journals: unknown): {[key:string]:Json} {
  const unresolvedJournals=journalsSnapshot(journals);
  const full={unresolvedJournals};
  if(new TextEncoder().encode(JSON.stringify(full)).length<=CHANGESET_RECOVERY_DETAILS_LIMIT_BYTES) return full;
  return {manualRecoveryRequired:true, authorityReadbackRequired:true, authorityReadback:CHANGESET_RECOVERY_READBACK, journalCount:unresolvedJournals.length, authorityDigest:digestJson(unresolvedJournals)};
}
export function changeSetRecoveryDetailsSnapshot(value:unknown): {[key:string]:Json} {
  if(value && typeof value==="object" && Object.hasOwn(value,"unresolvedJournals")) {
    record(value,["unresolvedJournals"]);
    const full={unresolvedJournals:journalsSnapshot(own(value,"unresolvedJournals"))};
    if(new TextEncoder().encode(JSON.stringify(full)).length>CHANGESET_RECOVERY_DETAILS_LIMIT_BYTES) throw new Error("Recovery authority exceeds budget");
    return full;
  }
  const fields=["manualRecoveryRequired","authorityReadbackRequired","authorityReadback","journalCount","authorityDigest"];
  record(value,fields);
  const result=Object.fromEntries(fields.map(key=>[key,own(value,key)]));
  if(result.manualRecoveryRequired!==true || result.authorityReadbackRequired!==true || result.authorityReadback!==CHANGESET_RECOVERY_READBACK || !Number.isSafeInteger(result.journalCount) || (result.journalCount as number)<0 || typeof result.authorityDigest!=="string" || !/^sha256:[a-f0-9]{64}$/.test(result.authorityDigest)) throw new Error("Invalid manual recovery authority reference");
  return result as {[key:string]:Json};
}
