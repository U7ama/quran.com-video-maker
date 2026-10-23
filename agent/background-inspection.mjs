import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {command,probe,fileHash} from './io.mjs';

export const INSPECTION_POLICY='quran-background-v1';
export const SAMPLE_TIMES=Object.freeze([0,1,2,3,4,4.9]);
const BLOCKED=/\b(person|people|human|animal|mammal|bird|fish|reptile|invertebrate|wildlife|pet|vehicle|transportation|boat|ship|architecture|building|city|urban|logo|trademark|statue|sculpture|religious|religion|temple|church|mosque|weapon|firearm|alcohol|smoking|gambling)\b/i;
const NATURE=/\b(nature|landscape|scenery|mountain|forest|woodland|tree|plant|vegetation|cloud|sky|ocean|sea|water|river|lake|waterfall|snow|ice|desert|sand|rock|outdoors|astronomy|star)\b/i;
const confidence=n=>typeof n==='number' && Number.isFinite(n) && n>=0 && n<=100;
function names(label) {
  const values=[label.Name,...(label.Parents || []).map(p=>p.Name),...(label.Aliases || []).map(p=>p.Name)];
  if(!values.every(n=>typeof n==='string' && /^[A-Za-z0-9 ()&/.,'\-]{1,100}$/.test(n)))throw new Error('Invalid detection label');
  return values;
}
export function judgeFrame({labels,moderation,text},timestamp) {
  if(!Array.isArray(labels?.Labels) || !Array.isArray(moderation?.ModerationLabels) || !Array.isArray(text?.TextDetections))throw new Error('Incomplete inspection response');
  const findings=[];
  let nature=false;
  const detected=[];
  for(const label of labels.Labels) {
    if(!confidence(label.Confidence))throw new Error('Invalid detection confidence');
    const related=names(label);
    if(label.Confidence>=60 && related.some(n=>BLOCKED.test(n)))findings.push({kind:'blocked-object',label:label.Name,confidence:label.Confidence});
    if(label.Confidence>=70 && related.some(n=>NATURE.test(n)))nature=true;
    if(label.Confidence>=60)detected.push({name:label.Name,confidence:label.Confidence});
  }
  for(const label of moderation.ModerationLabels) {
    if(!confidence(label.Confidence) || typeof label.Name!=='string')throw new Error('Invalid moderation response');
    if(label.Confidence>=50)findings.push({kind:'moderation',label:label.Name.slice(0,100),confidence:label.Confidence});
  }
  // Text is evidence of an overlay; do not forward its words as model instructions.
  for(const item of text.TextDetections) {
    if(!confidence(item.Confidence))throw new Error('Invalid text response');
    if(item.Type==='LINE' && item.Confidence>=70)findings.push({kind:'visible-text',confidence:item.Confidence});
  }
  return {timestamp,nature,findings,labels:detected.slice(0,30),modelVersions:{labels:labels.LabelModelVersion || null,moderation:moderation.ModerationModelVersion || null,text:text.TextModelVersion || null}};
}

// The host binds the file. Model arguments never become paths, URLs or S3 keys.
export async function inspectBackgroundVideo(file,{analyzeFrame,run=command,mediaProbe=probe,hashFile=fileHash,read=readFile}={}) {
  const report={tool:'inspect_background_video',policy:INSPECTION_POLICY,scope:'portrait-cover-first-5-seconds',
    status:'incomplete',expectedSamples:[...SAMPLE_TIMES],frames:[],humanApproved:false,
    limitation:'Six sampled frames can miss brief or unrecognized content; this is not a full video review or religious certification.'};
  let temporary;
  try {
    if(typeof analyzeFrame!=='function')throw new Error('Inspection provider unavailable');
    const media=await mediaProbe(file),video=media.streams?.find(s=>s.codec_type==='video');
    if(!video || !Number.isFinite(Number(media.format?.duration)) || Number(media.format.duration)<5)throw new Error('Incomplete background loop');
    report.inputSha256=await hashFile(file);
    temporary=await mkdtemp(path.join(os.tmpdir(),'quran-inspection-'));
    for(const timestamp of SAMPLE_TIMES) {
      const frame=path.join(temporary,'frame.jpg');
      await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(timestamp),'-i',file,
        '-frames:v','1','-vf',"crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=512:910:flags=lanczos",'-q:v','3',frame],{timeout:30000});
      const bytes=await read(frame);
      if(!bytes.length || bytes.length>5*1024*1024)throw new Error('Invalid inspection frame');
      report.frames.push(judgeFrame(await analyzeFrame(bytes),timestamp));
    }
    if(await hashFile(file)!==report.inputSha256)throw new Error('Background changed during inspection');
    report.status=report.frames.some(f=>f.findings.length) ? 'blocked' : report.frames.every(f=>f.nature) ? 'eligible' : 'incomplete';
  } catch {
    report.status='incomplete';
    report.error='Inspection could not complete; use generated scenery.';
  } finally {
    if(temporary)await rm(temporary,{recursive:true,force:true});
  }
  return report;
}
