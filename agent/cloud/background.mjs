import path from 'node:path';
import {rename} from 'node:fs/promises';
import {command,probe,fileHash} from '../io.mjs';

// Match the existing portrait cover crop and five-second loop before Chromium
// loads stock footage. Original downloaded clips and attribution stay intact.
export async function prepareCloudBackground(prepared) {
  if(prepared.props.background.kind!=='video')return;
  const source=path.join(prepared.assetDir,'background.mp4');
  const output=path.join(prepared.assetDir,'background-normalized.mp4');
  await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',source,'-t','5','-an',
    '-vf',"crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920:flags=lanczos,setsar=1,fps=30",
    '-c:v','libx264','-preset','fast','-crf','16','-g','15','-pix_fmt','yuv420p','-movflags','+faststart',output],{timeout:180000});
  const media=await probe(output),video=media.streams.find(s=>s.codec_type==='video');
  if(!video || video.width!==1080 || video.height!==1920 || video.r_frame_rate!=='30/1' ||
      media.streams.some(s=>s.codec_type==='audio') || Math.abs(Number(media.format.duration)-5)>0.05) {
    throw new Error('Cloud background normalization failed validation');
  }
  prepared.context.background.renderRendition={width:1080,height:1920,fps:30,duration:5,
    sha256:await fileHash(output),encoding:'H.264 CRF16',crop:'portrait-cover'};
  await rename(output,source);
}
