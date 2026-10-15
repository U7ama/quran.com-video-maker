import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {sleep} from './io.mjs';
import {STOCK_PROVIDERS} from './core.mjs';

export function hasDeliveryConfig(config) {
  return Boolean(config.webhookUrl || (config.botToken && config.discordUserId));
}

export function validateWebhook(value) {
  const url=new URL(value);
  if(url.protocol!=='https:' || !['discord.com','discordapp.com'].includes(url.hostname) ||
      url.username || url.password || !/^\/api(?:\/v10)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
    throw new Error('DISCORD_WEBHOOK_URL must be an official Discord webhook URL');
  }
  url.searchParams.set('wait','true');
  return url;
}

async function postAttachment(url, headers, payload, file, maxBytes, fetchFn) {
  if ((await stat(file)).size>maxBytes) throw new Error('Attachment exceeds the configured upload limit');
  for(let attempt=0;attempt<3;attempt++) {
    const form=new FormData();
    form.set('payload_json',JSON.stringify(payload));
    form.set('files[0]',new Blob([await readFile(file)],{type:'video/mp4'}),path.basename(file));
    let response;
    try { response=await fetchFn(url,{method:'POST',headers,body:form,
      signal:AbortSignal.timeout(120000),redirect:'error'}); }
    catch { throw Object.assign(new Error('Discord delivery acknowledgement was lost; check the channel before retrying'),{uncertain:true}); }
    if(response.status===429) {
      const body=await response.json().catch(()=>({}));
      const retry=Number(body.retry_after);
      if(attempt===2 || !Number.isFinite(retry) || retry<0 || retry>60) {
        throw Object.assign(new Error('Discord rate limit; the prepared video is retained'),{definite:true});
      }
      await sleep(Math.ceil(retry*1000)); continue;
    }
    if(!response.ok) throw Object.assign(new Error(`Discord upload HTTP ${response.status}`),
      {uncertain:response.status>=500,definite:response.status<500});
    let message;
    try {message=await response.json();}
    catch {throw Object.assign(new Error('Discord returned an unreadable delivery acknowledgement'),{uncertain:true});}
    if(!message.id || !message.attachments?.length) {
      throw Object.assign(new Error('Discord did not confirm the video attachment'),{uncertain:true});
    }
    return {messageId:message.id,channelId:message.channel_id,deliveredAt:new Date().toISOString()};
  }
}

export async function deliver(config, manifest, file, fetchFn=fetch) {
  const source=`https://quran.com/${manifest.passage.chapter}/${manifest.passage.from}-${manifest.passage.to}`;
  let content=`Daily Quran video • ${manifest.date}\n${manifest.passage.name} (${manifest.passage.id})\n`+
    `Translation of meaning: ${manifest.translation.name}\nReciter: ${manifest.reciter.name}\nSource: ${source}`;
  if(manifest.variant)content+=`\nVersion: ${manifest.variant==='urdu' ? 'Arabic recitation + Urdu narration' : 'Arabic recitation only (Urdu text retained)'}`;
  if(manifest.narration) content+=`\nUrdu narration: ${manifest.narration.narrator} (${manifest.narration.provider})\nRecorded narration is separate from the written translation.\n${manifest.narration.source}`;
  const stockProvider=STOCK_PROVIDERS[manifest.background.provider];
  if(manifest.background.provider==='builtin')content+=`\nBackground: Quran.com media-maker default (${manifest.background.id})\n${manifest.background.sourceUrl}`;
  if(stockProvider) {
    content+=`\nVideo by ${manifest.background.creator} on ${stockProvider.name}: ${manifest.background.sourceUrl}\n${stockProvider.homepage}\nLicense: ${stockProvider.licenseUrl}`;
  }
  const payload={content:content.slice(0,1900),allowed_mentions:{parse:[]},
    attachments:[{id:0,filename:path.basename(file),description:`Quran ${manifest.passage.id}`} ]};
  if(config.webhookUrl) return postAttachment(validateWebhook(config.webhookUrl),{},payload,file,config.discordMaxBytes,fetchFn);
  if(!config.botToken || !/^\d{15,22}$/.test(config.discordUserId)) throw new Error('Configure a Discord webhook or a bot token and your user ID');
  const headers={Authorization:`Bot ${config.botToken}`};
  const self=await fetchFn('https://discord.com/api/v10/users/@me',{headers,signal:AbortSignal.timeout(15000),redirect:'error'});
  const identity=await self.json();
  if(!self.ok || identity.bot!==true) throw new Error('A genuine Discord bot token is required; user-account automation is not supported');
  const response=await fetchFn('https://discord.com/api/v10/users/@me/channels',{
    method:'POST',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({recipient_id:config.discordUserId}),signal:AbortSignal.timeout(15000),redirect:'error',
  });
  const channel=await response.json();
  if(!response.ok || !/^\d+$/.test(channel.id)) throw new Error('Discord bot could not open your DM');
  return postAttachment(`https://discord.com/api/v10/channels/${channel.id}/messages`,headers,payload,file,config.discordMaxBytes,fetchFn);
}
