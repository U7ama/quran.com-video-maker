import {S3Client,GetObjectCommand,PutObjectCommand,DeleteObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

export const PRIVATE_BUCKET='quran-agent-129631621612-us-east-1';
export const MEDIA_BUCKET='remotionlambda-useast1-quran-129631621612';
export const REGION='us-east-1';
const s3=new S3Client({region:REGION,maxAttempts:3});
const lambda=new LambdaClient({region:REGION,maxAttempts:2});

export async function getObject(Key,Bucket=PRIVATE_BUCKET) {
  try {return await s3.send(new GetObjectCommand({Bucket,Key}));}
  catch(error) {if(error.name==='NoSuchKey')return null;throw error;}
}
export async function getJson(Key,fallback,Bucket=PRIVATE_BUCKET) {
  const object=await getObject(Key,Bucket);
  return object ? JSON.parse(await object.Body.transformToString()) : fallback;
}
export async function putJson(Key,value,conditions={}) {
  return s3.send(new PutObjectCommand({Bucket:PRIVATE_BUCKET,Key,Body:JSON.stringify(value),
    ContentType:'application/json',ServerSideEncryption:'AES256',...conditions}));
}
export async function putFile(Key,file,Bucket=PRIVATE_BUCKET) {
  return s3.send(new PutObjectCommand({Bucket,Key,Body:await readFile(file),ServerSideEncryption:'AES256'}));
}
export async function getFile(Key,file,Bucket=PRIVATE_BUCKET) {
  const object=await getObject(Key,Bucket);
  if(!object)return false;
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  await writeFile(file,await object.Body.transformToByteArray(),{mode:0o600});
  return true;
}
export async function signedMedia(Key) {
  return getSignedUrl(s3,new GetObjectCommand({Bucket:MEDIA_BUCKET,Key}),{expiresIn:3600});
}
export async function signedSite() {
  return getSignedUrl(s3,new GetObjectCommand({Bucket:MEDIA_BUCKET,Key:'sites/quran/index.html'}),{expiresIn:3600});
}
export async function acquireLease(owner,now=Date.now()) {
  const value={owner,expiresAt:now+1000*1000};
  try {
    const lease=await putJson('cloud/lease.json',value,{IfNoneMatch:'*'});
    return lease.ETag;
  } catch(error) {
    if(!['PreconditionFailed','ConditionalRequestConflict'].includes(error.name))throw error;
  }
  const previous=await getObject('cloud/lease.json');
  if(!previous)return null;
  const body=JSON.parse(await previous.Body.transformToString());
  if(body.expiresAt>now)return null;
  try {return (await putJson('cloud/lease.json',value,{IfMatch:previous.ETag})).ETag;}
  catch(error) {if(['PreconditionFailed','ConditionalRequestConflict'].includes(error.name))return null;throw error;}
}
export async function releaseLease(ETag) {
  await s3.send(new DeleteObjectCommand({Bucket:PRIVATE_BUCKET,Key:'cloud/lease.json',IfMatch:ETag}));
}
export async function continueRun() {
  return lambda.send(new InvokeCommand({FunctionName:'quran-daily-agent',InvocationType:'Event',Payload:Buffer.from('{}')}));
}

export async function objectMetadata(Bucket,Key) {
  try {
    const object=await s3.send(new HeadObjectCommand({Bucket,Key}));
    return {etag:object.ETag,bytes:object.ContentLength};
  } catch(error) {
    if(['NoSuchKey','NotFound'].includes(error.name))return null;
    throw error;
  }
}

export async function deleteRetainedObject(Bucket,Key,etag) {
  if(typeof etag!=='string' || !etag.trim() || etag==='*')throw new Error('Retention exact object version is missing');
  await s3.send(new DeleteObjectCommand({Bucket,Key,IfMatch:etag}));
}
