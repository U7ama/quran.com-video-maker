import {mkdir, readFile, rm, copyFile} from 'node:fs/promises';
import path from 'node:path';
import {dayKey} from './config.mjs';
import {PASSAGES, TRANSLATIONS, validateContent, validateSelection, makeTimeline, hash, deliveryAction} from './core.mjs';
import {latestDueDate} from './scheduler.mjs';
import {readJson, writeJson, getJson, download, probe, command, ensureProxy, acquireLock, fileHash, isFile} from './io.mjs';
import {selectContent} from './selector.mjs';
import {chooseBackground} from './backgrounds.mjs';
import {renderVideo, fitDiscord} from './render.mjs';
import {deliver, hasDeliveryConfig} from './discord.mjs';
import {prepareUrduAudio, makeSpokenTimeline} from './translation-audio.mjs';
import {runLocalPair} from './local-pair.mjs';

export async function prepareVideo(config, selection, date, folder, log=console.log) {
  const passage=PASSAGES.find(p=>p.id===selection.passageId);
  if(!passage) throw new Error('Unknown permitted passage');
  const translations=await getJson(`${config.proxyUrl}/resources/translations?language=en`,{label:'Quran translations'});
  const resource=translations.translations?.find(t=>t.id===selection.translationId);
  if(!resource || resource.language_name!==TRANSLATIONS[selection.translationId].language) {
    throw new Error('Selected translation is no longer available with the expected language');
  }
  const reciters=await getJson(`${config.proxyUrl}/audio/reciters?locale=en`,{label:'Quran reciters'});
  const reciter=reciters.reciters?.find(r=>r.id===config.reciterId);
  if(!reciter) throw new Error('Selected verified reciter is unavailable');
  const query=new URLSearchParams({words:'true',translations:String(selection.translationId),
    per_page:'50',fields:'text_uthmani,chapter_id,juz_number',translation_fields:'resource_name,language_id'});
  const verses=await getJson(`${config.proxyUrl}/verses/by_chapter/${passage.chapter}?${query}`,{label:'Quran verses'});
  const audioResponse=await getJson(`${config.proxyUrl}/audio/reciters/${config.reciterId}/audio_files?chapter=${passage.chapter}&segments=true`,{label:'Quran audio metadata'});
  const audio=audioResponse.audio_files?.find(a=>a.chapter_id===passage.chapter);
  const cues=validateContent(verses,audio,passage,selection.translationId);
  const narration=config.translationAudio!=='none' ? await prepareUrduAudio(cues,folder) : null;
  const timeline=narration ? makeSpokenTimeline(cues,narration.durations,config.translationAudio) : makeTimeline(cues,30);
  const seconds=timeline.durationInFrames/timeline.fps;
  if(seconds>config.maxSeconds) throw new Error('Complete passage exceeds the maximum length; it will not be truncated');
  await mkdir(folder,{recursive:true,mode:0o700});
  await writeJson(path.join(folder,'source.json'),{verses,audio,translation:resource,reciter});
  const runId=path.basename(folder);
  const assetDir=path.join(config.publicDir,'agent-cache',runId);
  await mkdir(assetDir,{recursive:true,mode:0o700});
  const sourceAudio=path.join(folder,'recitation-source.mp3');
  await download(audio.audio_url,sourceAudio,30*1024*1024);
  const sourceProbe=await probe(sourceAudio);
  const sourceDuration=Number(sourceProbe.format.duration);
  if(!sourceProbe.streams.some(s=>s.codec_type==='audio') ||
      !Number.isFinite(sourceDuration) || sourceDuration*1000<timeline.endMs-80) {
    throw new Error('Recitation file is missing or shorter than the complete selected passage');
  }
  const localAudio=path.join(assetDir,'recitation.wav');
  await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',sourceAudio,
    '-ss',String(timeline.startMs/1000),'-t',String((timeline.endMs-timeline.startMs)/1000),
    '-vn','-c:a','pcm_s16le',localAudio]);
  if(narration) {
    for(let i=0;i<timeline.cues.length;i++) {
      const cue=timeline.cues[i];
      const arabicFile=path.join(assetDir,`arabic-${i}.wav`);
      await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',sourceAudio,
        '-ss',String(cue.fromMs/1000),'-t',String((cue.toMs-cue.fromMs)/1000),'-vn','-c:a','pcm_s16le',arabicFile]);
      await copyFile(narration.recordings[i].file,path.join(assetDir,`urdu-${i}.mp3`));
      cue.arabicAudioSrc=`/agent-cache/${runId}/arabic-${i}.wav`;
      cue.urduAudioSrc=`/agent-cache/${runId}/urdu-${i}.mp3`;
    }
  }
  const chapterResponse=await getJson(`${config.proxyUrl}/chapters/${passage.chapter}?language=ar`,{label:'Quran chapter information'});
  const chapterArabicName=chapterResponse.chapter?.name_arabic;
  if(!chapterArabicName)throw new Error('Missing verified Arabic surah name');
  for(let i=0;i<timeline.cues.length;i++) {
    const verse=verses.verses[i];
    const displayWords=verse.words?.map(w=>w.text);
    timeline.cues[i].displayArabic=displayWords?.length && displayWords.every(w=>typeof w==='string'&&w.trim()) ? displayWords.join(' ') : timeline.cues[i].arabic;
    timeline.cues[i].juzNumber=verse.juz_number;
  }
  const background=await chooseBackground(config,selection.theme,date,assetDir);
  log(background.kind==='video' ? `Background: ${background.provider}-${background.id} (${background.reviewMode || 'reviewed library'}).` : `Background: generated scenery${background.fallbackReason ? `; ${background.fallbackReason}` : ''}.`);
  const props={
    passageName:`Surah ${passage.name}`,passageId:passage.id,chapterId:passage.chapter,chapterArabicName,
    translator:resource.name,language:resource.language_name,
    ...timeline,audioSrc:`/agent-cache/${runId}/recitation.wav`,background,textPanelOpacity:config.textPanelOpacity ?? 0.2,
  };
  await writeJson(path.join(folder,'render-props.json'),props);
  log(`Selected ${passage.id}; Urdu/English text is from the verified resource, not the model.`);
  log(`Complete recitation video: ${seconds.toFixed(1)} seconds (no stretching or verse truncation).`);
  const context={passage,resource,reciter,narration,background,
    audioUrl:audio.audio_url,recitationHash:await fileHash(sourceAudio),contentHash:hash(JSON.stringify(verses))};
  if(config.prepareOnly)return {props,context,assetDir};
  const video=path.join(folder,`quran-${date}-${passage.chapter}.mp4`);
  await renderVideo(config,props,video,log);
  const manifest=await finishVideo(config,selection,date,folder,props,context,video);
  await rm(assetDir,{recursive:true,force:true});
  return manifest;
}

