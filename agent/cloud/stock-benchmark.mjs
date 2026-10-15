// Render-only stress fixture. This script never reads agent credentials,
// invokes AWS, updates daily ledgers, or sends Discord messages.
import path from 'node:path';
import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {LambdaClientInternals} from '@remotion/lambda/client';
import {isNatureCandidate} from '../backgrounds.mjs';
import {command,probe,fileHash} from '../io.mjs';
import {prepareCloudBackground} from './background.mjs';
const folder='build/stock-benchmark';
const prefix='assets/stock-benchmark-2026-10-12';
const bucket='remotionlambda-useast1-quran-129631621612';
const mode=process.argv[2];

if(mode==='prepare') {
 await mkdir(folder,{recursive:true,mode:0o700});
 const source=JSON.parse(await readFile(`${folder}/prepared-source.json`,'utf8'));
 const props=source.props;
 if(source.context.passage.id!=='97:1-5' || source.context.resource.id!==234 ||
  props.fps!==30 || props.translationAudio!=='urdu')throw new Error('Benchmark source differs from verified preferences');
 if(await fileHash(`${folder}/source-master.mp4`)!=='195a2246a0feecce2960f253c08c13036076ba02a44d41c13c8e0aa8d3feda08')throw new Error('Verified source master checksum mismatch');
 const ledger=JSON.parse(await readFile('../data/backgrounds/daily.json','utf8'));
 const background=ledger.runs['2026-10-05'];
 if(!isNatureCandidate(background))throw new Error('Benchmark stock fails current screening');
 const stock='../data/backgrounds/daily/2026-10-05.mp4';
 if(await fileHash(stock)!==background.sha256)throw new Error('Stock source checksum mismatch');
 await copyFile(stock,`${folder}/background.mp4`);
 const prepared={assetDir:folder,props:{background},context:{background:{...background}}};
 await prepareCloudBackground(prepared);
 const frames=props.durationInFrames,seconds=frames/props.fps;
 if(props.cues.some(c=>c.urduFromFrame+c.urduFrames>frames-15))throw new Error('Original narration lacks a complete ending before audio padding');
 await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',`${folder}/source-master.mp4`,
  '-map','0:a:0','-af',`apad,atrim=duration=${seconds},asetpts=N/SR/TB`,'-ar','48000','-ac','2','-f','s16le',`${folder}/source-loop.pcm`]);
 await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-stream_loop','1','-f','s16le','-ar','48000','-ac','2',
  '-i',`${folder}/source-loop.pcm`,'-t',String(seconds*2),'-c:a','pcm_s16le',`${folder}/recitation.wav`]);
 await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',`${folder}/recitation.wav`,'-f','s16le',`${folder}/check.pcm`]);
 const raw=await readFile(`${folder}/source-loop.pcm`);
 const expected=createHash('sha256').update(raw).update(raw).digest('hex');
 if(await fileHash(`${folder}/check.pcm`)!==expected)throw new Error('Benchmark audio changed during repetition');
 await rm(`${folder}/check.pcm`);
 const first=props.cues.map(c=>({...c}));
 const second=first.map(c=>({...c,fromFrame:c.fromFrame+frames,toFrame:c.toFrame+frames,urduFromFrame:c.urduFromFrame+frames}));
 for(const c of [...first,...second]){delete c.arabicAudioSrc;delete c.urduAudioSrc;}
 const benchmark={...props,cues:[...first,...second],durationInFrames:frames*2,intro:0,
  translationAudio:'none',audioSrc:`/${prefix}/recitation.wav`,
  background:{...prepared.context.background,kind:'video',src:`/${prefix}/background.mp4`},fontSources:{}};
 await writeFile(`${folder}/props-local.json`,JSON.stringify(benchmark),{mode:0o600});
 const report={purpose:'Render-only stock stress test, no daily delivery',sourcePassage:'97:1-5',
  completePassageRepetitions:2,durationInFrames:benchmark.durationInFrames,fps:30,durationSeconds:seconds*2,
  sourceMasterSha256:await fileHash(`${folder}/source-master.mp4`),audioPcmVerified:true,
  background:prepared.context.background,settings:{width:1080,height:1920,crf:18,audioBitrate:160000,workers:5}};
 await writeFile(`${folder}/fixture.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({durationSeconds:report.durationSeconds,frames:report.durationInFrames,stockId:background.id,
  stockSha256Verified:true,audioPcmVerified:true,rendition:prepared.context.background.renderRendition}));
} else if(mode==='payload') {
 const lines=createInterface({input:process.stdin});
 const input=await new Promise(resolve=>lines.once('line',resolve));
 lines.close();process.stdin.pause();
 const urls=JSON.parse(input);
 const get=key=>{const item=urls.find(x=>x.bucket===bucket&&x.key===key);if(!item?.url?.startsWith('https://'))throw new Error('Missing signed benchmark input');return item.url;};
 const props=JSON.parse(await readFile(`${folder}/props-local.json`,'utf8'));
 props.audioSrc=get(`${prefix}/recitation.wav`);props.background.src=get(`${prefix}/background.mp4`);
 for(const font of ['UthmanicHafs1Ver18.woff2','NotoNaskhArabic-Regular.woff2','Figtree.ttf','PlayfairDisplay-Black.ttf'])props.fontSources[font]=get(`fonts/${font}`);
 const options=LambdaClientInternals.renderMediaOnLambdaOptionalToRequired({region:'us-east-1',
  functionName:'remotion-render-4-0-534-mem3008mb-disk10240mb-900sec',serveUrl:get('sites/quran/index.html'),
  composition:'DailyQuranVideo',inputProps:props,codec:'h264',audioCodec:'aac',scale:1.5,imageFormat:'png',
  pixelFormat:'yuv420p',crf:18,x264Preset:'medium',audioBitrate:'160k',concurrency:5,concurrencyPerLambda:1,
  maxRetries:1,privacy:'no-acl',forceBucketName:bucket,timeoutInMilliseconds:120000});
 const payload=await LambdaClientInternals.makeLambdaRenderMediaPayload(options);
 await writeFile(`${folder}/payload.json`,JSON.stringify(payload),{mode:0o600});
 console.log(JSON.stringify({payloadPrepared:true,bytes:Buffer.byteLength(JSON.stringify(payload)),type:payload.type}));
} else throw new Error('Use prepare or payload');
