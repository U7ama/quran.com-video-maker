import test from 'node:test';
import assert from 'node:assert/strict';
import {S3Client} from '@aws-sdk/client-s3';
import {acquireLease,releaseLease} from '../aws.js';

test('cloud lease admits one concurrent run, permits crash recovery, and rejects an old owner',async()=>{
  const original=S3Client.prototype.send;
  let stored=null,version=0;
  S3Client.prototype.send=async function(command) {
    const input=command.input;
    const fail=()=>{throw Object.assign(new Error('Conflict'),{name:'PreconditionFailed'});};
    switch(command.constructor.name) {
      case 'GetObjectCommand':
        if(!stored)throw Object.assign(new Error('Missing'),{name:'NoSuchKey'});
        return {ETag:stored.etag,Body:{transformToString:async()=>stored.body}};
      case 'PutObjectCommand':
        if(input.IfNoneMatch==='*' && stored)fail();
        if(input.IfMatch && stored?.etag!==input.IfMatch)fail();
        stored={body:input.Body,etag:`"${++version}"`};
        return {ETag:stored.etag};
      case 'DeleteObjectCommand':
        if(input.IfMatch!==stored?.etag)fail();
        stored=null;return {};
      default:throw new Error('Unexpected SDK operation');
    }
  };
  try {
    const attempts=await Promise.all([acquireLease('a',0),acquireLease('b',0)]);
    assert.equal(attempts.filter(Boolean).length,1);
    const first=attempts.find(Boolean);
    assert.equal(await acquireLease('c',999999),null);
    const recovered=await acquireLease('c',1000001);
    assert.ok(recovered);
    await assert.rejects(releaseLease(first),{name:'PreconditionFailed'});
    assert.equal(await acquireLease('d',1000001),null);
    await releaseLease(recovered);
    assert.ok(await acquireLease('d',1000001));
  } finally {S3Client.prototype.send=original;}
});
