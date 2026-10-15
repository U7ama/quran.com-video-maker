import path from 'node:path';
import {mkdir,rm} from 'node:fs/promises';
import {DAILY_VARIANTS,newPair,nextVariant,pairStatus,videoVariant} from './variants.mjs';
import {writeJson,readJson,ensureProxy} from './io.mjs';
import {prepareVideo,finishVideo,savedSelection,deliverPrepared} from './workflow.mjs';
import {selectContent} from './selector.mjs';
import {renderVideo} from './render.mjs';

export async function runLocalPair(config,date,folder,{renderOnly=false,log=console.log}={}) {
  let state=await readJson(path.join(folder,'state.json'),null);
  if(state && state.version!==2)return null; // Keep old receipt/compatibility semantics.
  state ||= newPair(date);
  const save=async()=>{state.status=pairStatus(state);await writeJson(path.join(folder,'state.json'),state);};
  const historyFile=path.join(config.dataDir,'history.json');
  const history=await readJson(historyFile,[]);
  await save();
  if(!nextVariant(state)) {
    if(state.status!=='delivered')throw new Error('An earlier variant has an unconfirmed outcome; inspect Discord before retrying');
    return {folder,state};
  }
  if(!state.prepared) {
    state.selection=savedSelection(state,config) || await selectContent(config,date,history,log);await save();
    const stop=await ensureProxy(config);
    try {
      const prepared=await prepareVideo({...config,prepareOnly:true,translationAudio:'urdu'},state.selection,date,folder,log);
      state.assetDir=prepared.assetDir;
      for(const id of DAILY_VARIANTS)await writeJson(path.join(folder,id,'prepared.json'),videoVariant(prepared,id));
      state.prepared=true;await save();
    } finally {stop();}
  }
  for(const id of DAILY_VARIANTS) {
    let variant=state.variants[id];
    if(variant.status==='delivered')continue;
    const variantFolder=path.join(folder,id);
    await mkdir(variantFolder,{recursive:true,mode:0o700});
    if(variant.status!=='prepared') {
      const prepared=await readJson(path.join(variantFolder,'prepared.json'));
      const file=path.join(variantFolder,`quran-${date}-${prepared.context.passage.chapter}-${id}.mp4`);
      await renderVideo(config,prepared.props,file,log);
      const manifest=await finishVideo({...config,translationAudio:id==='urdu' ? 'urdu' : 'none'},state.selection,date,
        variantFolder,prepared.props,prepared.context,file);
      variant=state.variants[id]={...variant,status:'prepared',video:manifest.upload.file};await save();
    }
    if(!renderOnly) {
      state.variants[id]=await deliverPrepared(config,variant,variantFolder,async(file,value)=>{
        await writeJson(file,value);state.variants[id]=value;await save();
      });await save();
    }
  }
  if(!renderOnly) {
    await writeJson(historyFile,[...history.filter(x=>x.date!==date),{date,passageId:state.selection.passageId,
      variants:Object.fromEntries(DAILY_VARIANTS.map(id=>[id,state.variants[id].messageId]))}].slice(-365));
    await rm(state.assetDir,{recursive:true,force:true});
  }
  return {folder,state};
}
