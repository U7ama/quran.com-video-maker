import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,appendFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chooseBackground} from '../backgrounds.mjs';
import {probe,readJson} from '../io.mjs';

test('stock API failure uses a silent date-stable built-in clip and does not repeat the search',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'quran-builtin-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const config={dataDir,backgroundMode:'daily',backgroundProvider:'pixabay',pixabayKey:'fixture'};
  const assets=path.join(dataDir,'assets');let calls=0;
  const deps={getJson:async()=>{calls++;throw new Error('offline');}};
  const first=await chooseBackground(config,'ocean','2026-10-13',assets,deps);
  const second=await chooseBackground(config,'ocean','2026-10-13',assets,deps);
  assert.equal(first.provider,'builtin');assert.equal(first.id,'sea');assert.equal(first.sha256,second.sha256);
  assert.equal(calls,1);
  const media=await probe(path.join(assets,'background.mp4'));
  assert.ok(media.streams.some(x=>x.codec_type==='video'));assert.ok(!media.streams.some(x=>x.codec_type==='audio'));
  assert.equal(first.approved,false);assert.equal(first.reviewMode,'bundled-catalogue');
  assert.equal((await readJson(path.join(dataDir,'backgrounds','daily.json'))).runs['2026-10-13'].fallbackReason,'Pixabay search unavailable');
});

test('missing built-in library has a generated final fallback',async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'quran-builtin-missing-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const value=await chooseBackground({dataDir,builtinDir:path.join(dataDir,'missing'),backgroundMode:'daily',backgroundProvider:'pixabay'},
    'clouds','2026-10-13',path.join(dataDir,'assets'));
  assert.equal(value.kind,'generated');assert.equal(value.provider,'local');
});
