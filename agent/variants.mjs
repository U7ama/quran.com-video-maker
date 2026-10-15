import {makeTimeline} from './core.mjs';

export const DAILY_VARIANTS=['urdu','recitation'];
export function variantPrefix(date,id) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DAILY_VARIANTS.includes(id))throw new Error('Invalid daily variant');
  return `cloud/runs/${date}/variants/${id}`;
}
export function newPair(date) {
  return {date,version:2,status:'building',variants:Object.fromEntries(DAILY_VARIANTS.map(id=>[id,{date,variant:id,status:'new'}]))};
}
export function nextVariant(run) {
  if(run.version!==2)return null;
  if(DAILY_VARIANTS.some(id=>['sending','uncertain','starting-render','render-error'].includes(run.variants[id]?.status)))return null;
  return DAILY_VARIANTS.find(id=>run.variants[id]?.status!=='delivered') || null;
}
export function pairStatus(run) {
  const states=DAILY_VARIANTS.map(id=>run.variants[id]?.status);
  if(states.every(s=>s==='delivered'))return 'delivered';
  return states.find(s=>['sending','uncertain','starting-render','render-error'].includes(s)) || 'building';
}
export function videoVariant(prepared,id) {
  if(!DAILY_VARIANTS.includes(id))throw new Error('Invalid daily variant');
  const value=structuredClone({props:prepared.props,context:prepared.context});
  if(id==='urdu') {
    if(value.props.translationAudio!=='urdu' || !value.context.narration)throw new Error('Verified Urdu narration is missing');
  } else {
    const cues=value.props.cues.map(c=>{
      const {fromFrame,toFrame,arabicFrames,urduFromFrame,urduFrames,arabicAudioSrc,urduAudioSrc,...source}=c;
      return source;
    });
    value.props={...value.props,...makeTimeline(cues,value.props.fps),translationAudio:'none'};
    value.context.narration=null;
  }
  value.props.variant=id;
  return value;
}
