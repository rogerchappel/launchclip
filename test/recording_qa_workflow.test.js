import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRecordingQa } from "../src/recording_qa_workflow.js";
import { recordingQaEvidenceHash } from "../src/recording_qa.js";

function source(){return {words:[{word:"Build",start:1,end:1.4},{word:"useful",start:1.4,end:1.8},{word:"things.",start:1.8,end:2.2}]};}
function plan(start=1.1){return {schema_version:"launchclip.recording-edit.v1",source_duration_seconds:3,duration_seconds:2.2-start,kept_segments:[{source_start_seconds:start,source_end_seconds:2.2,start_seconds:0,end_seconds:2.2-start}],removed_segments:[{source_start_seconds:0,source_end_seconds:start,reason:"waveform-silence"},{source_start_seconds:2.2,source_end_seconds:3,reason:"silence"}],words:source().words.map((w,i)=>({...w,start:(i===0?start:w.start)-start,end:w.end-start})),text:"Build useful things."};}
async function fixture(){const directory=await mkdtemp(path.join(os.tmpdir(),"launchclip-qa-loop-"));let renders=0,transcriptions=0,renderedPlan;const options={directory,requestHash:"stable-request",sourceTranscript:source()};const adapters={editRecording:async(_input,output,p)=>{renders++;renderedPlan=p;await writeFile(output,`candidate-${renders}`);return {rendered_duration_seconds:p.duration_seconds};},transcribeRendered:async()=>{transcriptions++;return {words:renderedPlan.words};},analyzeRecordingJoins:async()=>({checked:true,issues:[]})};return {directory,options,adapters,renders:()=>renders,transcriptions:()=>transcriptions};}
function review(p,actual,options){return {evidence_hash:recordingQaEvidenceHash(p,actual,options.mediaSha256,options.sourceTranscript,options.acoustic),coverage_complete:true,findings:[],transcript_resolutions:[],acoustic_resolutions:[]};}

test("missing coherence coverage preserves candidate without claiming QA passed",async()=>{
 const f=await fixture();const result=await runRecordingQa("source.mov",plan(1),f.options,f.adapters);
 assert.equal(result.status,"needs-semantic-review");assert.equal(result.report.checks.coherence,"pending");assert.equal(f.renders(),1);assert.equal(f.transcriptions(),1);
 const session=JSON.parse(await readFile(result.files.qa_session,"utf8"));assert.equal(session.status,"needs-semantic-review");
});
test("active agent receipt resumes same candidate without rendering or transcription",async()=>{
 const f=await fixture();const p=plan(1);const pending=await runRecordingQa("source.mov",p,f.options,f.adapters);
 const actual=JSON.parse(await readFile(pending.files.rendered_transcript,"utf8"));const acoustic=JSON.parse(await readFile(pending.files.acoustic,"utf8"));
 const decisions={reviews:[review(p,actual,{mediaSha256:pending.report.media_sha256,sourceTranscript:source(),acoustic})]};
 const passed=await runRecordingQa("source.mov",p,{...f.options,decisions},f.adapters);
 assert.equal(passed.status,"passed");assert.equal(f.renders(),1);assert.equal(f.transcriptions(),1);
});
test("independent ASR disagreement at a source-word cut restores it then re-renders and rechecks",async()=>{
 const f=await fixture();f.adapters.transcribeRendered=async()=>({words:f.renders()===1?plan().words.slice(1):plan(1).words});f.adapters.identifyRecordingCoherence=async(p,actual,options)=>review(p,actual,options);
 const result=await runRecordingQa("source.mov",plan(),f.options,f.adapters);
 assert.equal(result.status,"passed");assert.equal(result.attempts,2);assert.equal(f.renders(),2);assert.equal(result.plan.kept_segments[0].source_start_seconds,1);
 const session=JSON.parse(await readFile(result.files.qa_session,"utf8"));assert.ok(session.attempts[0].repair.applied[0].applied_seconds>0);
});
test("rejected take protection blocks expansion and never loops or reports success",async()=>{
 const f=await fixture();f.adapters.transcribeRendered=async()=>({words:plan().words.slice(1)});f.adapters.identifyRecordingCoherence=async(p,actual,options)=>review(p,actual,options);
 const result=await runRecordingQa("source.mov",plan(),{...f.options,protectedCuts:[{source_start_seconds:1,source_end_seconds:1.1}]},f.adapters);
 assert.equal(result.status,"needs-attention");assert.equal(result.report.stop_reason,"no-safe-repair");assert.equal(f.renders(),1);assert.ok(result.report.repair.rejected.length);
});
test("attempt limit preserves unresolved findings",async()=>{
 const f=await fixture();f.adapters.transcribeRendered=async()=>({words:plan().words.slice(1)});
 const result=await runRecordingQa("source.mov",plan(),{...f.options,maxAttempts:1},f.adapters);
 assert.equal(result.status,"needs-attention");assert.equal(result.report.stop_reason,"repair-attempt-limit");assert.equal(f.renders(),1);
});
test("modified media and changed settings cannot reuse candidate evidence",async()=>{
 const f=await fixture();const p=plan(1);const result=await runRecordingQa("source.mov",p,f.options,f.adapters);
 await writeFile(result.files.media,"tampered");await assert.rejects(()=>runRecordingQa("source.mov",p,f.options,f.adapters),/artifact changed/);
 await assert.rejects(()=>runRecordingQa("source.mov",p,{...f.options,requestHash:"new-input"},f.adapters),/different input/);
});
test("coherence blockers preserve candidate with timed findings and no speculative deletion",async()=>{
 const f=await fixture();f.adapters.identifyRecordingCoherence=async(p,actual,options)=>({...review(p,actual,options),findings:[{kind:"missing-context",start_seconds:0,end_seconds:.4,explanation:"A reference has no antecedent in the source evidence."}]});
 const result=await runRecordingQa("source.mov",plan(1),f.options,f.adapters);
 assert.equal(result.status,"needs-attention");assert.equal(f.renders(),1);assert.equal(result.report.issues[0].kind,"missing-context");
});

test("resolved boundary recognition variation passes the same candidate without an unnecessary second render",async()=>{
 const f=await fixture();f.adapters.transcribeRendered=async()=>({words:plan().words.slice(1)});
 f.adapters.identifyRecordingCoherence=async(p,actual,options)=>({...review(p,actual,options),transcript_resolutions:[{issue_index:0,verdict:"asr-variation",explanation:"Audition confirms the first word is intact; recognition omitted it."}]});
 const result=await runRecordingQa("source.mov",plan(),f.options,f.adapters);
 assert.equal(result.status,"passed");assert.equal(result.attempts,1);assert.equal(f.renders(),1);
 assert.equal(result.plan.kept_segments[0].source_start_seconds,1.1);
 assert.equal(result.report.repair_requests.length,0);
});
