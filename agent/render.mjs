import {createRequire} from 'node:module';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {devNull} from 'node:os';
import path from 'node:path';
import {FRONTEND_DIR} from './config.mjs';
import {command, probe, fileHash} from './io.mjs';

const frontendRequire = createRequire(path.join(FRONTEND_DIR, 'package.json'));

export async function renderVideo(config, props, output, log=console.log) {
  // Resolve the renderer shipped with the installed CLI, avoiding this fork's
  // mismatched top-level 4.0.332 renderer alongside Remotion 4.0.266.
  const cliRequire = createRequire(frontendRequire.resolve('@remotion/cli/package.json'));
  const renderer = cliRequire('@remotion/renderer');
  const version = cliRequire('@remotion/renderer/package.json').version;
  if (version !== frontendRequire('remotion/package.json').version) throw new Error('Remotion package versions do not match');
  const {bundle} = frontendRequire('@remotion/bundler');
  const bundleDir = path.join(config.dataDir,'render-bundle');
  const serveUrl = await bundle({
    entryPoint:path.join(FRONTEND_DIR,'src','components','DailyQuranAgent','index.tsx'),
    publicDir:config.publicDir, outDir:bundleDir,
    webpackOverride:webpackConfig=>({...webpackConfig,module:{...webpackConfig.module,
      rules:[...(webpackConfig.module?.rules || []),{test:/\.s[ac]ss$/i,use:[
        frontendRequire.resolve('style-loader'),frontendRequire.resolve('css-loader'),frontendRequire.resolve('sass-loader')]}]}}),
  });
  const composition = await renderer.selectComposition({serveUrl,id:'DailyQuranVideo',inputProps:props,
    browserExecutable:config.chromePath});
  await mkdir(path.dirname(output),{recursive:true,mode:0o700});
  let lastProgress=-1;
  await renderer.renderMedia({
    composition, serveUrl, inputProps:props, codec:'h264', audioCodec:'aac',
    // Browser capture at 1.5x rasterizes the shared 720px layout directly at
    // 1080p, including fonts. This does not upscale an existing 720p MP4.
    scale:1.5, imageFormat:'png', pixelFormat:'yuv420p',
    crf:18, x264Preset:'medium', audioBitrate:'160k', outputLocation:output,
    concurrency:config.concurrency, browserExecutable:config.chromePath,
    timeoutInMilliseconds:120000,
    onProgress:({progress})=>{
      const percent=Math.floor(progress*10)*10;
      if(percent>lastProgress) {lastProgress=percent;log(`Rendering ${percent}%`);}
    },
  });
  return verifyVideo(output, props.durationInFrames / props.fps);
}

export async function verifyVideo(file, expectedSeconds) {
  const media = await probe(file);
  const video = media.streams.find(s=>s.codec_type==='video');
  const audio = media.streams.find(s=>s.codec_type==='audio');
  const duration = Number(media.format.duration);
  const fps=video?.avg_frame_rate?.split('/').map(Number);
  const frameRate=fps?.[0]/fps?.[1];
  if (!video || !audio || video.width!==1080 || video.height!==1920 ||
      video.codec_name!=='h264' || video.pix_fmt!=='yuv420p' || audio.codec_name!=='aac' ||
      !Number.isFinite(frameRate) || Math.abs(frameRate-30)>0.01 ||
      !Number.isFinite(expectedSeconds) || expectedSeconds<=0 ||
      !Number.isFinite(duration) || Math.abs(duration-expectedSeconds)>0.6) {
    throw new Error('Rendered video failed duration, picture or audio checks');
  }
  return {duration, width:video.width, height:video.height, fps:frameRate,
    audioBitrate:Number(audio.bit_rate)||160000,bytes:Number(media.format.size),sha256:await fileHash(file)};
}

export function uploadBitrate(maxBytes, seconds, audioBitrate=160000) {
  if(!Number.isFinite(maxBytes) || maxBytes<=0 || !Number.isFinite(seconds) || seconds<=0 ||
      !Number.isFinite(audioBitrate) || audioBitrate<=0)throw new Error('Invalid upload encoding budget');
  // Reserve container overhead while keeping the complete original AAC track.
  const targetRate=Math.floor(maxBytes*0.96*8/seconds-audioBitrate);
  if(targetRate<180000)throw new Error('Complete video cannot fit the Discord size budget without losing readability');
  return targetRate;
}

export async function fitDiscord(config, video, expectedSeconds) {
  const metadata=await verifyVideo(video,expectedSeconds);
  if (metadata.bytes<=config.discordMaxBytes) return {file:video,...metadata,encoding:'master'};
  const output=video.replace(/\.mp4$/,'.discord.mp4');
  if(output===video)throw new Error('Upload encoding requires an MP4 filename');
  let targetRate=uploadBitrate(config.discordMaxBytes,metadata.duration,metadata.audioBitrate);
  const temporary=await mkdtemp(path.join(path.dirname(output),'.encoding-'));
  try {
    for(let attempt=0;attempt<2;attempt++) {
      const options=['-hide_banner','-loglevel','error','-y','-i',video,'-map','0:v:0',
        '-c:v','libx264','-preset','medium','-threads','2','-pix_fmt','yuv420p','-b:v',String(targetRate),
        '-passlogfile',path.join(temporary,'pass')];
      // Two passes allocate the upload budget across motion/complex frames more
      // accurately than the old single-pass low-bitrate export.
      await command('ffmpeg',[...options,'-pass','1','-an','-f','null',devNull]);
      await command('ffmpeg',[...options,'-pass','2','-map','0:a:0','-c:a','copy',
        '-movflags','+faststart',output]);
      const compressed=await verifyVideo(output,expectedSeconds);
      if(compressed.bytes<=config.discordMaxBytes) {
        return {file:output,...compressed,encoding:'two-pass',targetVideoBitrate:targetRate};
      }
      // Short, complex clips can overshoot even a two-pass estimate. Permit
      // one measured correction, always encoding from the unchanged master.
      const audioBytes=metadata.audioBitrate*metadata.duration/8;
      targetRate=Math.floor(targetRate*(config.discordMaxBytes*0.90-audioBytes)/(compressed.bytes-audioBytes));
      if(targetRate<180000)break;
    }
    throw new Error('Video still exceeds the Discord size budget');
  } catch(error) {
    await rm(output,{force:true});
    throw error;
  } finally {
    await rm(temporary,{recursive:true,force:true});
  }
}