export async function finishVideo(config,selection,date,folder,props,context,video) {
  const {passage,resource,reciter,narration,background}=context;
  const seconds=props.durationInFrames/props.fps;
  const {verifyVideo}=await import('./render.mjs');
  const verified=await verifyVideo(video,seconds);
  const upload=await fitDiscord(config,video,seconds);
  // Frame previews are local artefacts; they are never sent to a model.
  await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(Math.min(3,seconds/2)),
    '-i',video,'-frames:v','1',path.join(folder,'preview.png')]);
  const manifest={date,createdAt:new Date().toISOString(),passage,
    translation:{id:resource.id,name:resource.name,language:resource.language_name},
    reciter:{id:reciter.id,name:reciter.name},narration,background,selector:selection.selector,
    ...(selection.selector==='qwen' ? {modelSelection:{model:selection.model,usage:selection.usage || null}} : {}),
    variant:props.variant || null,
    presentation:{layout:'frontend-shared',translationAudio:props.translationAudio || config.translationAudio,textPanelOpacity:props.textPanelOpacity ?? 0.2,fps:props.fps,
      masterEncoding:{codec:'h264',crf:18,audioBitrate:160000}},
    video:verified,upload:{file:upload.file,bytes:upload.bytes,sha256:upload.sha256,
      encoding:upload.encoding,width:upload.width,height:upload.height},
    sources:{quran:`https://quran.com/${passage.chapter}/${passage.from}-${passage.to}`,
      audio:context.audioUrl,recitationHash:context.recitationHash,
      contentHash:context.contentHash,},
    safeguards:{completePassage:true,verifiedText:true,verifiedRecitation:true,noMusic:true,
      backgroundReviewed:background.kind==='generated'||background.approved===true,
      backgroundAutomaticallyScreened:background.reviewMode==='automated-metadata',
      noGeneratedReligiousClaims:true},
  };
  await writeJson(path.join(folder,'manifest.json'),manifest);
  return manifest;
}

