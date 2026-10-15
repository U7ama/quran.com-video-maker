import test from 'node:test';
import assert from 'node:assert/strict';
import {retentionCandidate,retentionPlan,maintainRetention} from '../retention.mjs';
import {S3Client} from '@aws-sdk/client-s3';
import {objectMetadata,deleteRetainedObject} from '../aws.js';

const date='2026-10-10',deliveredAt='2026-10-10T05:02:29.807Z';
const buckets={media:'media-bucket',private:'private-bucket'};
const hash='a'.repeat(64);
const run={date,status:'delivered',deliveredAt,messageId:'123456789012345678',channelId:'123456789012345679',
  renderId:'render123',renderBucket:buckets.media,masterKey:'renders/render123/out.mp4',
  uploadKey:`cloud/runs/${date}/video.discord.mp4`};
const manifest={date,video:{sha256:hash},upload:{encoding:'master',sha256:hash},
  cloud:{renderId:run.renderId,masterBucket:buckets.media,masterKey:run.masterKey}};
const prepared={props:{audioSrc:`https://${buckets.media}.s3.us-east-1.amazonaws.com/assets/${date}/audio.wav?signature=private`,
  background:{src:`https://s3.us-east-1.amazonaws.com/${buckets.media}/assets/${date}/background.mp4`},cues:[]}};
const due=Date.parse(deliveredAt)+7*86400000;
const fixture=()=>({runs:{[date]:structuredClone(run)},history:[{date,messageId:run.messageId}]});
const depsFor=(overrides={})=>({buckets,getManifest:async()=>manifest,getPrepared:async()=>prepared,
  objectMetadata:async()=>({etag:'"version1"',bytes:50}),deleteRetainedObject:async()=>{},save:async()=>{},...overrides});

test('paired retention waits for both receipts, uses variant paths, and assigns shared assets only once',async()=>{
  const variants=Object.fromEntries(['urdu','recitation'].map(id=>[id,{...structuredClone(run),variant:id,
    renderId:`render-${id}`,masterKey:`renders/render-${id}/out.mp4`,uploadKey:`cloud/runs/${date}/variants/${id}/video.discord.mp4`} ]));
  const cloud={runs:{[date]:{date,version:2,status:'delivered',variants}}};
  const deps=depsFor({getManifest:async(day,id)=>({...manifest,variant:id,
    cloud:{renderId:variants[id].renderId,masterBucket:buckets.media,masterKey:variants[id].masterKey}})});
  variants.recitation.status='uncertain';
  assert.equal((await maintainRetention(cloud,deps,{now:due,date,preview:true})).candidates.length,0);
  variants.recitation.status='delivered';
  variants.recitation.deliveredAt=new Date(Date.parse(deliveredAt)+86400000).toISOString();
  const preview=await maintainRetention(cloud,deps,{now:due,date,preview:true});
  assert.equal(preview.candidates.length,2);assert.ok(preview.candidates.every(c=>!c.due));
  await maintainRetention(cloud,deps,{now:due,date});
  assert.ok(variants.urdu.retention.inventory.some(x=>x.key.includes(`/variants/urdu/`)));
  assert.ok(variants.urdu.retention.inventory.some(x=>x.key.startsWith(`assets/${date}/`)));
  assert.ok(!variants.recitation.retention.inventory.some(x=>x.key.startsWith(`assets/${date}/`)));
});

test('only confirmed cloud deliveries become eligible after seven full days',()=>{
  assert.equal(retentionCandidate(date,run,due-1).due,false);
  assert.equal(retentionCandidate(date,run,due).due,true);
  for(const status of ['prepared','rendering','sending','uncertain','render-error','building']) {
    assert.equal(retentionCandidate(date,{...run,status},due),null);
  }
  for(const patch of [{messageId:null},{channelId:null},{renderId:null},{deliveredAt:'bad'},{date:'2026-10-09'}]) {
    assert.equal(retentionCandidate(date,{...run,...patch},due),null);
  }
});

test('compressed or different-checksum masters are excluded; receipts and manifest never become targets',()=>{
  assert.equal(retentionPlan(date,run,manifest,prepared,buckets,due).preserveMaster,false);
  for(const upload of [{encoding:'two-pass',sha256:'b'.repeat(64)},{encoding:'master',sha256:'b'.repeat(64)}]) {
    const plan=retentionPlan(date,run,{...manifest,upload},prepared,buckets,due);
    assert.equal(plan.preserveMaster,true);
    assert.ok(!plan.objects.some(o=>o.key===run.masterKey));
    assert.ok(!plan.objects.some(o=>o.key.endsWith('manifest.json') || o.key==='cloud/state.json'));
  }
});

test('foreign dates, buckets, permanent files and path traversal are rejected before snapshotting',()=>{
  assert.throws(()=>retentionPlan(date,run,{...manifest,date:'2026-10-09'},prepared,buckets,due));
  assert.throws(()=>retentionPlan(date,{...run,masterKey:'fonts/font.woff2'},manifest,prepared,buckets,due));
  for(const audioSrc of ['https://example.com/video.mp4',
    `https://${buckets.media}.s3.amazonaws.com/fonts/font.woff2`,
    `https://${buckets.media}.s3.amazonaws.com/assets/2026-10-09/audio.wav`,
    `https://${buckets.media}.s3.amazonaws.com/assets/${date}/%2e%2e%2fconfig.env`]) {
    assert.throws(()=>retentionPlan(date,run,manifest,{props:{audioSrc}},buckets,due));
  }
});

