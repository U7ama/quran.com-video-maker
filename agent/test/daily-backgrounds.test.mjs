import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,copyFile,appendFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chooseDailyBackground as chooseBackground,isNatureCandidate} from '../backgrounds.mjs';
import {loadConfig} from '../config.mjs';
import {command,probe,readJson,writeJson,fileHash} from '../io.mjs';
import {validateScreenedBackground,validateBackground} from '../core.mjs';

const hit=(id=125,tags='mountains, lake, nature')=>({id,tags,type:'film',pageURL:`https://pixabay.com/videos/id-${id}/`,
  user:'Nature creator',duration:6,videos:{small:{url:`https://cdn.pixabay.com/video/2026/10/03/${id}.mp4`,width:540,height:960,size:100000}}});
async function fixture(t) {
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'quran-daily-stock-'));
 t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const clip=path.join(dataDir,'fixture.mp4');
 await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0x325566:s=540x960:r=2:d=6',
  '-f','lavfi','-i','sine=frequency=440:duration=6','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',clip]);
 const config={dataDir,backgroundProvider:'pixabay',backgroundMode:'daily',pixabayKey:'private-daily-test-key'};
 return {config,clip,dataDir,assets:path.join(dataDir,'assets')};
}

test('automatic nature screening rejects missing tags, animations and excluded subjects',()=>{
 assert.equal(isNatureCandidate({provider:'pixabay',type:'film',tags:'forest, river, clouds'}),true);
 for(const tags of ['',undefined,'city, architecture','mountains, hiker','lake, animals','ocean, people',
  'mountains, mosque','clouds, logo','river, statue','sea, boat','desert, camel, animals','forest, birds','nature, fireworks',
  'landscape, castle, museum','coast, nature, urban, street','nature, water, shiva','landscape, krishna','forest, vishnu','garden, ganesha','nature, hindu temple']) {
  assert.equal(isNatureCandidate({provider:'pixabay',type:'film',tags}),false,`${tags}`);
 }
 assert.equal(isNatureCandidate({provider:'pixabay',type:'animation',tags:'mountains'}),false);
});

test('a saved clip rejected by updated screening falls back without a new search or deletion',async t=>{
 const {config,clip,dataDir,assets}=await fixture(t);
 const deps={getJson:async()=>({hits:[hit()]}),download:async(_url,file)=>copyFile(clip,file)};
 await chooseBackground(config,'mountains','2026-10-03',assets,deps);
 const ledgerFile=path.join(dataDir,'backgrounds','daily.json');
 const ledger=await readJson(ledgerFile);
 ledger.runs['2026-10-03'].tags='nature, water, shiva';
 await writeJson(ledgerFile,ledger);
 const result=await chooseBackground(config,'mountains','2026-10-03',assets,{
  getJson:async()=>{throw new Error('Must not search again');},download:async()=>{throw new Error('Must not download');}
 });
 assert.equal(result.kind,'generated');
 assert.equal(result.rejectedSource.id,'125');
 assert.match(result.fallbackReason,/screening/);
 assert.deepEqual((await readJson(ledgerFile)).runs['2026-10-03'],result);
 assert.equal(await fileHash(path.join(dataDir,'backgrounds','daily','2026-10-03.mp4')),await fileHash(clip));
});

test('daily searches avoid used IDs, paginate, persist a stable retry, retain credits and strip audio',async t=>{
 const {config,clip,dataDir,assets}=await fixture(t);
 let searches=0,downloads=0;
 const deps={getJson:async(url)=>{
  searches++;
  assert.equal(url.searchParams.get('category'),'nature');
  assert.equal(url.searchParams.get('safesearch'),'true');
  assert.equal(url.searchParams.get('video_type'),'film');
  assert.equal(url.searchParams.get('order'),'latest');
  assert.equal(url.searchParams.get('page'),String(searches));
  return {totalHits:30,hits:[hit(125),hit(126)]};
 },download:async(url,file)=>{
  downloads++;await copyFile(clip,file);
  // Different container bytes simulate distinct downloaded files.
  await appendFile(file,new URL(url).pathname);
 }};
 const first=await chooseBackground(config,'mountains','2026-10-03',assets,deps);
 assert.equal(first.id,'125');assert.equal(first.approved,false);assert.equal(first.reviewMode,'automated-metadata');
 assert.equal(validateScreenedBackground(first),first);
 assert.throws(()=>validateBackground(first));
 const retry=await chooseBackground(config,'clouds','2026-10-03',assets,deps);
 assert.equal(retry.sha256,first.sha256);assert.equal(retry.theme,'mountains');
 assert.equal(searches,1);assert.equal(downloads,1);
 const second=await chooseBackground(config,'mountains','2026-10-04',assets,deps);
 assert.equal(second.id,'126');assert.notEqual(second.sha256,first.sha256);
 assert.equal(searches,2);assert.equal(downloads,2);
 assert.ok(!(await probe(path.join(assets,'background.mp4'))).streams.some(s=>s.codec_type==='audio'));
 assert.ok(!(await readFile(path.join(dataDir,'backgrounds','daily.json'),'utf8')).includes(config.pixabayKey));
});