export async function deliverPrepared(config,state,folder,save=writeJson,send=deliver) {
  const action=deliveryAction(state);
  if(action==='skip') return state;
  if(action==='hold') throw new Error('Previous delivery is unconfirmed. Check your Discord DM before resolving this run.');
  const manifest=await readJson(path.join(folder,'manifest.json'));
  const file=manifest.upload.file;
  if(!await isFile(file) || await fileHash(file)!==manifest.upload.sha256) throw new Error('Prepared video changed or disappeared');
  const stateFile=path.join(folder,'state.json');
  state={...state,status:'sending',attemptedAt:new Date().toISOString()};
  await save(stateFile,state); // Persist before the external side effect.
  let receipt;
  try {
    receipt=await send(config,manifest,file);
  } catch(error) {
    state={...state,status:error.uncertain ? 'uncertain' : 'prepared',lastError:error.message};
    await save(stateFile,state);
    throw error;
  }
  state={...state,status:'delivered',...receipt};
  try { await save(stateFile,state); }
  catch {
    // The durable 'sending' record must remain in place if receipt storage fails.
    throw Object.assign(new Error('Discord accepted the video but the receipt could not be saved; check your DM'),{uncertain:true});
  }
  return state;
}

export async function runDue(config,{now=new Date(),log=console.log,run=runDaily}={}) {
  const date=latestDueDate(now,config.timezone,config.dailyTime);
  const state=await readJson(path.join(config.dataDir,'runs',date,'state.json'),null);
  if(state?.status==='delivered') {log(`Scheduled video already delivered (${date}); nothing due.`);return {status:'skip',date};}
  if(state && deliveryAction(state)==='hold') {log(`Unconfirmed delivery (${date}) held for inspection; no automatic resend.`);return {status:'hold',date};}
  log(`Checking latest scheduled Quran video: ${date}.`);
  try {return await run(config,{scheduledDate:date,log});}
  catch(error) {
    // Distinguish an application failure from systemd-inhibit's transient launch
    // failure. Application/network errors retry on the normal 15-minute timer.
    error.exitCode ||= 70;
    throw error;
  }
}

export function savedSelection(state,config) {
  try {
    validateSelection(state.selection,config.translationIds);
    if(!['qwen','catalogue'].includes(state.selection.selector))return null;
    return state.selection;
  } catch {return null;}
}

export async function runDaily(config,{renderOnly=false,sample=false,passageId,scheduledDate,log=console.log}={}) {
  if(!sample && !renderOnly && !hasDeliveryConfig(config)) {
    throw Object.assign(new Error('Discord is not configured. Add a bot token and your user ID to agent/.env; no daily video has been sent.'),{exitCode:78});
  }
  const release=await acquireLock(config);
  let stopProxy=()=>{};
  try {
    const today=dayKey(new Date(),config.timezone);
    if(scheduledDate && (sample || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || scheduledDate>today))throw new Error('Invalid scheduled catch-up date');
    const date=scheduledDate || today;
    const id=sample ? `sample-${date}-${Date.now()}` : date;
    const folder=path.join(config.dataDir,'runs',id);
    await mkdir(folder,{recursive:true,mode:0o700});
    if(!sample && config.dailyVariants) {
      const paired=await runLocalPair(config,date,folder,{renderOnly,log});
      if(paired)return paired;
    }
    let state=await readJson(path.join(folder,'state.json'),{date,status:'new'});
    if(state.status==='delivered') {log(`Already delivered the video for ${date}.`);return {folder,state};}
    if(deliveryAction(state)==='hold') throw new Error('An earlier upload has an unconfirmed outcome; inspect Discord before retrying.');
    const historyFile=path.join(config.dataDir,'history.json');
    const history=await readJson(historyFile,[]);
    if(state.status!=='prepared') {
      stopProxy=await ensureProxy(config);
      let selection=sample ? null : savedSelection(state,config);
      if(selection)log('Reusing the saved selection after interruption; no additional Qwen call.');
      else selection=await selectContent(config,date,history,log);
      if(passageId) {
        if(!sample) throw new Error('Manual passage overrides are only supported for a local sample');
        if(!PASSAGES.some(p=>p.id===passageId)) throw new Error('Sample passage must be in the permitted catalogue');
        selection={...selection,passageId,selector:'sample'};
      }
      state={...state,status:'building',selection};
      await writeJson(path.join(folder,'state.json'),state);
      try {
        const manifest=await prepareVideo(config,selection,date,folder,log);
        state={...state,status:'prepared',video:manifest.upload.file};
        await writeJson(path.join(folder,'state.json'),state);
      } catch(error) {
        await writeJson(path.join(folder,'state.json'),{...state,status:'failed',lastError:error.message});
        throw error;
      }
    }
    if(!sample && !renderOnly) {
      state=await deliverPrepared(config,state,folder);
      const manifest=await readJson(path.join(folder,'manifest.json'));
      await writeJson(historyFile,[...history.filter(h=>h.date!==date),{
        date,passageId:manifest.passage.id,messageId:state.messageId}].slice(-365));
      log(`Video delivered by Discord DM; message ${state.messageId}.`);
    } else log(`Local video ready: ${state.video}`);
    return {folder,state};
  } finally {stopProxy();await release();}
}
