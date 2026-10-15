import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fetchBackgroundCandidates,approveBackground,chooseBackground,normalizeCandidates} from '../backgrounds.mjs';
import {validateBackground,backgroundKey} from '../core.mjs';
import {loadConfig} from '../config.mjs';
import {command,probe,readJson,writeJson,fileHash,assertMediaUrl} from '../io.mjs';
import {deliver} from '../discord.mjs';

const hit=(id=125)=>({id,pageURL:`https://pixabay.com/videos/id-${id}/`,user:'Nature creator',type:'film',duration:6,
  videos:{medium:{url:`https://cdn.pixabay.com/video/2026/10/03/${id}_medium.mp4`,width:1280,height:720,size:100000},
    portrait:{url:`https://cdn.pixabay.com/video/2026/10/03/${id}_portrait.mp4`,width:720,height:1280,size:100000}}});
async function fixture(t) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'quran-pixabay-test-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const clip=path.join(dataDir,'fixture.mp4');
  // Synthetic nature-colored test footage with audio to prove that the daily path strips it.
  await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0x325566:s=540x960:r=2:d=6',
    '-f','lavfi','-i','sine=frequency=440:duration=6','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',clip]);
  return {dataDir,clip,config:{dataDir,backgroundProvider:'pixabay',backgroundMode:'mixed',pixabayKey:'private-pixabay-test-key'}};
}

test('Pixabay selection prefers portrait renditions and rejects hostile or unsuitable metadata',()=>{
  const candidates=normalizeCandidates('pixabay',{hits:[hit()]});
  assert.ok(candidates[0].url.endsWith('_portrait.mp4'));
  const invalid=[{...hit(),duration:4},{...hit(),duration:91},{...hit(),pageURL:'https://pixabay.com.attacker.test/videos/id-125/'},
    {...hit(),videos:{medium:{url:'https://attacker.test/125.mp4',width:720,height:1280}}},
    {...hit(),videos:{medium:{url:hit().videos.medium.url,width:1280,height:720,size:100*1024*1024}}}];
  assert.deepEqual(normalizeCandidates('pixabay',{hits:invalid}),[]);
  assert.throws(()=>normalizeCandidates('pixabay',{unexpected:[]}));
  assert.throws(()=>assertMediaUrl('https://cdn.pixabay.com/photo/2026/file.mp4'));
});

test('background selection preserves detail after portrait cropping and prefers native 1080p',()=>{
  const rendition=(name,width,height)=>({url:`https://cdn.pixabay.com/video/2026/10/03/125_${name}.mp4`,width,height,size:100000});
  const medium=rendition('portrait',720,1280);
  const fullHD=rendition('fullhd',1080,1920);
  const landscape4K=rendition('4k',3840,2160);
  const pick=videos=>normalizeCandidates('pixabay',{hits:[{...hit(),videos}]} )[0];
  assert.equal(pick({medium,fullHD,landscape4K}).url,fullHD.url);
  assert.equal(pick({medium,landscape4K}).url,landscape4K.url);
  assert.equal(pick({medium,landscape:rendition('landscape',1920,1080)}).url,medium.url);
  assert.equal(pick({medium,oversized:{...landscape4K,size:71*1024*1024}}).url,medium.url);
});

test('Pixabay search uses documented safety filters, caches for 24 hours and never persists the API key',async t=>{
  const {config,clip}=await fixture(t);
  let queries=0,downloads=0,now=Date.now();
  const deps={now:()=>now,getJson:async(url,options)=>{
    queries++;
    assert.equal(url.origin,'https://pixabay.com');assert.equal(url.pathname,'/api/videos/');
    assert.equal(url.searchParams.get('key'),config.pixabayKey);
    assert.equal(url.searchParams.get('category'),'nature');
    assert.equal(url.searchParams.get('safesearch'),'true');
    assert.equal(url.searchParams.get('video_type'),'film');
    assert.equal(url.searchParams.get('min_width'),'1080');
    assert.equal(url.searchParams.get('min_height'),'1080');
    assert.equal(url.searchParams.get('orientation'),null);
    assert.equal(options.label,'Pixabay');
    return {hits:[hit()]};
  },download:async(url,file,maxBytes)=>{downloads++;assert.equal(maxBytes,70*1024*1024);await copyFile(clip,file);}};
  const first=await fetchBackgroundCandidates(config,'mountains',deps);
  assert.equal(first[0].id,'pixabay-125');
  assert.ok((await readFile(first[0].preview)).length>0);
  assert.equal((await readJson(path.join(path.dirname(first[0].file),'metadata.json'))).approved,false);
  const cacheDir=path.join(config.dataDir,'backgrounds','cache');
  const {readdir}=await import('node:fs/promises');
  for(const name of await readdir(cacheDir))assert.ok(!(await readFile(path.join(cacheDir,name),'utf8')).includes(config.pixabayKey));
  now+=23*60*60*1000;
  await fetchBackgroundCandidates(config,'mountains',deps);
  assert.equal(queries,1);assert.equal(downloads,1);
  now+=2*60*60*1000;
  await fetchBackgroundCandidates(config,'mountains',deps);
  assert.equal(queries,2);assert.equal(downloads,1);
});

