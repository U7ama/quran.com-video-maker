import test from 'node:test';
import assert from 'node:assert/strict';
import {newPair,nextVariant,pairStatus,videoVariant,variantPrefix} from '../variants.mjs';
import {makeSpokenTimeline} from '../translation-audio.mjs';

test('paired delivery resumes only the missing version and holds ambiguous sends',()=>{
  const run=newPair('2026-10-13');
  assert.equal(nextVariant(run),'urdu');
  run.variants.urdu={...run.variants.urdu,status:'delivered',messageId:'original'};
  assert.equal(nextVariant(run),'recitation');
  for(const status of ['sending','uncertain','starting-render','render-error']) {
    run.variants.recitation.status=status;assert.equal(nextVariant(run),null);assert.equal(pairStatus(run),status);
  }
  run.variants.recitation.status='delivered';assert.equal(nextVariant(run),null);assert.equal(pairStatus(run),'delivered');
  assert.equal(run.variants.urdu.messageId,'original');
  assert.equal(nextVariant({date:run.date,status:'delivered'}),null);
  assert.throws(()=>variantPrefix(run.date,'../config'));
});

test('recitation-only version preserves all source text and original complete Arabic interval',()=>{
  const cues=[{key:'103:1',arabic:'ا',displayArabic:'ا',translation:'اردو',fromMs:3000,toMs:5500},
    {key:'103:2',arabic:'ب',translation:'اردو',fromMs:5500,toMs:10000}];
  const prepared={props:{...makeSpokenTimeline(cues,{'103:1':4,'103:2':6}),audioSrc:'source.wav',
    background:{kind:'generated'},textPanelOpacity:0.2},context:{narration:{narrator:'Shamshad Ali Khan'}}};
  const before=structuredClone(prepared);
  const urdu=videoVariant(prepared,'urdu'),recitation=videoVariant(prepared,'recitation');
  assert.deepEqual(prepared,before);
  assert.equal(urdu.props.translationAudio,'urdu');assert.equal(urdu.context.narration.narrator,'Shamshad Ali Khan');
  assert.equal(recitation.props.translationAudio,'none');assert.equal(recitation.context.narration,null);
  assert.equal(recitation.props.endMs-recitation.props.startMs,7000);
  assert.equal(recitation.props.durationInFrames,285); // 1.5s intro + full 7s + 1s outro.
  assert.deepEqual(recitation.props.cues.map(x=>[x.key,x.arabic,x.translation]),cues.map(x=>[x.key,x.arabic,x.translation]));
  assert.ok(recitation.props.cues.every(c=>c.urduAudioSrc===undefined && c.urduFrames===undefined));
  assert.equal(recitation.props.audioSrc,urdu.props.audioSrc);assert.equal(recitation.props.textPanelOpacity,0.2);
  assert.throws(()=>videoVariant({props:{},context:{}},'urdu'));
});
