import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deliver,validateWebhook} from '../discord.mjs';
import {deliverPrepared} from '../workflow.mjs';
import {writeJson,readJson,fileHash} from '../io.mjs';

const manifest={date:'2026-10-03',passage:{name:'Al-Ikhlas',id:'112:1-4',chapter:112,from:1,to:4},
  translation:{name:'Maulana Muhammad Junagarhi'},reciter:{name:'Mishari Al-Afasy'},background:{provider:'local'}};
const config={botToken:'private-test-token',discordUserId:'123456789012345678',discordMaxBytes:100000};
async function fixture(t){
  const folder=await mkdtemp(path.join(os.tmpdir(),'quran-agent-test-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const file=path.join(folder,'quran.mp4');await writeFile(file,Buffer.from('fixture-video'));
  await writeJson(path.join(folder,'manifest.json'),{...manifest,upload:{file,sha256:await fileHash(file)}});
  return {folder,file};
}

test('bot DM upload uses bot authentication, attaches the video and suppresses mentions',async t=>{
  const {file}=await fixture(t);let sent=false;
  const fake=async(url,init)=>{
    assert.equal(init.headers.Authorization,'Bot private-test-token');
    if(String(url).endsWith('/users/@me'))return Response.json({bot:true});
    if(String(url).endsWith('/users/@me/channels')){
      assert.equal(JSON.parse(init.body).recipient_id,config.discordUserId);
      return Response.json({id:'234567890123456789'});
    }
    sent=true;
    assert.equal(String(url),'https://discord.com/api/v10/channels/234567890123456789/messages');
    const payload=JSON.parse(init.body.get('payload_json'));
    assert.deepEqual(payload.allowed_mentions,{parse:[]});
    assert.match(payload.content,/112:1-4/);
    assert.equal(init.body.get('files[0]').type,'video/mp4');
    return Response.json({id:'345678901234567890',channel_id:'234567890123456789',attachments:[{id:'1'}]});
  };
  const receipt=await deliver(config,manifest,file,fake);
  assert.equal(receipt.messageId,'345678901234567890');assert.ok(sent);
});
test('user tokens cannot be used as self-bots',async t=>{
  const {file}=await fixture(t);let calls=0;
  await assert.rejects(deliver(config,manifest,file,async()=>{calls++;return Response.json({bot:false});}),/genuine Discord bot/);
  assert.equal(calls,1);
});
test('unacknowledged upload is uncertain and does not leak the token',async t=>{
  const {file}=await fixture(t);
  const webhook='https://discord.com/api/webhooks/123456789012345678/private-secret-token';
  await assert.rejects(deliver({...config,webhookUrl:webhook},manifest,file,async()=>{throw new Error(webhook);}),
    error=>error.uncertain===true && !error.message.includes('private-secret-token'));
  assert.throws(()=>validateWebhook('https://attacker.example/api/webhooks/123/token'));
});
test('confirmed receipt persists and a later invocation skips sending',async t=>{
  const {folder}=await fixture(t);let sends=0;
  const send=async()=>{sends++;return {messageId:'345678901234567890'};};
  const confirmed=await deliverPrepared(config,{date:'2026-10-03',status:'prepared'},folder,writeJson,send);
  assert.equal(confirmed.status,'delivered');
  await deliverPrepared(config,confirmed,folder,writeJson,send);
  assert.equal(sends,1);
});
test('lost acknowledgement is held; a definite rejection retains a retryable prepared file',async t=>{
  const {folder}=await fixture(t);
  const send=async()=>{throw Object.assign(new Error('lost acknowledgement'),{uncertain:true});};
  await assert.rejects(deliverPrepared(config,{status:'prepared'},folder,writeJson,send));
  const state=await readJson(path.join(folder,'state.json'));
  assert.equal(state.status,'uncertain');
  await assert.rejects(deliverPrepared(config,state,folder,writeJson,send),/unconfirmed/);
  await assert.rejects(deliverPrepared(config,{status:'prepared'},folder,writeJson,
    async()=>{throw Object.assign(new Error('HTTP 403'),{definite:true});}));
  assert.equal((await readJson(path.join(folder,'state.json'))).status,'prepared');
});
test('receipt storage failure after an accepted upload never makes the file retryable',async t=>{
  const {folder}=await fixture(t);let writes=0;
  const save=async(file,data)=>{writes++;if(writes===2)throw new Error('Disk full');await writeJson(file,data);};
  await assert.rejects(deliverPrepared(config,{status:'prepared'},folder,save,
    async()=>({messageId:'345678901234567890'})),error=>error.uncertain===true);
  assert.equal((await readJson(path.join(folder,'state.json'))).status,'sending');
});
test('a replaced prepared MP4 cannot be delivered',async t=>{
  const {folder,file}=await fixture(t);await writeFile(file,'changed');
  await assert.rejects(deliverPrepared(config,{status:'prepared'},folder,writeJson,async()=>{}),/changed/);
});