test('reviewed Pixabay footage enters the daily library with a license, checksum and no background audio',async t=>{
  const {config,clip,dataDir}=await fixture(t);
  const result=await fetchBackgroundCandidates(config,'mountains',{getJson:async()=>({hits:[hit()]}),download:async(_url,file)=>copyFile(clip,file)});
  await assert.rejects(approveBackground(config,result[0].id,false),/entire clip/);
  const before=await chooseBackground(config,'mountains','2026-10-03',path.join(dataDir,'assets-before'));
  assert.equal(before.kind,'generated');
  const approved=await approveBackground(config,result[0].id,true);
  assert.equal(approved.license,'Pixabay Content License');
  const assets=path.join(dataDir,'assets');
  const selected=await chooseBackground({...config,backgroundMode:'approved'},'mountains','2026-10-03',assets);
  assert.equal(selected.provider,'pixabay');
  const media=await probe(path.join(assets,'background.mp4'));
  assert.ok(media.streams.some(s=>s.codec_type==='video'));
  assert.ok(!media.streams.some(s=>s.codec_type==='audio'));
  await writeFile(path.join(dataDir,'backgrounds','approved','pixabay-125.mp4'),'changed');
  await assert.rejects(chooseBackground(config,'mountains','2026-10-03',assets),/changed after review/);
});

test('provider-qualified IDs retain Pexels and Pixabay clips with the same numeric ID without overwriting',async t=>{
  const {config,clip,dataDir}=await fixture(t);
  const old={id:'125',provider:'pexels',theme:'mountains',creator:'Old creator',sourceUrl:'https://www.pexels.com/video/nature-125/',
    license:'Pexels License',sha256:await fileHash(clip),approved:true,reviewedAt:'2026-10-02'};
  const approvedDir=path.join(dataDir,'backgrounds','approved');await mkdir(approvedDir,{recursive:true});
  await copyFile(clip,path.join(approvedDir,'125.mp4'));
  await writeJson(path.join(dataDir,'backgrounds','approved.json'),[old]);
  await fetchBackgroundCandidates(config,'mountains',{getJson:async()=>({hits:[hit()]}),download:async(_url,file)=>copyFile(clip,file)});
  await approveBackground(config,'pixabay-125',true);
  const entries=await readJson(path.join(dataDir,'backgrounds','approved.json'));
  assert.deepEqual(entries.map(backgroundKey).sort(),['pexels-125','pixabay-125']);
  const selected=await chooseBackground({...config,backgroundProvider:'pexels'},'mountains','2026-10-03',path.join(dataDir,'pexels-assets'));
  assert.equal(selected.provider,'pexels');
});

test('Pixabay approval rejects mismatched licenses, provider URLs and identity',()=>{
  const entry={id:'125',key:'pixabay-125',provider:'pixabay',theme:'mountains',approved:true,reviewedAt:'2026-10-03',
    sourceUrl:'https://pixabay.com/videos/id-125/',license:'Pixabay Content License',licenseUrl:'https://pixabay.com/service/license-summary/',sha256:'a'.repeat(64)};
  assert.equal(validateBackground(entry),entry);
  for(const change of [{approved:false},{license:'Pexels License'},{licenseUrl:'https://example.com/license'},
    {sourceUrl:'https://www.pexels.com/video/125/'},{key:'pexels-125'}])assert.throws(()=>validateBackground({...entry,...change}));
});

test('Discord credits a Pixabay creator, source and license without mentioning Pexels',async t=>{
  const {clip}=await fixture(t);
  const manifest={date:'2026-10-03',passage:{name:'Al-Qadr',id:'97:1-5',chapter:97,from:1,to:5},
    translation:{name:'Maulana Muhammad Junagarhi'},reciter:{name:'Mishari Al-Afasy'},
    background:{provider:'pixabay',creator:'Nature creator',sourceUrl:'https://pixabay.com/videos/id-125/'}};
  await deliver({webhookUrl:'https://discord.com/api/webhooks/123456789012345678/test-token',discordMaxBytes:10000000},manifest,clip,async(_url,init)=>{
    const payload=JSON.parse(init.body.get('payload_json'));
    assert.match(payload.content,/Nature creator on Pixabay/);
    assert.match(payload.content,/https:\/\/pixabay.com\/service\/license-summary\//);
    assert.ok(!payload.content.includes('Pexels'));
    return Response.json({id:'345678901234567890',attachments:[{id:'1'}]});
  });
});

test('Pixabay settings validate the provider and clearly report a missing key',async()=>{
  const config=await loadConfig({BACKGROUND_PROVIDER:'pixabay',PIXABAY_API_KEY:''});
  assert.equal(config.backgroundProvider,'pixabay');
  await assert.rejects(fetchBackgroundCandidates(config,'mountains'),/PIXABAY_API_KEY/);
  await assert.rejects(loadConfig({BACKGROUND_PROVIDER:'unknown'}));
});
