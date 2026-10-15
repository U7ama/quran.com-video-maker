import test from 'node:test';
import assert from 'node:assert/strict';
import {renderedObjectKey} from '../output.mjs';

test('Remotion output accepts both S3 addressing formats and never repeats the bucket in its object key',()=>{
  const bucket='remotionlambda-test',id='render123',key=`renders/${id}/out.mp4`;
  assert.equal(renderedObjectKey(`https://${bucket}.s3.us-east-1.amazonaws.com/${key}`,bucket,id),key);
  assert.equal(renderedObjectKey(`https://s3.us-east-1.amazonaws.com/${bucket}/${key}`,bucket,id),key);
  assert.throws(()=>renderedObjectKey(`https://${bucket}.s3.us-east-1.amazonaws.com/renders/other/out.mp4`,bucket,id));
  assert.throws(()=>renderedObjectKey(`https://example.com/${key}`,bucket,id));
});
