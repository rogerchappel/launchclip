import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {prepareRecording,recordingOptions} from '../src/recording_workflow.js';
import {semanticTranscriptHash} from '../src/semantic_retakes.js';

const words=[{word:'Um,',start:1,end:1.2},{word:'We',start:1.4,end:1.6},{word:'discover',start:1.6,end:1.9},{word:'useful',start:1.9,end:2.2},{word:'patterns.',start:2.2,end:2.5},{word:'We',start:4,end:4.2},{word:'identify',start:4.2,end:4.5},{word:'helpful',start:4.5,end:4.8},{word:'patterns.',start:4.8,end:5.1}];
async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'launchclip-cleanup-'));
 const input=path.join(directory,'recording.mov');await writeFile(input,'original');
 const transcript=path.join(directory,'words.json');await writeFile(transcript,JSON.stringify({words}));
 let analyses=0,renders=0;
 const adapters={probe:async()=>({format:{duration:7},streams:[{codec_type:'video'},{codec_type:'audio'}]}),analyzeRecordingAudio:async()=>{analyses++;return{source_duration_seconds:7,threshold_db:-40,silence_intervals:[{start_seconds:2.5,end_seconds:4}],waveform:[]};},editRecording:async(_input,output,plan)=>{renders++;await writeFile(output,'edited');return{duration_seconds:plan.duration_seconds};}};
 return{input,transcript,directory,adapters,analyses:()=>analyses,renders:()=>renders};
}
test('cleanup defaults combine filler removal and measured quiet with verified cache',async()=>{
 const f=await fixture();const options={out:path.join(f.directory,'edit'),transcript:f.transcript};
 const result=await prepareRecording(f.input,options,f.adapters);
 const plan=JSON.parse(await readFile(result.files.edit_plan,'utf8'));
 assert.ok(!plan.words.some(w=>w.word==='Um,'));
 assert.ok(plan.removed_segments.some(s=>s.reason==='filler'));
 assert.ok(plan.removed_segments.some(s=>s.reason==='waveform-silence'));
 assert.equal(result.filler_cleanup,true);assert.equal(result.audio_silence,true);assert.equal(result.semantic_retakes,0);
 assert.equal(JSON.parse(await readFile(result.files.semantic_retakes,'utf8')).status,'not-requested');
 assert.equal((await prepareRecording(f.input,options,f.adapters)).cached,true);
 assert.equal(f.analyses(),1);assert.equal(f.renders(),1);
});
test('explicit opt-outs preserve fillers and pauses without acoustic calls',async()=>{
 const f=await fixture();const result=await prepareRecording(f.input,{out:path.join(f.directory,'edit'),transcript:f.transcript,removeFillers:false,trimSilence:false},f.adapters);
 assert.equal(f.analyses(),0);assert.equal(result.duration_seconds,7);
 assert.equal(JSON.parse(await readFile(result.files.transcript,'utf8')).words[0].word,'Um,');
});
test('supplied semantic receipt removes the earlier paraphrase before remapping',async()=>{
 const f=await fixture();const decisions=path.join(f.directory,'retakes.json');
 await writeFile(decisions,JSON.stringify({transcript_hash:semanticTranscriptHash({words}),retakes:[{earlier:{first_word:0,last_word:4},later:{first_word:5,last_word:8},later_complete:true,explanation:'The later complete restart replaces the earlier statement.'}]}));
 const result=await prepareRecording(f.input,{out:path.join(f.directory,'edit'),transcript:f.transcript,retakeDecisions:decisions},f.adapters);
 const plan=JSON.parse(await readFile(result.files.edit_plan,'utf8'));
 assert.equal(plan.text,'We identify helpful patterns.');assert.equal(result.semantic_retakes,1);
 assert.ok(plan.removed_segments.some(s=>s.reason==='semantic-retake'));
});
test('mismatched semantic receipt fails before acoustic analysis or rendering',async()=>{
 const f=await fixture();const decisions=path.join(f.directory,'retakes.json');await writeFile(decisions,JSON.stringify({transcript_hash:'incorrect',retakes:[]}));
 await assert.rejects(()=>prepareRecording(f.input,{out:path.join(f.directory,'edit'),transcript:f.transcript,retakeDecisions:decisions},f.adapters),/hash/);
 assert.equal(f.analyses(),0);assert.equal(f.renders(),0);
});
test('explicit local model uses injected inference without a default provider call',async()=>{
 const f=await fixture();let calls=0;
 f.adapters.identifySemanticRetakes=async(transcript,options)=>{calls++;assert.deepEqual(transcript.words,words);assert.equal(options.model,'local-model');assert.equal(options.retakeWindow,90);return{transcript_hash:semanticTranscriptHash(transcript),retakes:[],removals:[]};};
 await prepareRecording(f.input,{out:path.join(f.directory,'edit'),transcript:f.transcript,retakeModel:'local-model'},f.adapters);assert.equal(calls,1);
 const options=recordingOptions({'keep-fillers':true,'no-audio-silence':true,'retake-model':'local-model','audio-threshold-db':'-40'});
 assert.equal(options.removeFillers,false);assert.equal(options.audioSilence,false);assert.equal(options.audioThresholdDb,-40);assert.equal(options.retakeModel,'local-model');
});
