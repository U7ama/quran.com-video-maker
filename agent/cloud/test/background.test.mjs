import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,copyFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {prepareCloudBackground} from '../background.mjs';
import {command,fileHash,probe} from '../../io.mjs';

test('cloud rendition preserves source, makes a five-second silent portrait loop, and records its checksum',async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'cloud-background-'));
 t.after(()=>rm(folder,{recursive:true,force:true}));
 const source=path.join(folder,'original.mp4'),asset=path.join(folder,'background.mp4');
 await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=640x360:r=60:d=6',
  '-f','lavfi','-i','sine=frequency=440:duration=6','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
 const originalHash=await fileHash(source);
 await copyFile(source,asset);
 const prepared={assetDir:folder,props:{background:{kind:'video'}},context:{background:{id:'source',sha256:originalHash}}};
 await prepareCloudBackground(prepared);
 const media=await probe(asset),video=media.streams.find(s=>s.codec_type==='video');
 assert.equal(video.width,1080);assert.equal(video.height,1920);
 assert.equal(video.r_frame_rate,'30/1');assert.equal(Number(video.nb_frames),150);
 assert.equal(Number(media.format.duration),5);assert.equal(media.streams.length,1);
 assert.equal(await fileHash(source),originalHash);
 assert.equal(prepared.context.background.sha256,originalHash);
 assert.equal(prepared.context.background.renderRendition.sha256,await fileHash(asset));
});

test('generated scenery does not require a stock rendition',async()=>{
 await prepareCloudBackground({props:{background:{kind:'generated'}}});
});
