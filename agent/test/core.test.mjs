import test from 'node:test';
import assert from 'node:assert/strict';
import {dayKey,loadConfig} from '../config.mjs';
import {PASSAGES,validateSelection,validateContent,makeTimeline,plainTranslation,
  validateBackground,chooseFromCatalogue,deliveryAction} from '../core.mjs';

const passage=PASSAGES.find(p=>p.chapter===108);
const payload=()=>({verses:[1,2,3].map(i=>({verse_key:`108:${i}`,chapter_id:108,
  text_uthmani:'قُلْ',translations:[{resource_id:54,text:'اردو متن'}]}))});
const audio=()=>({chapter_id:108,verse_timings:[1,2,3].map(i=>({
  verse_key:`108:${i}`,timestamp_from:(i-1)*4000,timestamp_to:i*4000}))});

test('Pakistan midnight determines the daily key independently of host timezone',()=>{
  assert.equal(dayKey(new Date('2026-10-03T18:59:59Z'),'Asia/Karachi'),'2026-10-03');
  assert.equal(dayKey(new Date('2026-10-03T19:00:00Z'),'Asia/Karachi'),'2026-10-04');
});
test('model output cannot introduce arbitrary verses, translations or imagery',()=>{
  assert.throws(()=>validateSelection({passageId:'2:255-255',translationId:54,theme:'mountains'},[54]));
  assert.throws(()=>validateSelection({passageId:passage.id,translationId:131,theme:'mountains'},[54]));
  assert.throws(()=>validateSelection({passageId:passage.id,translationId:54,theme:'depiction of Paradise'},[54]));
  assert.deepEqual(validateSelection({passageId:passage.id,translationId:54,theme:'mountains',
    tafsir:'Untrusted generated claim'},[54]),{passageId:passage.id,translationId:54,theme:'mountains'});
});
test('catalogue rotation avoids recent passages and has deterministic restart behaviour',()=>{
  const first=chooseFromCatalogue('2026-10-03',[],[54]);
  assert.deepEqual(first,chooseFromCatalogue('2026-10-03',[],[54]));
  assert.notEqual(chooseFromCatalogue('2026-10-04',[first],[54]).passageId,first.passageId);
});
test('missing verse, wrong translation, missing Arabic and wrong audio fail closed',()=>{
  const cases=[
    d=>d.verses.pop(),d=>d.verses[0].verse_key='108:2',
    d=>d.verses[0].translations[0].resource_id=131,d=>d.verses[0].text_uthmani='',
  ];
  for(const mutate of cases){const d=payload();mutate(d);assert.throws(()=>validateContent(d,audio(),passage,54));}
  const a=audio();a.chapter_id=109;assert.throws(()=>validateContent(payload(),a,passage,54));
});
test('missing, overlapping and reversed recitation timings are rejected',()=>{
  const mutations=[a=>a.verse_timings.pop(),a=>a.verse_timings[1].timestamp_from=100,
    a=>a.verse_timings[1].timestamp_to=0];
  for(const mutate of mutations){const a=audio();mutate(a);assert.throws(()=>validateContent(payload(),a,passage,54));}
});
test('timeline preserves all recitation frames and shows the last ayah through the ending',()=>{
  const cues=validateContent(payload(),audio(),passage,54);
  const timeline=makeTimeline(cues,24);
  assert.equal(timeline.durationInFrames,36+288+24);
  assert.equal(timeline.cues[0].fromFrame,0);
  assert.equal(timeline.cues[2].fromFrame,36+192);
  assert.equal(timeline.cues.at(-1).toFrame,timeline.durationInFrames);
});
test('translation caption removes only markup and footnote markers, without interpreting text',()=>{
  assert.equal(plainTranslation('Say, &quot;He is Allah&quot;<sup foot_note="1">1</sup>'),'Say, "He is Allah"');
  assert.throws(()=>plainTranslation('Unknown &unexpected; entity'));
});
test('unreviewed stock footage and changed provenance cannot enter automatic runs',()=>{
  const clip={id:'123',provider:'pexels',theme:'mountains',sourceUrl:'https://www.pexels.com/video/mountains-123/',
    license:'Pexels License',sha256:'a'.repeat(64),approved:true,reviewedAt:'2026-10-03'};
  assert.equal(validateBackground(clip),clip);
  for(const change of [{approved:false},{reviewedAt:null},{license:'Unknown'},{sourceUrl:'https://example.org/123'}]){
    assert.throws(()=>validateBackground({...clip,...change}));
  }
});
test('confirmed and uncertain deliveries cannot automatically send again',()=>{
  assert.equal(deliveryAction({status:'delivered'}),'skip');
  assert.equal(deliveryAction({status:'sending'}),'hold');
  assert.equal(deliveryAction({status:'uncertain'}),'hold');
  assert.equal(deliveryAction({status:'prepared'}),'send');
});
test('unsafe proxy and unsupported translation configuration are rejected',async()=>{
  await assert.rejects(loadConfig({QURAN_PROXY_URL:'http://example.com/api/qdc'}));
  await assert.rejects(loadConfig({TRANSLATION_IDS:'99999'}));
  await assert.rejects(loadConfig({DAILY_TIME:'25:99'}));
});