test('daily searches exclude approved library IDs and duplicate media hashes',async t=>{
 const {config,clip,dataDir,assets}=await fixture(t);
 await writeJson(path.join(dataDir,'backgrounds','approved.json'),[{provider:'pixabay',id:'125',sha256:await fileHash(clip)}]);
 let downloads=0;
 const background=await chooseBackground(config,'mountains','2026-10-03',assets,{
  getJson:async()=>({hits:[hit(125),hit(126)]}),download:async(_url,file)=>{downloads++;await copyFile(clip,file);}
 });
 assert.equal(background.kind,'generated');assert.equal(downloads,1);
 assert.match(background.fallbackReason,/unused/);
});

test('API failure uses date-stable generated scenery without secret logs or repeated searches',async t=>{
 const {config,dataDir,assets}=await fixture(t);
 let searches=0;
 const deps={getJson:async()=>{searches++;throw new Error(config.pixabayKey);}};
 const first=await chooseBackground(config,'mountains','2026-10-03',assets,deps);
 const retry=await chooseBackground(config,'mountains','2026-10-03',assets,deps);
 assert.equal(first.kind,'generated');assert.deepEqual(retry,first);assert.equal(searches,1);
 assert.ok(!(await readFile(path.join(dataDir,'backgrounds','daily.json'),'utf8')).includes(config.pixabayKey));
});

test('unsafe results never download and an empty later page resets the cursor for tomorrow',async t=>{
 const {config,dataDir,assets}=await fixture(t);
 await writeJson(path.join(dataDir,'backgrounds','daily.json'),{runs:{},pages:{mountains:5}});
 const result=await chooseBackground(config,'mountains','2026-10-03',assets,{
  getJson:async()=>({totalHits:2,hits:[hit(125,'mountains, people')]}),download:async()=>{throw new Error('Must not download');}
 });
 assert.equal(result.kind,'generated');
 assert.equal((await readJson(path.join(dataDir,'backgrounds','daily.json'))).pages.mountains,1);
});

test('changed daily stock fails closed and cannot trigger a replacement search',async t=>{
 const {config,clip,dataDir,assets}=await fixture(t);
 let searches=0;
 const deps={getJson:async()=>{searches++;return {hits:[hit()]};},download:async(_url,file)=>copyFile(clip,file)};
 await chooseBackground(config,'mountains','2026-10-03',assets,deps);
 await writeFile(path.join(dataDir,'backgrounds','daily','2026-10-03.mp4'),'tampered');
 await assert.rejects(chooseBackground(config,'mountains','2026-10-03',assets,deps),/changed after screening/);
 assert.equal(searches,1);
});

test('daily mode accepts only Pixabay and keeps automation distinct from human approval',async()=>{
 assert.equal((await loadConfig({BACKGROUND_MODE:'daily',BACKGROUND_PROVIDER:'pixabay'})).backgroundMode,'daily');
 await assert.rejects(loadConfig({BACKGROUND_MODE:'daily',BACKGROUND_PROVIDER:'pexels'}),/require/);
 const entry={id:'125',key:'pixabay-125',provider:'pixabay',theme:'mountains',approved:false,
  sourceUrl:'https://pixabay.com/videos/id-125/',license:'Pixabay Content License',licenseUrl:'https://pixabay.com/service/license-summary/',
  sha256:'a'.repeat(64),screenedAt:'2026-10-03',reviewMode:'automated-metadata',safeSearch:true,type:'film'};
 assert.equal(validateScreenedBackground(entry),entry);
 for(const change of [{approved:true},{safeSearch:false},{type:'animation'},{reviewMode:'human'},{license:'fake'}]) {
  assert.throws(()=>validateScreenedBackground({...entry,...change}));
 }
});
