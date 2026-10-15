import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSpokenTimeline} from '../translation-audio.mjs';
import {assertMediaUrl} from '../io.mjs';

const cues=[{key:'97:1',fromMs:0,toMs:7970},{key:'97:2',fromMs:7970,toMs:13980}];
const durations={'97:1':3.9,'97:2':2.22};
test('Arabic then Urdu preserves each measured recording and a half-second separation',()=>{
  const timeline=makeSpokenTimeline(cues,durations,'urdu',30);
  const [first,second]=timeline.cues;
  assert.equal(first.fromFrame,0);
  assert.ok(first.arabicFrames/30>=7.97);
  assert.equal(first.urduFromFrame-first.arabicFrames,15);
  assert.ok(first.urduFrames/30>=3.9);
  assert.equal(second.fromFrame,first.urduFromFrame+first.urduFrames);
  assert.equal(second.urduFromFrame,second.fromFrame+second.arabicFrames+15);
  assert.equal(timeline.durationInFrames,second.urduFromFrame+second.urduFrames+60);
  assert.equal(second.toFrame,timeline.durationInFrames);
});
test('Urdu-only playback omits Arabic without dropping translation audio or estimating its duration',()=>{
  const timeline=makeSpokenTimeline(cues,durations,'urdu-only',30);
  assert.equal(timeline.cues[0].arabicFrames,0);
  assert.equal(timeline.cues[0].urduFromFrame,0);
  assert.equal(timeline.cues[1].fromFrame,timeline.cues[0].urduFrames);
  for(const bad of [{},{'97:1':0,'97:2':2},{'97:1':NaN,'97:2':2}]) {
    assert.throws(()=>makeSpokenTimeline(cues,bad),/measured Urdu audio/);
  }
});
test('Urdu media access is restricted to the original frontend recording directory',()=>{
  assert.equal(assertMediaUrl('https://everyayah.com/data/translations/urdu_shamshad_ali_khan_46kbps/097001.mp3').hostname,'everyayah.com');
  for(const url of ['http://everyayah.com/data/translations/urdu_shamshad_ali_khan_46kbps/097001.mp3',
    'https://everyayah.com/other/097001.mp3','https://everyayah.com/data/translations/other/097001.mp3',
    'https://everyayah.com.example.org/data/translations/urdu_shamshad_ali_khan_46kbps/097001.mp3']) assert.throws(()=>assertMediaUrl(url));
});
