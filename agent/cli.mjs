#!/usr/bin/env node
import {access, copyFile, chmod, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {AGENT_DIR, FRONTEND_DIR, loadConfig, dayKey} from './config.mjs';
import {command, readJson, writeJson, isFile} from './io.mjs';
import {hasDeliveryConfig, validateWebhook} from './discord.mjs';
import {runDaily,runDue} from './workflow.mjs';
import {schedule} from './scheduler.mjs';
import {fetchBackgroundCandidates, approveBackground} from './backgrounds.mjs';
import {selectContent} from './selector.mjs';

const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const help=`Daily Quran Agent (Node 22)
  node cli.mjs init                     Create a private .env (does not overwrite one)
  node cli.mjs doctor                   Check local configuration, without exposing credentials
  node cli.mjs qwen check               Verify one live structured selection; no render or DM
  node cli.mjs sample [--passage 97:1-5] Render locally; never sends a DM
  node cli.mjs daily [--render-only]     Generate/send today's video once
  node cli.mjs due                      Catch up the latest due scheduled date once
  node cli.mjs schedule [--system]      Generate daily and catch-up timer units
  node cli.mjs backgrounds fetch --theme "mountains"
  node cli.mjs backgrounds approve pixabay-VIDEO_ID --reviewed
  node cli.mjs delivery confirm DATE MESSAGE_ID
  node cli.mjs delivery retry DATE --checked-no-message

Bot credentials go in agent/.env, never in chat or the frontend.
Read ETHICS.md before approving stock clips.`;

async function init() {
  const file=path.join(AGENT_DIR,'.env');
  if(await isFile(file)) {console.log('Private configuration already exists; left unchanged.');return;}
  await copyFile(path.join(AGENT_DIR,'.env.example'),file);
  await chmod(file,0o600);
  console.log(`Created private configuration: ${file}`);
}

async function doctor(config) {
  const checks=[];
  const check=async(name,fn)=>{
    try{await fn();checks.push({check:name,ok:true});}
    catch{checks.push({check:name,ok:false});}
  };
  await check('Node >=22',async()=>{if(Number(process.versions.node.split('.')[0])<22)throw new Error();});
  await check('Frontend dependencies installed',()=>access(path.join(FRONTEND_DIR,'node_modules','@remotion','cli','package.json')));
  await check('Proxy dependencies installed',()=>access(path.join(AGENT_DIR,'..','proxy','node_modules','express','package.json')));
  await check('FFmpeg',()=>command('ffmpeg',['-version']));
  await check('FFprobe',()=>command('ffprobe',['-version']));
  await check('Chrome for offline rendering',()=>access(config.chromePath));
  await check('Discord bot DM configured',async()=>{
    if(!config.botToken || !/^\d{15,22}$/.test(config.discordUserId))throw new Error();
  });
  if(config.webhookUrl) await check('Alternative webhook URL valid',async()=>validateWebhook(config.webhookUrl));
  console.table(checks);
  console.log(`Daily time: ${config.dailyTime} ${config.timezone}`);
  console.log(`Translation IDs: ${config.translationIds.join(', ')}; reciter ID: ${config.reciterId}`);
  console.log(`Translation audio mode: ${config.translationAudio}`);
  console.log(`Qwen: ${config.qwenKey ? 'configured' : 'optional; safe catalogue is available'}`);
  console.log(`Pexels: ${config.pexelsKey ? 'configured' : 'optional; generated scenery is available'}`);
  console.log(`Pixabay: ${config.pixabayKey ? 'configured' : 'optional; add PIXABAY_API_KEY for stock video search'}`);
  console.log(`Background provider: ${config.backgroundProvider}; mode: ${config.backgroundMode}`);
  console.log(`Discord: ${hasDeliveryConfig(config) ? 'configured (delivery still requires a successful live run)' : 'not configured'}`);
  return checks;
}

async function resolveDelivery(config) {
  const date=args[2];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Supply the affected YYYY-MM-DD date');
  const folder=path.join(config.dataDir,'runs',date);
  const file=path.join(folder,'state.json');
  const state=await readJson(file);
  if(!state || !['sending','uncertain'].includes(state.status))throw new Error('This run does not have an unconfirmed upload');
  if(args[1]==='confirm') {
    const messageId=args[3];
    if(!/^\d{15,22}$/.test(messageId || ''))throw new Error('Supply the message ID visible in your Discord DM');
    await writeJson(file,{...state,status:'delivered',messageId,manuallyConfirmedAt:new Date().toISOString()});
    const manifest=await readJson(path.join(folder,'manifest.json'));
    const historyFile=path.join(config.dataDir,'history.json');
    const history=await readJson(historyFile,[]);
    await writeJson(historyFile,[...history.filter(h=>h.date!==date),{date,passageId:manifest.passage.id,messageId}]);
    console.log('Recorded the delivery you confirmed.');
  } else if(args[1]==='retry' && args.includes('--checked-no-message')) {
    await writeJson(file,{...state,status:'prepared',manuallyCheckedAt:new Date().toISOString()});
    console.log('Prepared upload unlocked after your explicit check.');
  } else throw new Error('Check your DM first; use confirm or retry --checked-no-message');
}

async function checkQwen(config) {
  if(!config.qwenKey && !['localhost','127.0.0.1'].includes(new URL(config.qwenBaseUrl).hostname)) {
    throw new Error('Configure QWEN_API_KEY and the matching QWEN_BASE_URL first');
  }
  const date=dayKey(new Date(),config.timezone);
  const history=await readJson(path.join(config.dataDir,'history.json'),[]);
  const selection=await selectContent(config,date,history);
  if(selection.selector!=='qwen')throw new Error('Qwen live check did not yield an accepted model selection; daily fallback remains available');
  const result={checkedAt:new Date().toISOString(),date,selection};
  await writeJson(path.join(config.dataDir,'qwen-check.json'),result);
  console.log('Qwen live structured-selection check passed.');
  console.log(JSON.stringify(result,null,2));
}

async function main() {
  if(!args.length || args.includes('--help')) {console.log(help);return;}
  if(args[0]==='init') {await init();return;}
  const config=await loadConfig();
  switch(args[0]) {
    case 'doctor': await doctor(config);break;
    case 'qwen':
      if(args[1]!=='check')throw new Error('Use qwen check');
      await checkQwen(config);break;
    case 'schedule': await schedule(config,{system:args.includes('--system')});break;
    case 'due': await runDue(config);break;
    case 'sample': await runDaily(config,{sample:true,renderOnly:true,passageId:option('--passage')});break;
    case 'daily': await runDaily(config,{renderOnly:args.includes('--render-only')});break;
    case 'backgrounds':
      if(args[1]==='fetch')console.log(await fetchBackgroundCandidates(config,option('--theme') || 'mountains'));
      else if(args[1]==='approve')console.log(await approveBackground(config,args[2],args.includes('--reviewed')));
      else throw new Error('Use backgrounds fetch or approve');
      break;
    case 'delivery': await resolveDelivery(config);break;
    default: throw new Error('Unknown command. Use --help');
  }
}

if(process.argv[1]===new URL(import.meta.url).pathname) {
  main().catch(error=>{
    console.error(`Agent stopped safely: ${error.message}`);
    process.exitCode=error.exitCode || 1;
  });
}
