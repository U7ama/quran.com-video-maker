export const RETENTION_DAYS=7;
const DAY=86400000;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ID=/^[a-zA-Z0-9-]+$/;
const HASH=/^[a-f0-9]{64}$/;
const SNOWFLAKE=/^\d{15,22}$/;

// Imported laptop receipts have no cloud media. Never infer their object keys.
export function retentionCandidate(date,run,now=Date.now()) {
  if(!DATE.test(date) || run?.date!==date || run.status!=='delivered' ||
      !SNOWFLAKE.test(run.messageId || '') || !SNOWFLAKE.test(run.channelId || '') ||
      !ID.test(run.renderId || '') || run.retention?.status==='cleaned')return null;
  const delivered=Date.parse(run.deliveredAt);
  if(!Number.isFinite(delivered) || delivered>now)return null;
  return {date,...(run.variant ? {variant:run.variant} : {}),eligibleAt:new Date(delivered+RETENTION_DAYS*DAY).toISOString(),
    due:now>=delivered+RETENTION_DAYS*DAY};
}

function assetKey(src,bucket,date) {
  const url=new URL(src);
  let key;
  if(url.protocol!=='https:' || url.username || url.password)throw new Error('Retention asset source is invalid');
  if([`${bucket}.s3.us-east-1.amazonaws.com`,`${bucket}.s3.amazonaws.com`].includes(url.hostname)) {
    key=decodeURIComponent(url.pathname.slice(1));
  } else if(['s3.us-east-1.amazonaws.com','s3.amazonaws.com'].includes(url.hostname) && url.pathname.startsWith(`/${bucket}/`)) {
    key=decodeURIComponent(url.pathname.slice(bucket.length+2));
  } else throw new Error('Retention asset source is outside the media bucket');
  const prefix=`assets/${date}/`;
  if(!key.startsWith(prefix) || !/^[A-Za-z0-9_.-]+$/.test(key.slice(prefix.length)) || key.includes('..')) {
    throw new Error('Retention asset escaped the confirmed run');
  }
  return key;
}

export function retentionPlan(date,run,manifest,prepared,buckets,now=Date.now()) {
  if(!retentionCandidate(date,run,now))return null;
  const masterKey=`renders/${run.renderId}/out.mp4`;
  const prefix=run.variant ? variantPrefix(date,run.variant) : `cloud/runs/${date}`;
  const uploadKey=`${prefix}/video.discord.mp4`;
  if(manifest?.date!==date || run.renderBucket!==buckets.media ||
      run.masterKey!==masterKey || run.uploadKey!==uploadKey ||
      manifest.cloud?.renderId!==run.renderId || manifest.cloud?.masterBucket!==buckets.media ||
      manifest.cloud?.masterKey!==masterKey || !HASH.test(manifest.video?.sha256 || '') ||
      !HASH.test(manifest.upload?.sha256 || '') || (run.variant && manifest.variant!==run.variant)) {
    throw new Error('Retention metadata does not match the confirmed cloud run');
  }
  const masterDelivered=manifest.upload.encoding==='master' &&
    manifest.upload.sha256===manifest.video.sha256;
  const objects=[{bucket:buckets.private,key:uploadKey},
    {bucket:buckets.private,key:`${prefix}/prepared.json`},
    {bucket:buckets.private,key:`${prefix}/preview.png`},
    {bucket:buckets.media,key:`renders/${run.renderId}/progress.json`}];
  if(masterDelivered)objects.push({bucket:buckets.media,key:masterKey});
  if(!run.variant || run.variant==='urdu')objects.push({bucket:buckets.private,key:`cloud/backgrounds/${date}.mp4`});
  // Signed URLs are parsed only to recover our exact asset keys; never fetched or logged.
  if(prepared?.props) {
    const props=prepared.props;
    const sources=[props.audioSrc,props.background?.src,...(prepared.retentionSources || []),
      ...(props.cues || []).flatMap(cue=>[cue.arabicAudioSrc,cue.urduAudioSrc])].filter(Boolean);
    const keys=new Set(sources.map(src=>assetKey(src,buckets.media,date)));
    // Urdu owns the shared media; both variants must be confirmed before eligibility.
    if(!run.variant || run.variant==='urdu')for(const key of keys)objects.push({bucket:buckets.media,key});
  } else if(!run.retention?.inventory)throw new Error('Retention asset inventory is missing');
  return {date,variant:run.variant,masterKey,preserveMaster:!masterDelivered,objects};
}

