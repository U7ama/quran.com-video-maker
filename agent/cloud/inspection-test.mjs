import {parseEnv} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadConfig} from '../config.mjs';
import {reviewChosenBackground} from '../background-review.mjs';
import {fileHash} from '../io.mjs';
import {getObject,getFile} from './aws.js';

const fixtures={
  nature:{id:'379995',theme:'mountains',sha256:'1e899d8c41c3e1818c98ee5c58d1e38c50e5e925a7f0026e166fedd7b1e4e820'},
  flagged:{id:'381029',theme:'forest',sha256:'02c7e2986ab545c12d3c5a5717ec9ddced1a6260715b0c56101a9bd4920c4c66'},
};

// Authenticated smoke test only: no lease, daily state, retention or delivery.
// Inputs are two fixed, checksum-bound public-stock fixtures, not arbitrary keys.
export async function runInspectionTest(event,{object=getObject,file=getFile,review=reviewChosenBackground,load=loadConfig}={}) {
  if(!['nature','flagged'].includes(event.candidate) || Object.keys(event).some(k=>!['action','candidate'].includes(k)))throw new Error('Invalid inspection test');
  const fixture=fixtures[event.candidate];
  const directory=await mkdtemp(path.join(os.tmpdir(),'quran-tool-smoke-'));
  try {
    const secret=await object('deploy/config.env');
    if(!secret)throw new Error('Missing private configuration');
    const config=await load({...parseEnv(await secret.Body.transformToString()),BACKGROUND_INSPECTION:'rekognition'});
    const source=path.join(directory,'background.mp4');
    if(!await file(`cloud/tool-tests/2026-10-23/${event.candidate}.mp4`,source) || await fileHash(source)!==fixture.sha256)throw new Error('Inspection fixture checksum differs');
    const background=await review(config,{...fixture,provider:'pixabay',kind:'video',approved:false},directory,directory);
    return {status:'inspection-tested',candidate:event.candidate,background:background.kind,inspection:background.inspection};
  } finally {await rm(directory,{recursive:true,force:true});}
}
