import {parseEnv} from 'node:util';
import {mkdir,readdir,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {renderMediaOnLambda,getRenderProgress} from '@remotion/lambda/client';
import {loadConfig} from '../config.mjs';
import {latestDueDate} from '../scheduler.mjs';
import {selectContent} from '../selector.mjs';
import {prepareVideo,finishVideo,savedSelection} from '../workflow.mjs';
import {ensureProxy,writeJson,readJson,sleep,fileHash} from '../io.mjs';
import {deliver} from '../discord.mjs';
import {renderedObjectKey} from './output.mjs';
import {maintainRetention} from './retention.mjs';
import {prepareCloudBackground} from './background.mjs';
import {retryFailedRender} from './recovery.mjs';
import {runCloudPair} from './pair.mjs';
import {variantPrefix} from '../variants.mjs';
import {REGION,PRIVATE_BUCKET,MEDIA_BUCKET,getObject,getJson,putJson,putFile,getFile,
  signedMedia,signedSite,acquireLease,releaseLease,continueRun,objectMetadata,deleteRetainedObject} from './aws.js';

const ROOT='/tmp/quran-agent';
const STATE_KEY='cloud/state.json';
const terminal=new Set(['delivered','sending','uncertain','starting-render','render-error']);

export async function handler(event={},lambdaContext={}) {
  const remaining=()=>lambdaContext.getRemainingTimeInMillis?.() ?? 900000;
  const lease=await acquireLease(lambdaContext.awsRequestId || randomUUID());
  if(!lease)return {status:'busy'};
  let next=false,stopProxy=()=>{},cloud;
  try {
    await rm(ROOT,{recursive:true,force:true});
    await mkdir(ROOT,{recursive:true,mode:0o700});
    const secret=await getObject('deploy/config.env');
    if(!secret)throw new Error('Private agent configuration is missing');
    const privateEnv=parseEnv(await secret.Body.transformToString());
    const config={...await loadConfig(privateEnv),dataDir:path.join(ROOT,'data'),
      publicDir:path.join(ROOT,'public'),proxyDir:'/var/task/proxy',builtinDir:'/var/task/backgrounds',prepareOnly:true};
    if(config.translationIds.length!==1 || config.translationIds[0]!==234 || config.reciterId!==7) {
      throw new Error('Cloud deployment requires the selected Jalandhri translation and Al-Afasy reciter');
    }
    if(event.action==='health')return {status:'healthy',reciterId:config.reciterId,
      translationIds:config.translationIds,timezone:config.timezone,dailyTime:config.dailyTime,
      qwenConfigured:Boolean(config.qwenKey),pixabayConfigured:Boolean(config.pixabayKey),
      discordConfigured:Boolean(config.botToken && config.discordUserId),dailyVariants:config.dailyVariants ? ['urdu','recitation'] : ['single'],textPanelOpacity:config.textPanelOpacity,builtinBackgrounds:true};
    cloud=await getJson(STATE_KEY,{runs:{},history:[],backgrounds:{runs:{},pages:{}}});
    const date=latestDueDate(new Date(),config.timezone,config.dailyTime);
    const retentionDeps={buckets:{private:PRIVATE_BUCKET,media:MEDIA_BUCKET},objectMetadata,deleteRetainedObject,
      getManifest:(day,id)=>getJson(`${id ? variantPrefix(day,id) : `cloud/runs/${day}`}/manifest.json`,null),
      getPrepared:(day,id)=>getJson(`${id ? variantPrefix(day,id) : `cloud/runs/${day}`}/prepared.json`,null),save:data=>putJson(STATE_KEY,data)};
    if(event.action==='retention-preview')return maintainRetention(cloud,retentionDeps,{date,preview:true});
    try {
      const retention=await maintainRetention(cloud,retentionDeps,{date,force:event.action==='retention'});
      if(event.action==='retention')return retention;
    } catch {
      // Retention failures must never cause a delivered video to be sent again.
      console.error(JSON.stringify({status:'retention-pending',detail:'Media retained; inspect retention permissions and metadata'}));
      if(event.action==='retention')return {status:'retention-pending'};
    }
    let state=cloud.runs[date] || {date,status:'new'};
    if(state.version===2 || (config.dailyVariants && !cloud.runs[date])) {
      return await runCloudPair(config,cloud,date,{remaining,saveCloud:()=>putJson(STATE_KEY,cloud),
        continueLater:()=>{next=true;},maintain:()=>maintainRetention(cloud,retentionDeps,{date,force:true})});
    }
    if(event.action==='retry-render' && state.status==='render-error') {
      const progress=await getJson(`renders/${state.renderId}/progress.json`,null,state.renderBucket);
      state=retryFailedRender(state,progress || {});
      cloud.runs[date]=state;
      await putJson(STATE_KEY,cloud);
    }
    if(terminal.has(state.status))return {date,status:state.status};
    const folder=path.join(config.dataDir,'runs',date);
    await mkdir(folder,{recursive:true,mode:0o700});
    const save=async status=>{
      state={...state,...status,updatedAt:new Date().toISOString()};
      cloud.runs[date]=state;
      await putJson(STATE_KEY,cloud);
    };
    if(!['rendering','rendered','prepared'].includes(state.status)) {
      await writeJson(path.join(config.dataDir,'backgrounds','daily.json'),cloud.backgrounds);
      const prior=cloud.backgrounds.runs[date];
      if(prior?.kind==='video')await getFile(`cloud/backgrounds/${date}.mp4`,
        path.join(config.dataDir,'backgrounds','daily',`${date}.mp4`));
      const selection=savedSelection(state,config) || await selectContent(config,date,cloud.history);
      await save({status:'preparing',selection});
      stopProxy=await ensureProxy(config);
      const prepared=await prepareVideo(config,selection,date,folder);
      stopProxy();stopProxy=()=>{};
      await prepareCloudBackground(prepared);
      cloud.backgrounds=await readJson(path.join(config.dataDir,'backgrounds','daily.json'),cloud.backgrounds);
      if(cloud.backgrounds.runs[date]?.kind==='video')await putFile(`cloud/backgrounds/${date}.mp4`,
        path.join(config.dataDir,'backgrounds','daily',`${date}.mp4`));
      const urls={};
      for(const file of await readdir(prepared.assetDir)) {
        const key=`assets/${date}/${file}`;
        await putFile(key,path.join(prepared.assetDir,file),MEDIA_BUCKET);
        urls[`/agent-cache/${date}/${file}`]=await signedMedia(key);
      }
      const props=prepared.props;
      props.fontSources={};
      for(const font of ['UthmanicHafs1Ver18.woff2','NotoNaskhArabic-Regular.woff2','Figtree.ttf','PlayfairDisplay-Black.ttf']) {
        props.fontSources[font]=await signedMedia(`fonts/${font}`);
      }
      props.audioSrc=urls[props.audioSrc];
      if(props.background.src)props.background.src=urls[props.background.src];
      for(const cue of props.cues) {
        if(cue.arabicAudioSrc)cue.arabicAudioSrc=urls[cue.arabicAudioSrc];
        if(cue.urduAudioSrc)cue.urduAudioSrc=urls[cue.urduAudioSrc];
      }
      await putJson(`cloud/runs/${date}/prepared.json`,{props,context:prepared.context});
      await save({status:'starting-render'});
      const render=await renderMediaOnLambda({region:REGION,
        functionName:process.env.REMOTION_FUNCTION_NAME,serveUrl:await signedSite(),
        composition:'DailyQuranVideo',inputProps:props,codec:'h264',audioCodec:'aac',
        scale:1.5,imageFormat:'png',pixelFormat:'yuv420p',crf:18,x264Preset:'medium',audioBitrate:'160k',
        concurrency:5,concurrencyPerLambda:1,maxRetries:1,privacy:'no-acl',forceBucketName:MEDIA_BUCKET,
        timeoutInMilliseconds:120000});
      await save({status:'rendering',renderId:render.renderId,renderBucket:render.bucketName,error:null});
      next=true;
      return {date,status:'rendering',renderId:render.renderId};
    }
    if(state.status==='rendering') {
      let progress;
      while(remaining()>300000) {
        progress=await getRenderProgress({renderId:state.renderId,bucketName:state.renderBucket,
          functionName:process.env.REMOTION_FUNCTION_NAME,region:REGION});
        if(progress.fatalErrorEncountered) {
          await save({status:'render-error',error:'Remotion reported a fatal rendering error'});
          throw new Error('Cloud rendering failed; the saved run requires inspection');
        }
        if(progress.done)break;
        await sleep(5000);
      }
      if(!progress?.done) {next=true;return {date,status:'rendering',renderId:state.renderId};}
      await save({status:'rendered',masterKey:renderedObjectKey(progress.outputFile,state.renderBucket,state.renderId),
        renderCost:progress.costs?.estimatedCost ?? null});
    }
    const prepared=await getJson(`cloud/runs/${date}/prepared.json`,null);
    if(!prepared)throw new Error('Saved verified content is missing');
    const video=path.join(folder,`quran-${date}-${prepared.context.passage.chapter}.mp4`);
    if(state.status==='rendered') {
      if(!await getFile(state.masterKey,video,state.renderBucket))throw new Error('Rendered master is missing');
      const manifest=await finishVideo(config,state.selection,date,folder,prepared.props,prepared.context,video);
      manifest.cloud={provider:'Remotion Lambda',region:REGION,renderId:state.renderId,
        masterBucket:state.renderBucket,masterKey:state.masterKey};
      const uploadKey=`cloud/runs/${date}/video.discord.mp4`;
      await putFile(uploadKey,manifest.upload.file);
      await putFile(`cloud/runs/${date}/preview.png`,path.join(folder,'preview.png'));
      await putJson(`cloud/runs/${date}/manifest.json`,manifest);
      await save({status:'prepared',uploadKey});
    }
    const manifest=await getJson(`cloud/runs/${date}/manifest.json`,null);
    const upload=path.join(folder,path.basename(manifest.upload.file));
    if(!await getFile(state.uploadKey,upload))throw new Error('Prepared Discord copy is missing');
    if(await fileHash(upload)!==manifest.upload.sha256)throw new Error('Prepared Discord copy failed its saved checksum');
    await save({status:'sending',attemptedAt:new Date().toISOString()});
    let receipt;
    try {receipt=await deliver(config,manifest,upload);}
    catch(error) {
      await save({status:error.uncertain ? 'uncertain' : 'prepared',error:error.message});
      throw error;
    }
    cloud.history=[...cloud.history.filter(h=>h.date!==date),
      {date,passageId:manifest.passage.id,messageId:receipt.messageId}].slice(-365);
    await save({status:'delivered',error:null,...receipt});
    try {await maintainRetention(cloud,retentionDeps,{date,force:true});}
    catch {console.error(JSON.stringify({status:'retention-pending',detail:'Delivered media retained for later cleanup'}));}
    console.log(JSON.stringify({date,status:'delivered',renderId:state.renderId,messageId:receipt.messageId}));
    return {date,status:'delivered',renderId:state.renderId};
  } catch(error) {
    // Request URLs, model credentials and private configuration never enter logs.
    console.error(JSON.stringify({status:'failed',name:error.name || 'Error',
      detail:/^(Cloud |Saved |Prepared |Rendered |Private |Discord |Quran |Complete |Selected |Missing |Media )/.test(error.message) ? error.message : 'Inspect the saved run and service metrics'}));
    throw new Error('Daily Quran cloud run failed safely');
  } finally {
    stopProxy();
    await releaseLease(lease);
    if(next)await continueRun();
  }
}
