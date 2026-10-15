import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {download,probe,fileHash} from './io.mjs';

export const URDU_AUDIO={provider:'EveryAyah',narrator:'Shamshad Ali Khan',
  source:'https://everyayah.com/data/translations/urdu_shamshad_ali_khan_46kbps/',
  note:'Recorded Urdu narration; credited separately from the selected written translation.'};

export function makeSpokenTimeline(cues,durations,mode='urdu',fps=30) {
  let frame=0;
  const gap=Math.round(fps*.5);
  const timed=cues.map(cue=>{
    const seconds=durations[cue.key];
    if(!Number.isFinite(seconds)||seconds<=0||seconds>180)throw new Error(`Missing measured Urdu audio duration for ${cue.key}`);
    const arabicFrames=mode==='urdu-only' ? 0 : Math.ceil((cue.toMs-cue.fromMs)*fps/1000);
    const urduFrames=Math.ceil(seconds*fps);
    const fromFrame=frame;
    const urduFromFrame=frame+arabicFrames+(arabicFrames ? gap : 0);
    frame=urduFromFrame+urduFrames;
    return {...cue,fromFrame,toFrame:frame,arabicFrames,urduFromFrame,urduFrames};
  });
  const durationInFrames=frame+fps*2;
  timed.at(-1).toFrame=durationInFrames;
  return {startMs:cues[0].fromMs,endMs:cues.at(-1).toMs,fps,intro:0,
    durationInFrames,cues:timed,translationAudio:mode};
}

export async function prepareUrduAudio(cues,folder) {
  const checksumFile=path.join(folder,'urdu-checksums.md5');
  await download(`${URDU_AUDIO.source}000_checksum.md5`,checksumFile,1024*1024);
  const checksumText=await readFile(checksumFile,'utf8');
  const durations={};
  const recordings=[];
  for(const cue of cues) {
    const [chapter,verse]=cue.key.split(':');
    const name=`${chapter.padStart(3,'0')}${verse.padStart(3,'0')}.mp3`;
    const line=checksumText.split(/\r?\n/).find(line=>line.trim().endsWith(name));
    const expected=line?.match(/\b[a-f\d]{32}\b/i)?.[0]?.toLowerCase();
    if(!expected)throw new Error(`EveryAyah checksum missing for ${cue.key}`);
    const file=path.join(folder,`urdu-${name}`);
    await download(`${URDU_AUDIO.source}${name}`,file,3*1024*1024);
    const actual=createHash('md5').update(await readFile(file)).digest('hex');
    if(actual!==expected)throw new Error(`Urdu recording checksum mismatch for ${cue.key}`);
    const media=await probe(file);
    const seconds=Number(media.format.duration);
    if(!media.streams.some(s=>s.codec_type==='audio')||!Number.isFinite(seconds)||seconds<=0||seconds>180) {
      throw new Error(`Invalid Urdu recording for ${cue.key}`);
    }
    durations[cue.key]=seconds;
    recordings.push({verseKey:cue.key,file,source:`${URDU_AUDIO.source}${name}`,duration:seconds,sha256:await fileHash(file),providerMd5:expected});
  }
  return {durations,recordings,...URDU_AUDIO};
}
