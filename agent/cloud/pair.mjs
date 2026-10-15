import path from 'node:path';
import {mkdir,readdir} from 'node:fs/promises';
import {DAILY_VARIANTS,newPair,nextVariant,pairStatus,variantPrefix,videoVariant} from '../variants.mjs';
import {prepareVideo,finishVideo,savedSelection} from '../workflow.mjs';
import {selectContent} from '../selector.mjs';
import {ensureProxy,writeJson,readJson,fileHash,sleep} from '../io.mjs';
import {deliver} from '../discord.mjs';
import {fallbackBackground} from '../builtin-backgrounds.mjs';
import {prepareCloudBackground} from './background.mjs';
import {renderedObjectKey} from './output.mjs';
import {retryFailedRender} from './recovery.mjs';
import {renderMediaOnLambda,getRenderProgress} from '@remotion/lambda/client';
import {REGION,MEDIA_BUCKET,getJson,putJson,putFile,getFile,signedMedia,signedSite} from './aws.js';

export async function runCloudPair(config,cloud,date,{remaining,saveCloud,continueLater,maintain}) {
  const run=cloud.runs[date] ||= newPair(date);
  const save=async()=>{run.status=pairStatus(run);run.updatedAt=new Date().toISOString();await saveCloud();};
  const folder=path.join(config.dataDir,'runs',date);
  await mkdir(folder,{recursive:true,mode:0o700});
  for(const failedId of DAILY_VARIANTS) {
    const state=run.variants[failedId];
    if(state.status!=='render-error' || state.stockFallbackAttempted)continue;
    const prefix=variantPrefix(date,failedId);
    const prepared=await getJson(`${prefix}/prepared.json`,null);
    if(!prepared)continue;
    const id=failedId;
        if(prepared.context.background.provider==='pixabay' && !state.stockFallbackAttempted) {
          const raw=await getJson(`renders/${state.renderId}/progress.json`,null,state.renderBucket);
          try {
            const repaired=retryFailedRender({...state,selection:run.selection},raw || {});
            const assetDir=path.join(config.publicDir,'agent-cache',date);
            const bg=await fallbackBackground(config,run.selection.theme,date,assetDir,'Expired stock render failed');
            const replacement={assetDir,props:{background:bg},context:{background:bg}};
            await prepareCloudBackground(replacement);
            if(bg.src) {
              const key=`assets/${date}/background-fallback.mp4`;
              await putFile(key,path.join(assetDir,'background.mp4'),MEDIA_BUCKET);
              bg.src=await signedMedia(key);
            }
            prepared.retentionSources=[...(prepared.retentionSources || []),prepared.props.background.src].filter(Boolean);
            prepared.props.background=prepared.context.background=bg;
            await putJson(`${prefix}/prepared.json`,prepared);
            // A later unstarted variant uses the same fallback scenery.
            for(const other of DAILY_VARIANTS.filter(v=>v!==id && run.variants[v].status==='new')) {
              const saved=await getJson(`${variantPrefix(date,other)}/prepared.json`,null);
              saved.retentionSources=[...(saved.retentionSources || []),saved.props.background.src].filter(Boolean);
              saved.props.background=saved.context.background=bg;
              await putJson(`${variantPrefix(date,other)}/prepared.json`,saved);
            }
            Object.assign(state,repaired,{status:'new',stockFallbackAttempted:true,repair:'Expired unsent stock render switched to default background'});
            await save();continueLater();return {date,variant:id,status:'fallback-prepared'};
          } catch {
            // Active/ambiguous/completed renders retain the inspection guard.
          }
        }
  }
  const id=nextVariant(run);
  if(!id)return {date,status:pairStatus(run)};
  if(!run.prepared) {
    run.selection=savedSelection(run,config) || await selectContent(config,date,cloud.history);
    await save();
    await writeJson(path.join(config.dataDir,'backgrounds','daily.json'),cloud.backgrounds);
    if(cloud.backgrounds.runs[date]?.kind==='video')await getFile(`cloud/backgrounds/${date}.mp4`,path.join(config.dataDir,'backgrounds','daily',`${date}.mp4`));
    const stop=await ensureProxy(config);
    let prepared;
    try {prepared=await prepareVideo({...config,translationAudio:'urdu'},run.selection,date,folder);}
    finally {stop();}
    try {await prepareCloudBackground(prepared);}
    catch {
      if(prepared.props.background.provider!=='pixabay')throw new Error('Cloud built-in background normalization failed');
      prepared.props.background=prepared.context.background=await fallbackBackground(config,run.selection.theme,date,prepared.assetDir,'Stock normalization failed');
      await prepareCloudBackground(prepared);
    }
    cloud.backgrounds=await readJson(path.join(config.dataDir,'backgrounds','daily.json'),cloud.backgrounds);
    if(cloud.backgrounds.runs[date]?.kind==='video')await putFile(`cloud/backgrounds/${date}.mp4`,path.join(config.dataDir,'backgrounds','daily',`${date}.mp4`));
    const urls={};
    for(const file of await readdir(prepared.assetDir)) {
      const key=`assets/${date}/${file}`;
      await putFile(key,path.join(prepared.assetDir,file),MEDIA_BUCKET);
      urls[`/agent-cache/${date}/${file}`]=await signedMedia(key);
    }
    const props=prepared.props;
    props.fontSources={};
    for(const font of ['UthmanicHafs1Ver18.woff2','NotoNaskhArabic-Regular.woff2','Figtree.ttf','PlayfairDisplay-Black.ttf'])props.fontSources[font]=await signedMedia(`fonts/${font}`);
    props.audioSrc=urls[props.audioSrc];
    if(props.background.src)props.background.src=urls[props.background.src];
    for(const c of props.cues) {
      if(c.arabicAudioSrc)c.arabicAudioSrc=urls[c.arabicAudioSrc];
      if(c.urduAudioSrc)c.urduAudioSrc=urls[c.urduAudioSrc];
    }
    for(const variant of DAILY_VARIANTS)await putJson(`${variantPrefix(date,variant)}/prepared.json`,videoVariant(prepared,variant));
    run.prepared=true;
    await save();
  }
  const state=run.variants[id];
  const prefix=variantPrefix(date,id);
  const prepared=await getJson(`${prefix}/prepared.json`,null);
  if(!prepared)throw new Error('Saved variant content is missing');
  // Renew only our known same-date assets/fonts when a later invocation resumes.
  const refresh=async src=>{
    if(!src)return src;
    const u=new URL(src);
    if(![`${MEDIA_BUCKET}.s3.us-east-1.amazonaws.com`,`${MEDIA_BUCKET}.s3.amazonaws.com`].includes(u.hostname))throw new Error('Saved variant media bucket differs');
    const key=decodeURIComponent(u.pathname.slice(1));
    if(!(key.startsWith(`assets/${date}/`) || /^fonts\/[A-Za-z0-9_.-]+$/.test(key)) || key.includes('..'))throw new Error('Saved variant media path differs');
    return signedMedia(key);
  };
  if(state.status==='new') {
    prepared.props.audioSrc=await refresh(prepared.props.audioSrc);
    if(prepared.props.background.src)prepared.props.background.src=await refresh(prepared.props.background.src);
    for(const font of Object.keys(prepared.props.fontSources))prepared.props.fontSources[font]=await refresh(prepared.props.fontSources[font]);
    for(const c of prepared.props.cues) {
      if(c.arabicAudioSrc)c.arabicAudioSrc=await refresh(c.arabicAudioSrc);
      if(c.urduAudioSrc)c.urduAudioSrc=await refresh(c.urduAudioSrc);
    }
    await putJson(`${prefix}/prepared.json`,prepared);
    state.status='starting-render';await save();
    const r=await renderMediaOnLambda({region:REGION,functionName:process.env.REMOTION_FUNCTION_NAME,
      serveUrl:await signedSite(),composition:'DailyQuranVideo',inputProps:prepared.props,
      codec:'h264',audioCodec:'aac',scale:1.5,imageFormat:'png',pixelFormat:'yuv420p',crf:18,
      x264Preset:'medium',audioBitrate:'160k',concurrency:5,concurrencyPerLambda:1,maxRetries:1,
      privacy:'no-acl',forceBucketName:MEDIA_BUCKET,timeoutInMilliseconds:120000});
    Object.assign(state,{status:'rendering',renderId:r.renderId,renderBucket:r.bucketName});await save();
    continueLater();return {date,variant:id,status:'rendering',renderId:r.renderId};
  }
  if(state.status==='rendering') {
    let progress;
    // Encoding/delivery runs in a fresh invocation, with its full time budget.
    while(remaining()>60000) {
      progress=await getRenderProgress({renderId:state.renderId,bucketName:state.renderBucket,
        functionName:process.env.REMOTION_FUNCTION_NAME,region:REGION});
      if(progress.fatalErrorEncountered) {
        state.status='render-error';await save();
        return {date,variant:id,status:'render-error'};
      }
      if(progress.done)break;
      await sleep(5000);
    }
    if(progress?.done)Object.assign(state,{status:'rendered',masterKey:renderedObjectKey(progress.outputFile,state.renderBucket,state.renderId),renderCost:progress.costs?.estimatedCost ?? null});
    await save();continueLater();return {date,variant:id,status:state.status};
  }
  const variantFolder=path.join(folder,id);
  await mkdir(variantFolder,{recursive:true,mode:0o700});
  const video=path.join(variantFolder,`quran-${date}-${prepared.context.passage.chapter}-${id}.mp4`);
  if(state.status==='rendered') {
    if(!await getFile(state.masterKey,video,state.renderBucket))throw new Error('Rendered variant master is missing');
    const manifest=await finishVideo({...config,translationAudio:id==='urdu' ? 'urdu' : 'none'},run.selection,date,
      variantFolder,prepared.props,prepared.context,video);
    manifest.cloud={provider:'Remotion Lambda',region:REGION,renderId:state.renderId,masterBucket:state.renderBucket,masterKey:state.masterKey};
    await putFile(`${prefix}/video.discord.mp4`,manifest.upload.file);
    await putFile(`${prefix}/preview.png`,path.join(variantFolder,'preview.png'));
    await putJson(`${prefix}/manifest.json`,manifest);
    Object.assign(state,{status:'prepared',uploadKey:`${prefix}/video.discord.mp4`});await save();
    continueLater();return {date,variant:id,status:'prepared'};
  }
  const manifest=await getJson(`${prefix}/manifest.json`,null);
  if(!manifest || manifest.variant!==id)throw new Error('Prepared variant manifest differs');
  const upload=path.join(variantFolder,path.basename(manifest.upload.file));
  if(!await getFile(state.uploadKey,upload) || await fileHash(upload)!==manifest.upload.sha256)throw new Error('Prepared variant copy failed checksum');
  state.status='sending';state.attemptedAt=new Date().toISOString();await save();
  let receipt;
  try {receipt=await deliver(config,manifest,upload);}
  catch(error) {Object.assign(state,{status:error.uncertain ? 'uncertain' : 'prepared',error:error.message});await save();throw error;}
  Object.assign(state,{status:'delivered',error:null,...receipt});await save();
  cloud.history=[...cloud.history.filter(h=>h.date!==date),{date,passageId:run.selection.passageId,
    messageId:receipt.messageId,variants:Object.fromEntries(DAILY_VARIANTS.map(v=>[v,run.variants[v].messageId || null]))}].slice(-365);
  await saveCloud();
  if(nextVariant(run))continueLater();
  else {try {await maintain();}catch {console.error('Delivered variant media retained for later cleanup');}}
  return {date,variant:id,status:'delivered',pairStatus:pairStatus(run)};
}
