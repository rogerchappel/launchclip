import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareSourceMedia } from "../src/production_source_media.js";
import { runProduction } from "../src/production_cli.js";

test("recording QA pending leaves authoritative source intake untouched",async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),"launchclip-qa-intake-"));await mkdir(path.join(workspace,"production"));
 const input=path.join(workspace,"original.mov");await writeFile(input,"original");
 const intakePath=path.join(workspace,"production","intake.json");const intake={source:{kind:"voiceover",value:input,location:input},brief:{duration_seconds:10},resources:["voiceover","presenter"].map(role=>({id:role,role,type:"video",is_remote:false,location:input}))};const saved=JSON.stringify(intake);await writeFile(intakePath,saved);
 const result=await prepareSourceMedia(workspace,{editRecording:true,recording:{}},{prepareRecording:async()=>({status:"needs-semantic-review",candidate:"candidate.mp4",files:{rendered_transcript:"heard.json"},next_action:"Agent reviews evidence."})});
 assert.equal(result.status,"needs-semantic-review");assert.equal(result.changed,false);assert.equal(await readFile(intakePath,"utf8"),saved);assert.equal(await readFile(input,"utf8"),"original");
});
test("production stops before evidence or metered stages when recording QA is unresolved",async()=>{
 for(const status of ["needs-semantic-review","needs-attention"]){
  const calls=[];const result=await runProduction("owner/tool",{}, {withProductionLease:async(_workspace,operation)=>operation(),buildIntake:async()=>({workspace:"/tmp/qa-production"}),writeIntake:async()=>({workspace:"/tmp/qa-production"}),prepareSourceMedia:async()=>{calls.push("qa");return{status,next_action:"Resume recording QA."};},collectEvidence:async()=>{throw new Error("Unverified media must not reach downstream stages");}});
  assert.equal(result.status,status);assert.deepEqual(calls,["qa"]);assert.equal(result.next_action,"Resume recording QA.");
 }
});
