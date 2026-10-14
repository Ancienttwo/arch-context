import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
if (process.argv.length !== 6) throw new Error('usage: recompute-migration-audit.ts <engine> <before> <after> <external-output>');
const [engineRoot, oldRoot, newRoot, outputRoot] = process.argv.slice(2).map(path => realpathSync(resolve(path)));
const contains = (root: string, child: string) => { const path = relative(root, child); return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep)); };
if (contains(oldRoot, outputRoot) || contains(newRoot, outputRoot)) throw new Error('output directory must be outside both fixtures');
const { scanDocumentRegions } = await import(join(engineRoot, 'packages/core/projection-engine/src/document-regions.ts'));
const { digestJson } = await import(join(engineRoot, 'packages/contracts/src/schema.ts'));
const { listGitVisibleFiles } = await import(join(engineRoot, 'packages/local-runtime/git-adapter/src/index.ts'));
const { exportNativeContext } = await import(join(engineRoot, 'packages/local-runtime/model-store-yaml/src/native-context.ts'));
const hash = (b: Uint8Array|string) => createHash('sha256').update(b).digest('hex');
const oldManifest = JSON.parse(readFileSync(join(oldRoot, 'docs/architecture/.projection-manifest.json'), 'utf8'));
const afterManifest = JSON.parse(readFileSync(join(newRoot, 'docs/architecture/.projection-manifest.json'), 'utf8'));
const tracked = execFileSync('git', ['--no-optional-locks','-c','core.fsmonitor=false','ls-files','-z'], { cwd: newRoot, encoding: 'utf8', maxBuffer: 8*1024*1024 }).split('\0').filter(Boolean);
const fileRows = tracked.map(path => {
  const before = readFileSync(join(oldRoot,path)); const after = readFileSync(join(newRoot,path));
  return { path, beforeBytes:before.length, afterBytes:after.length, beforeSha256:hash(before), afterSha256:hash(after), byteEqual:before.equals(after) };
});
const changed = fileRows.filter(r=>!r.byteEqual);
const publishedPath = join(outputRoot, 'migration-audit.json');
if (existsSync(publishedPath)) {
  const published = JSON.parse(readFileSync(publishedPath, 'utf8'));
  const actual = fileRows.map(row => [row.path, row.beforeSha256, row.afterSha256, row.beforeBytes, row.afterBytes]);
  if (JSON.stringify(actual) !== JSON.stringify(published.trackedFileHashes)) throw new Error('published before/after hash list differs from fixture bytes');
}
const mixedRows = oldManifest.targets.filter((r:any)=>r.ownership==='mixed').map((target:any)=>{
  const before=readFileSync(join(oldRoot,target.path)); const after=readFileSync(join(newRoot,target.path));
  function human(bytes:Buffer) {
    const scan=scanDocumentRegions(bytes.toString('utf8'),{generatedBodyLiterals:false});
    if(scan.diagnostics.length || scan.generatedRegions.some((r:any)=>!r.closed)) throw new Error('ambiguous regions:'+target.path);
    const regions=scan.humanRegions.map((r:any)=>({startByte:r.startByte,endByte:r.endByte,bytes:bytes.subarray(r.startByte,r.endByte)}));
    return {regions,generatedTargets:scan.generatedRegions.map((r:any)=>r.targetId),body:Buffer.concat(regions.map((r:any)=>r.bytes))};
  }
  const b=human(before),a=human(after);
  if(JSON.stringify(b.generatedTargets)!==JSON.stringify(a.generatedTargets)||b.regions.length!==a.regions.length) throw new Error('region structure changed:'+target.path);
  const regions=b.regions.map((r:any,i:number)=>({ordinal:i,beforeRange:[r.startByte,r.endByte],afterRange:[a.regions[i].startByte,a.regions[i].endByte],beforeBytes:r.bytes.length,afterBytes:a.regions[i].bytes.length,beforeSha256:hash(r.bytes),afterSha256:hash(a.regions[i].bytes),byteEqual:r.bytes.equals(a.regions[i].bytes)}));
  return {path:target.path,targetId:target.targetId,ownership:target.ownership,beforeHumanBytes:b.body.length,afterHumanBytes:a.body.length,beforeHumanSha256:hash(b.body),afterHumanSha256:hash(a.body),byteEqual:b.body.equals(a.body),regions};
});
if(changed.some(r=>!r.path.startsWith('docs/architecture/'))||mixedRows.some((r:any)=>!r.byteEqual||r.regions.some((x:any)=>!x.byteEqual))) throw new Error('byte preservation failed');
// Both native reads are stateless. The old payload is derived from the fixed public Git ref;
// its worktree/ref snapshot tag is outside the business payloads compared below.
const beforeExport=exportNativeContext(newRoot,{source:'ref',ref:'90cd97fb84fb92e242c70f8f7f1a6eb4411d9a49'});
const afterExport=exportNativeContext(newRoot,{source:'worktree'});
const nativeRows=['model','capabilityProfiles','contracts'].map(key=>({key,beforeDigest:digestJson(beforeExport[key]),afterDigest:digestJson(afterExport[key]),jsonEqual:JSON.stringify(beforeExport[key])===JSON.stringify(afterExport[key])}));
if(nativeRows.some(r=>!r.jsonEqual)) throw new Error('native payloads changed');
const hasRaw = existsSync(join(outputRoot,'d5-benchmark-before-migrated.json'));
const previewRuns = hasRaw ? undefined : JSON.parse(readFileSync(join(outputRoot,'samples-allowlist.json'),'utf8')).runs;
const beforeRun=hasRaw ? JSON.parse(readFileSync(join(outputRoot,'d5-benchmark-before-migrated.json'),'utf8')) : previewRuns.find((r:any)=>r.phase==='before');
const afterRun=hasRaw ? JSON.parse(readFileSync(join(outputRoot,'d5-benchmark-after-migrated.json'),'utf8')) : previewRuns.find((r:any)=>r.phase==='after');
const visible = listGitVisibleFiles(newRoot);
const inputFingerprint=digestJson(visible.map((path:string)=>({path,hash:hash(readFileSync(join(newRoot,path)))})));
const sampleRows=[beforeRun,afterRun].flatMap(run=>run.samples.map((s:any)=>({phase:run.phase,subject:s.subject,kind:s.kind,index:s.index,engineSha:s.engineSha,repoSha:s.repoSha,inputFingerprint:s.inputFingerprint,changedPaths:s.changedPaths??(s.kind==='edit'?run.subjects.find((d:any)=>d.name===s.subject).paths:[]),elapsedNs:s.elapsedNs,elapsedMs:s.elapsedMs,reportDigest:s.report?.digest??s.reportDigest,coverage:s.report?.coverage??s.coverage,exitCode:s.exitCode,parity:s.parity,valid:s.valid,bytesUnchanged:s.bytesUnchanged})));
const lockedSubjects = beforeRun.fixtureLock?.subjects ?? beforeRun.fixtureSubjects;
const sameBinding=sampleRows.every(r=>{
  const locked=lockedSubjects.find((s:any)=>s.name===r.subject);
  const expectedEngine=r.phase==='before'?'a697adad7bf686f309405d7a9feef8173d8140a5':'dabf86ab93cfea3566df0a994754086d5104e4a6';
  return locked && r.inputFingerprint===locked.inputFingerprint && r.repoSha===locked.repoSha && r.engineSha===expectedEngine;
}) && sampleRows.filter(r=>r.subject==='representative').every(r=>r.inputFingerprint===inputFingerprint);
if(!sameBinding||sampleRows.length!==32||JSON.stringify(beforeRun.fixtureLock??beforeRun.fixtureSubjects)!==JSON.stringify(afterRun.fixtureLock??afterRun.fixtureSubjects)) throw new Error('sample binding failed');
const report={schemaVersion:'d5.readonly-recomputed-audit/v1',sourceSha:'90cd97fb84fb92e242c70f8f7f1a6eb4411d9a49',identity:'90cd97fb + audited supported v3 migration',recomputedAt:new Date().toISOString(),inputFingerprint,trackedFileCount:tracked.length,changedPaths:changed,allNonArchitectureFilesByteEqual:fileRows.filter(r=>!r.path.startsWith('docs/architecture/')).every(r=>r.byteEqual),nonArchitectureFileCount:fileRows.filter(r=>!r.path.startsWith('docs/architecture/')).length,modelFileCount:fileRows.filter(r=>r.path.startsWith('.archcontext/')).length,modelFiles:fileRows.filter(r=>r.path.startsWith('.archcontext/')),mixedDocuments:mixedRows,nativePayloads:nativeRows,generatedOwnership:oldManifest.targets.filter((r:any)=>r.ownership==='generated').map((r:any)=>({path:r.path,targetId:r.targetId,ownership:r.ownership})),manifestBefore:{schemaVersion:oldManifest.schemaVersion,rendererVersion:oldManifest.rendererVersion},manifestAfter:{schemaVersion:afterManifest.schemaVersion,rendererVersion:afterManifest.rendererVersion},allSamples:sampleRows,allSamplesBound:true};
writeFileSync(join(outputRoot,'d5-recomputed-migration-audit.json'),JSON.stringify(report,null,2)+'\n');
writeFileSync(join(outputRoot,'d5-recomputed-all-file-hashes.json'),JSON.stringify({sourceSha:report.sourceSha,inputFingerprint,rows:fileRows},null,2)+'\n');
console.log(JSON.stringify({trackedFileCount:tracked.length,changedPaths:changed.length,nonArchitectureFiles:report.nonArchitectureFileCount,modelFiles:report.modelFileCount,mixedDocuments:mixedRows.length,humanRegions:mixedRows.reduce((n:number,r:any)=>n+r.regions.length,0),allSamples:sampleRows.length,inputFingerprint,nativePayloads:nativeRows}));
