import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fitDiscord,verifyVideo,uploadBitrate} from '../render.mjs';
import {command,fileHash} from '../io.mjs';
import {loadConfig} from '../config.mjs';

test('upload budget adapts to complete duration while retaining the original audio bitrate',async()=>{
  const config=await loadConfig({DISCORD_MAX_MIB:''});
  assert.equal(config.discordMaxBytes,19*1024*1024);
  const short=uploadBitrate(config.discordMaxBytes,35);
  const long=uploadBitrate(config.discordMaxBytes,120);
  assert.ok(short>4000000);assert.ok(long>1000000);assert.ok(short>long);
  for(const args of [[0,10],[-1,10],[1000,0],[1000,10],[Infinity,1],[1000000,10,NaN]]) {
    assert.throws(()=>uploadBitrate(...args));
  }
});

test('two-pass Discord export keeps 1080p, frame rate, full duration, and identical AAC packets',async t=>{
  const folder=await mkdtemp(path.join(tmpdir(),'quran-quality-test-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const master=path.join(folder,'master.mp4');
  await command('ffmpeg',['-hide_banner','-loglevel','error','-y',
    '-f','lavfi','-i','testsrc2=size=1080x1920:rate=30:duration=3',
    '-f','lavfi','-i','sine=frequency=440:duration=3',
    '-c:v','libx264','-threads','2','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p',
    '-c:a','aac','-b:a','160k','-shortest',master]);
  const metadata=await verifyVideo(master,3);
  const maxBytes=512*1024;
  assert.ok(metadata.bytes>maxBytes,'Fixture must exercise actual compression');
  const result=await fitDiscord({discordMaxBytes:maxBytes},master,3);
  assert.equal(result.encoding,'two-pass');assert.ok(result.bytes<=maxBytes);
  assert.equal(result.width,1080);assert.equal(result.height,1920);assert.equal(result.fps,30);
  assert.ok(Math.abs(result.duration-3)<0.1);
  assert.equal(await fileHash(master),metadata.sha256,'Master is retained unchanged');
  const audioHash=file=>command('ffmpeg',['-v','error','-i',file,'-map','0:a:0','-c:a','copy','-f','hash','-hash','sha256','-']);
  assert.equal(await audioHash(result.file),await audioHash(master));
  await command('ffmpeg',['-v','error','-xerror','-i',result.file,'-f','null','-']);
  assert.ok(!(await readdir(folder)).some(name=>name.startsWith('.encoding-')));
  const direct=await fitDiscord({discordMaxBytes:metadata.bytes+1},master,3);
  assert.equal(direct.file,master);assert.equal(direct.encoding,'master');
  await assert.rejects(verifyVideo(master,10),/checks/);
  await assert.rejects(verifyVideo(master,NaN),/checks/);
});

test('video verification rejects a low-resolution export',async t=>{
  const folder=await mkdtemp(path.join(tmpdir(),'quran-resolution-test-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const file=path.join(folder,'low.mp4');
  await command('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=size=720x1280:rate=30:duration=1',
    '-f','lavfi','-i','sine=duration=1','-c:v','libx264','-threads','2','-preset','ultrafast',
    '-c:a','aac','-shortest',file]);
  await assert.rejects(verifyVideo(file,1),/checks/);
});
