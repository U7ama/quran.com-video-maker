// Complete-passage local validation of the deployed composition; never delivers.
import path from 'node:path';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {selectComposition,renderMedia} from '@remotion/renderer';
import {loadConfig} from '../config.mjs';
import {prepareVideo} from '../workflow.mjs';
import {ensureProxy,writeJson,readJson,fileHash,probe} from '../io.mjs';
import {createHash} from 'node:crypto';
import {URDU_AUDIO} from '../translation-audio.mjs';
import {verifyVideo} from '../render.mjs';
import {videoVariant} from '../variants.mjs';
import {builtinBackground} from '../builtin-backgrounds.mjs';
import {prepareCloudBackground} from './background.mjs';

const root=path.resolve('build/pair-validation');
const config={...await loadConfig(),dataDir:path.join(root,'data'),publicDir:path.join(root,'public'),
  prepareOnly:true,backgroundMode:'generated',translationAudio:'urdu',textPanelOpacity:0.2};
await mkdir(root,{recursive:true,mode:0o700});
let prepared;
const folder=path.join(root,'source');
const cached=await readJson(path.join(folder,'render-props.json'),null);
if(cached) {
  const source=await readJson(path.join(folder,'source.json'));
  if(cached.passageId!=='108:1-3' || source.translation.id!==234 || source.reciter.id!==7)throw new Error('Cached validation preferences differ');
  const sums=await readFile(path.join(folder,'urdu-checksums.md5'),'utf8');
  for(const cue of cached.cues) {
    const name=cue.key.split(':').map(n=>n.padStart(3,'0')).join('')+'.mp3';
    const expected=sums.split(/\r?\n/).find(line=>line.trim().endsWith(name))?.match(/\b[a-f\d]{32}\b/i)?.[0]?.toLowerCase();
    const actual=createHash('md5').update(await readFile(path.join(folder,'urdu-'+name))).digest('hex');
    if(!expected || actual!==expected)throw new Error('Cached Urdu recording checksum failed');
  }
  const audio=await probe(path.join(folder,'recitation-source.mp3'));
  if(Number(audio.format.duration)*1000<cached.endMs-80)throw new Error('Cached recitation is incomplete');
  prepared={props:cached,assetDir:path.join(config.publicDir,'agent-cache','source'),context:{
    passage:{id:'108:1-3',chapter:108,from:1,to:3,name:'Al-Kawthar'},resource:source.translation,reciter:source.reciter,
    narration:{...URDU_AUDIO},audioUrl:source.audio.audio_url,recitationHash:await fileHash(path.join(folder,'recitation-source.mp3'))}};
  console.log('Reusing complete recorded validation inputs; Urdu provider checksums passed.');
} else {
  const stop=await ensureProxy(config);
  try {prepared=await prepareVideo(config,{passageId:'108:1-3',translationId:234,theme:'ocean',selector:'sample'},'2026-10-12',folder,console.log);}
  finally {stop();}
}
prepared.props.background=prepared.context.background=await builtinBackground(config,'ocean','2026-10-12',prepared.assetDir,'Isolated built-in validation');
await prepareCloudBackground(prepared);
const html=await readFile('build/site-private.html');
const server=http.createServer(async(req,res)=>{
  try {
    if(req.url==='/index.html'){res.setHeader('Content-Type','text/html');res.end(html);return;}
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/public\//,'/');
    if(!/^\/agent-cache\/source\/[A-Za-z0-9_.-]+$/.test(name)) {res.writeHead(404);res.end();return;}
    const file=path.join(config.publicDir,name);
    res.setHeader('Content-Type',name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
    res.end(await readFile(file));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
try {
  const result={};
  for(const id of ['urdu','recitation']) {
    const {props}=videoVariant(prepared,id);
    // HTTPS media is a cloud input; local static assets remain on this server.
    props.fontSources={};
    for(const font of ['UthmanicHafs1Ver18.woff2','NotoNaskhArabic-Regular.woff2','Figtree.ttf','PlayfairDisplay-Black.ttf']) {
      props.fontSources[font]=`data:application/octet-stream;base64,${(await readFile(`../../quran.com-frontend-next/public/publicMin/${font}`)).toString('base64')}`;
    }
    await writeJson(path.join(root,`${id}-props.json`),props);
    const composition=await selectComposition({serveUrl:`${origin}/index.html`,id:'DailyQuranVideo',inputProps:props,browserExecutable:config.chromePath});
    const output=path.join(root,`${id}.mp4`);const start=Date.now();
    await renderMedia({serveUrl:`${origin}/index.html`,composition,inputProps:props,outputLocation:output,
      codec:'h264',audioCodec:'aac',audioBitrate:'160k',crf:18,x264Preset:'medium',pixelFormat:'yuv420p',
      scale:1.5,imageFormat:'png',concurrency:2,browserExecutable:config.chromePath,
      onProgress:({progress})=>{if(progress===1)console.log(`${id} frames completed`);}});
    result[id]={...await verifyVideo(output,props.durationInFrames/props.fps),secondsToRender:(Date.now()-start)/1000,
      translationAudio:props.translationAudio,textPanelOpacity:props.textPanelOpacity};
    console.log(JSON.stringify({variant:id,...result[id]}));
  }
  await writeJson(path.join(root,'result.json'),result);
} finally {server.close();}
