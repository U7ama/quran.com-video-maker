// A read-only demonstration against an existing, checksum-verified public stock clip.
// Never starts the daily workflow, writes a delivery ledger or sends to Discord.
import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {loadConfig,AGENT_DIR} from './config.mjs';
import {readJson,writeJson,fileHash,command} from './io.mjs';
import {isNatureCandidate} from './backgrounds.mjs';
import {reviewChosenBackground} from './background-review.mjs';

const date=process.argv[2];
if(!/^\d{4}-\d{2}-\d{2}$/.test(date || ''))throw new Error('Usage: node agent/inspection-demo.mjs YYYY-MM-DD');
const entry=(await readJson(path.join(AGENT_DIR,'data/backgrounds/daily.json'))).runs[date];
if(entry?.provider!=='pixabay' || !/^https:\/\/pixabay\.com\//.test(entry.sourceUrl))throw new Error('Demo requires a saved public Pixabay source');
const source=path.join(AGENT_DIR,'data/backgrounds/daily',`${date}.mp4`);
if(await fileHash(source)!==entry.sha256)throw new Error('Demo source checksum differs');
const folder=path.join(AGENT_DIR,'cloud/build/inspection-demo',date);
const assets=path.join(folder,'assets');
await mkdir(assets,{recursive:true});
await copyFile(source,path.join(assets,'background.mp4'));
const config={...await loadConfig(),backgroundInspection:'rekognition'};
const start=Date.now();
const result=await reviewChosenBackground(config,{...entry,kind:'video'},assets,folder);
const trace=await readJson(path.join(folder,'background-inspection.json'));
const report={date,sourceUrl:entry.sourceUrl,sourceSha256:entry.sha256,
  before:{metadataAccepted:isNatureCandidate(entry),tags:entry.tags},
  after:{background:result.kind,decision:trace.decision,mode:trace.mode,model:trace.model,
    status:trace.toolCalls?.[0]?.result?.status,findings:trace.toolCalls?.[0]?.result?.frames.flatMap(f=>f.findings.map(v=>({timestamp:f.timestamp,...v}))) || [],
    elapsedSeconds:(Date.now()-start)/1000},trace};
await writeJson(path.join(folder,'result.json'),report);
await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',source,'-t','5','-an',
  '-vf',"crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=512:910",'-c:v','libx264','-preset','fast','-crf','20',path.join(folder,'before.mp4')]);
console.log(JSON.stringify({date,before:report.before,after:report.after,report:path.join(folder,'result.json')}));