test('young videos are snapshotted without deletion; old untracked files are never deleted in their first sweep',async()=>{
  for(const now of [due-1,due+86400000]) {
    const cloud=fixture();let deletes=0;
    await maintainRetention(cloud,depsFor({deleteRetainedObject:async()=>deletes++}),{now,date:'2026-10-18'});
    assert.equal(deletes,0);
    assert.equal(cloud.runs[date].retention.status,'retained');
    assert.equal(cloud.runs[date].retention.inventory.length,8);
    assert.equal(cloud.runs[date].retention.inventory[0].etag,'"version1"');
  }
});

test('partial cleanup resumes at the failed object and preserves delivery and high-quality-master state',async()=>{
  const cloud=fixture();const deleted=[];let fail=true;
  const deps=depsFor({getManifest:async()=>({...manifest,upload:{encoding:'two-pass',sha256:'b'.repeat(64)}}),
    deleteRetainedObject:async(bucket,key,etag)=>{
      assert.equal(etag,'"version1"');
      if(fail && key.endsWith('prepared.json'))throw new Error('temporary');
      deleted.push(key);
    }});
  await maintainRetention(cloud,deps,{now:due-1,date:'2026-10-16'});
  await assert.rejects(maintainRetention(cloud,deps,{now:due,date:'2026-10-17'}));
  assert.equal(cloud.runs[date].status,'delivered');
  assert.equal(cloud.runs[date].retention.status,'retained');
  fail=false;
  const result=await maintainRetention(cloud,deps,{now:due,date:'2026-10-17'});
  assert.equal(result.cleanedRuns,1);
  assert.equal(deleted.filter(k=>k===run.uploadKey).length,1);
  assert.ok(!deleted.includes(run.masterKey));
  assert.equal(cloud.runs[date].retention.preservedMasterKey,run.masterKey);
  assert.equal(cloud.runs[date].messageId,run.messageId);
  assert.equal(cloud.history[0].messageId,run.messageId);
  const count=deleted.length;
  await maintainRetention(cloud,deps,{now:due+86400000,date:'2026-10-18'});
  assert.equal(deleted.length,count);
});

test('tampered inventory or changed ETags prevent deletion without changing confirmed delivery state',async()=>{
  const cloud=fixture();let deletes=0;
  const deps=depsFor({deleteRetainedObject:async()=>{deletes++;throw Object.assign(new Error('changed'),{name:'PreconditionFailed'});}});
  await maintainRetention(cloud,deps,{now:due-1,date:'2026-10-16'});
  const good=structuredClone(cloud);
  cloud.runs[date].retention.inventory.push({bucket:buckets.private,key:'deploy/config.env',etag:'"v"'});
  await assert.rejects(maintainRetention(cloud,deps,{now:due,date:'2026-10-17'}));
  assert.equal(deletes,0);
  await assert.rejects(maintainRetention(good,deps,{now:due,date:'2026-10-17'}),{name:'PreconditionFailed'});
  assert.equal(good.runs[date].status,'delivered');
  assert.equal(good.runs[date].retention.inventory[0].deletedAt,undefined);
});

test('preview is read-only; imported laptop receipts never request cloud files',async()=>{
  const cloud=fixture();cloud.runs['2026-10-03']={date:'2026-10-03',status:'delivered',deliveredAt};
  const before=JSON.stringify(cloud);
  const forbidden=async()=>{throw new Error('unexpected operation');};
  const result=await maintainRetention(cloud,{getManifest:forbidden,save:forbidden},{now:due,date:'2026-10-17',preview:true});
  assert.equal(result.candidates.length,1);
  assert.equal(JSON.stringify(cloud),before);
});

test('S3 deletion uses the recorded exact ETag and only missing metadata is tolerated',async()=>{
  const original=S3Client.prototype.send;const deletes=[];
  S3Client.prototype.send=async function(command) {
    const input=command.input;
    if(command.constructor.name==='HeadObjectCommand') {
      if(input.Key==='missing')throw Object.assign(new Error('missing'),{name:'NotFound'});
      if(input.Key==='denied')throw Object.assign(new Error('denied'),{name:'AccessDenied'});
      return {ETag:'"original"',ContentLength:50};
    }
    if(command.constructor.name==='DeleteObjectCommand') {
      deletes.push(input);
      if(input.IfMatch!=='"original"')throw Object.assign(new Error('changed'),{name:'PreconditionFailed'});
      return {};
    }
    throw new Error('unexpected operation');
  };
  try {
    assert.deepEqual(await objectMetadata('media','a'),{etag:'"original"',bytes:50});
    assert.equal(await objectMetadata('media','missing'),null);
    await assert.rejects(objectMetadata('media','denied'),{name:'AccessDenied'});
    await deleteRetainedObject('media','a','"original"');
    assert.equal(deletes[0].IfMatch,'"original"');
    await assert.rejects(deleteRetainedObject('media','a','"replacement"'),{name:'PreconditionFailed'});
    await assert.rejects(deleteRetainedObject('media','a',null));
    await assert.rejects(deleteRetainedObject('media','a','*'));
  } finally {S3Client.prototype.send=original;}
});