function validateInventory(plan,inventory,buckets) {
  const allowed=new Set(plan.objects.map(o=>`${o.bucket}/${o.key}`));
  for(const object of inventory) {
    const isAsset=plan.variant!=='recitation' && object.bucket===buckets.media && object.key.startsWith(`assets/${plan.date}/`) &&
      /^[A-Za-z0-9_.-]+$/.test(object.key.slice(`assets/${plan.date}/`.length)) && !object.key.includes('..');
    if((!allowed.has(`${object.bucket}/${object.key}`) && !isAsset) || !object.etag || object.etag==='*' ||
        (plan.preserveMaster && object.key===plan.masterKey))throw new Error('Retention inventory escaped the confirmed run');
  }
}

export async function maintainRetention(cloud,deps,{now=Date.now(),date,preview=false,force=false}={}) {
  const candidates=Object.entries(cloud.runs || {}).flatMap(([day,run])=>{
    if(run.version!==2)return [retentionCandidate(day,run,now)].filter(Boolean);
    if(!DAILY_VARIANTS.every(id=>run.variants[id]?.status==='delivered'))return [];
    const latest=Math.max(...DAILY_VARIANTS.map(id=>Date.parse(run.variants[id].deliveredAt)));
    if(!Number.isFinite(latest) || latest>now)return [];
    return DAILY_VARIANTS.map(id=>retentionCandidate(day,run.variants[id],now)).filter(Boolean).map(c=>({...c,
      eligibleAt:new Date(latest+RETENTION_DAYS*DAY).toISOString(),due:now>=latest+RETENTION_DAYS*DAY}));
  });
  const candidateRun=c=>c.variant ? cloud.runs[c.date].variants[c.variant] : cloud.runs[c.date];
  if(preview)return {status:'preview',days:RETENTION_DAYS,candidates};
  if(!force && cloud.retention?.lastCheckedDate===date &&
      candidates.every(c=>candidateRun(c).retention?.inventory))return {status:'already-checked'};
  let cleanedRuns=0,initializedRuns=0;
  for(const candidate of candidates) {
    const run=candidateRun(candidate);
    const manifest=await deps.getManifest(candidate.date,candidate.variant);
    const prepared=run.retention?.inventory ? null : await deps.getPrepared(candidate.date,candidate.variant);
    const plan=retentionPlan(candidate.date,run,manifest,prepared,deps.buckets,now);
    if(!run.retention?.inventory) {
      const inventory=[];
      for(const object of plan.objects) {
        const metadata=await deps.objectMetadata(object.bucket,object.key);
        if(metadata) {
          if(!metadata.etag)throw new Error('Retention object version is missing');
          inventory.push({...object,etag:metadata.etag,bytes:metadata.bytes});
        }
      }
      run.retention={status:'retained',inventory,initializedAt:new Date(now).toISOString(),
        eligibleAt:candidate.eligibleAt,days:RETENTION_DAYS,
        preservedMasterKey:plan.preserveMaster ? plan.masterKey : null};
      await deps.save(cloud);
      initializedRuns++;
      // Never snapshot old objects and delete them in the same invocation.
      continue;
    }
    if(!candidate.due)continue;
    validateInventory(plan,run.retention.inventory,deps.buckets);
    for(const object of run.retention.inventory) {
      if(object.deletedAt)continue;
      await deps.deleteRetainedObject(object.bucket,object.key,object.etag);
      object.deletedAt=new Date(now).toISOString();
      await deps.save(cloud);
    }
    run.retention.status='cleaned';
    run.retention.cleanedAt=new Date(now).toISOString();
    await deps.save(cloud);
    cleanedRuns++;
  }
  cloud.retention={lastCheckedDate:date,lastCheckedAt:new Date(now).toISOString(),days:RETENTION_DAYS,cleanedRuns,initializedRuns};
  await deps.save(cloud);
  return {status:'checked',days:RETENTION_DAYS,cleanedRuns,initializedRuns};
}
import {DAILY_VARIANTS,variantPrefix} from '../variants.mjs';
