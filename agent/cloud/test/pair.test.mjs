import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {S3Client} from '@aws-sdk/client-s3';
import {newPair,variantPrefix} from '../../variants.mjs';
import {runCloudPair} from '../pair.mjs';

async function fixture(t) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'quran-pair-'));
  const originalSend=S3Client.prototype.send,originalFetch=globalThis.fetch;
  t.after(async()=>{S3Client.prototype.send=originalSend;globalThis.fetch=originalFetch;await rm(dataDir,{recursive:true,force:true});});
  const date='2026-10-13',run={...newPair(date),prepared:true,selection:{passageId:'103:1-3'}};
  const cloud={runs:{[date]:run},history:[]};
  const objects=new Map();const bytes=Buffer.from('verified-fixture-video');
  for(const id of ['urdu','recitation']) {
    const prefix=variantPrefix(date,id);
    Object.assign(run.variants[id],{status:'prepared',uploadKey:`${prefix}/video.discord.mp4`});
    objects.set(`${prefix}/prepared.json`,Buffer.from(JSON.stringify({props:{},context:{passage:{chapter:103}}})));
    objects.set(`${prefix}/manifest.json`,Buffer.from(JSON.stringify({date,variant:id,passage:{id:'103:1-3',name:'Al-Asr',chapter:103,from:1,to:3},
      reciter:{name:'Mishari'},translation:{name:'Jalandhri'},background:{provider:'local'},
      upload:{file:`/tmp/${id}.mp4`,sha256:createHash('sha256').update(bytes).digest('hex')}})));
    objects.set(`${prefix}/video.discord.mp4`,bytes);
  }
  S3Client.prototype.send=async function(command) {
    const body=objects.get(command.input.Key);
    if(command.constructor.name==='GetObjectCommand') {
      if(!body)throw Object.assign(new Error('missing'),{name:'NoSuchKey'});
      return {Body:{transformToString:async()=>body.toString(),transformToByteArray:async()=>body}};
    }
    throw new Error('Unexpected external AWS operation in delivery fixture');
  };
  const config={dataDir,botToken:'fixture-token',discordUserId:'123456789012345678',discordMaxBytes:100000};
  const snapshots=[];let continuations=0,sends=0,lose=false;
  globalThis.fetch=async(url,options)=>{
    if(String(url).endsWith('/users/@me'))return Response.json({bot:true});
    if(String(url).endsWith('/users/@me/channels'))return Response.json({id:'123456789012345679'});
    assert.equal(snapshots.at(-1).runs[date].variants[sends===0 ? 'urdu' : 'recitation'].status,'sending');
    sends++;
    if(lose)throw new Error('lost acknowledgement');
    const payload=JSON.parse(options.body.get('payload_json'));
    assert.match(payload.content,/Version:/);
    return Response.json({id:String(123456789012345680n+BigInt(sends)),channel_id:'123456789012345679',attachments:[{id:'1'}]});
  };
  const options={remaining:()=>900000,saveCloud:async()=>snapshots.push(structuredClone(cloud)),continueLater:()=>continuations++,maintain:async()=>{}};
  return {date,run,cloud,config,options,lose:()=>{lose=true;},stats:()=>({sends,continuations})};
}

test('cloud pair persists distinct receipts, continues missing version, and skips confirmed pair',async t=>{
  const f=await fixture(t);
  assert.equal((await runCloudPair(f.config,f.cloud,f.date,f.options)).pairStatus,'building');
  const first=f.run.variants.urdu.messageId;
  assert.equal(f.stats().sends,1);assert.equal(f.stats().continuations,1);
  assert.equal((await runCloudPair(f.config,f.cloud,f.date,f.options)).pairStatus,'delivered');
  assert.equal(f.run.variants.urdu.messageId,first);
  assert.notEqual(f.run.variants.recitation.messageId,first);
  assert.equal((await runCloudPair(f.config,f.cloud,f.date,f.options)).status,'delivered');
  assert.equal(f.stats().sends,2);
});

test('lost variant acknowledgement holds the pair and never resends either attachment',async t=>{
  const f=await fixture(t);f.lose();
  await assert.rejects(runCloudPair(f.config,f.cloud,f.date,f.options));
  assert.equal(f.run.variants.urdu.status,'uncertain');
  assert.equal((await runCloudPair(f.config,f.cloud,f.date,f.options)).status,'uncertain');
  assert.equal(f.stats().sends,1);
});
