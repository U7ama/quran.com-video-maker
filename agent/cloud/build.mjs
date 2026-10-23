import {bundle} from '@remotion/bundler';
import {build} from 'esbuild';
import {getRolePolicy} from '@remotion/lambda';
import {cp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';

const require=createRequire(import.meta.url);
const directory=path.dirname(new URL(import.meta.url).pathname);
const root=path.resolve(directory,'../..');
const output=path.join(directory,'build');
await mkdir(path.join(output,'site-src/src/components'),{recursive:true});
for(const name of ['DailyQuranAgent','MediaMaker/Content']) {
  await cp(path.join(root,'quran.com-frontend-next/src/components',name),
    path.join(output,'site-src/src/components',name),{recursive:true});
}
await cp(path.join(root,'quran.com-frontend-next/types'),path.join(output,'site-src/types'),{recursive:true});
// The preserved local frontend uses browser video seeking. Cloud workers use
// FFmpeg frame extraction so looped stock footage does not stall Chromium.
const cloudComposition=path.join(output,'site-src/src/components/DailyQuranAgent/index.tsx');
const compositionSource=await readFile(cloudComposition,'utf8');
if(!compositionSource.includes('  Video,\n'))throw new Error('Cloud background video import changed; inspect the composition');
await writeFile(cloudComposition,compositionSource.replace('  Video,\n','  OffthreadVideo as Video,\n'));
await mkdir(path.join(output,'empty-public'),{recursive:true});
const site=await bundle({entryPoint:path.join(output,'site-src/src/components/DailyQuranAgent/index.tsx'),
  publicDir:path.join(output,'empty-public'),outDir:path.join(output,'site'),
  webpackOverride:config=>({...config,output:{...config.output,publicPath:'/'},module:{...config.module,rules:[...(config.module?.rules || []),
    {test:/\.s[ac]ss$/i,use:[require.resolve('style-loader'),
      {loader:require.resolve('css-loader'),options:{modules:{auto:true,namedExport:false}}},
      require.resolve('sass-loader')]}]}})});
let html=await readFile(path.join(site,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script([^>]*?)src="([^"]+)"([^>]*)><\/script>/g)];
for(const match of scripts) {
  if(match[2].startsWith('http'))throw new Error('Unexpected remote dependency in the private render site');
  const script=await readFile(path.join(site,match[2].replace(/^\//,'')),'utf8');
  html=html.replace(match[0],()=>`<script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
}
await writeFile(path.join(output,'site-private.html'),html);
const runtime=path.join(output,'runtime');
await mkdir(path.join(runtime,'proxy'),{recursive:true});
await mkdir(path.join(runtime,'bin'),{recursive:true});
await mkdir(path.join(runtime,'backgrounds'),{recursive:true});
for(const id of ['stars','sea','nature','snow','abstract']) {
  await cp(path.join(root,'quran.com-frontend-next/public/publicMin/videos',`videos_${id}.mp4`),
    path.join(runtime,'backgrounds',`videos_${id}.mp4`));
}
await build({entryPoints:[path.join(directory,'handler.mjs')],outfile:path.join(runtime,'index.mjs'),
  bundle:true,platform:'node',format:'esm',target:'node22',
  banner:{js:"import {createRequire as makeRequire} from 'node:module';const require=makeRequire(import.meta.url);"}});
await build({entryPoints:[path.join(root,'proxy/quran-proxy-server.js')],outfile:path.join(runtime,'proxy/quran-proxy-server.js'),
  bundle:true,platform:'node',format:'cjs',target:'node22'});
await cp(require('ffmpeg-static'),path.join(runtime,'bin/ffmpeg'));
await cp(require('ffprobe-static').path,path.join(runtime,'bin/ffprobe'));
await cp(path.join(directory,'node_modules/@remotion/lambda/remotionlambda-arm64.zip'),path.join(output,'remotion-renderer.zip'));
const rendererPolicy=JSON.parse(getRolePolicy());
for(const s of rendererPolicy.Statement) {
  if(s.Action.includes('s3:GetObject')) {
    s.Action=s.Action.filter(a=>!['s3:CreateBucket','s3:PutBucketAcl','s3:PutObjectAcl'].includes(a));
    s.Resource=['arn:aws:s3:::remotionlambda-useast1-quran-129631621612',
      'arn:aws:s3:::remotionlambda-useast1-quran-129631621612/*'];
  }
  if(s.Action.includes('lambda:InvokeFunction'))s.Resource=[
    'arn:aws:lambda:us-east-1:129631621612:function:remotion-render-4-0-534-mem3008mb-disk10240mb-900sec'];
}
await writeFile(path.join(output,'renderer-role-policy.json'),JSON.stringify(rendererPolicy,null,2));
const baseline=JSON.parse(await readFile(path.join(directory,'iam-baseline.json'),'utf8')).Policies[0].Policy;
baseline.Statement=baseline.Statement.filter(s=>s.Action.includes('s3:GetObject') || s.Action.includes('lambda:InvokeFunction'));
for(const s of baseline.Statement) {
  if(s.Action.includes('s3:GetObject')) {
    s.Action=s.Action.filter(a=>['s3:GetObject','s3:PutObject','s3:DeleteObject'].includes(a));
    s.Resource=['arn:aws:s3:::quran-agent-129631621612-us-east-1/*','arn:aws:s3:::remotionlambda-useast1-quran-129631621612/*'];
  } else s.Resource=['arn:aws:lambda:us-east-1:129631621612:function:quran-daily-agent',
    'arn:aws:lambda:us-east-1:129631621612:function:remotion-render-4-0-534-mem3008mb-disk10240mb-900sec'];
}
await writeFile(path.join(output,'agent-role-policy.json'),JSON.stringify(baseline,null,2));
// Autopilot's projectversion ARN is for the optional custom moderation adapter.
// These calls use the standard model and inline image bytes, so the generated
// actions need Resource '*'; restrict this supplemental policy to this region.
const inspectionBaseline=JSON.parse(await readFile(path.join(directory,'rekognition-iam-baseline.json'),'utf8'));
const inspectionPolicy=structuredClone(inspectionBaseline.Policies[0].Policy);
for(const statement of inspectionPolicy.Statement) {
  statement.Resource=['*'];
  statement.Condition={StringEquals:{'aws:RequestedRegion':'us-east-1'}};
}
await writeFile(path.join(output,'rekognition-role-policy.json'),JSON.stringify(inspectionPolicy,null,2));
console.log(JSON.stringify({siteBytes:(await stat(path.join(output,'site-private.html'))).size,
  ffmpegBytes:(await stat(path.join(runtime,'bin/ffmpeg'))).size,ffprobeBytes:(await stat(path.join(runtime,'bin/ffprobe'))).size}));
