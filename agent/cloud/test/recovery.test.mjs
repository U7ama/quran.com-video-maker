import test from 'node:test';
import assert from 'node:assert/strict';
import {retryFailedRender} from '../recovery.mjs';
const progress={timeoutTimestamp:10,combinedFrames:0,receivedArtifact:[],chunks:[1],renderMetadata:{totalChunks:5}};

test('expired failed renders retain selection and audit trail, with a single repair attempt',()=>{
 const state={status:'render-error',renderId:'old',selection:{passageId:'97:1-5'},previousRenderIds:['older']};
 const next=retryFailedRender(state,progress,11);
 assert.equal(next.status,'preparing');assert.deepEqual(next.selection,state.selection);
 assert.deepEqual(next.previousRenderIds,['older','old']);
 assert.equal(next.renderRepairAttempts,1);assert.equal(state.status,'render-error');
 assert.throws(()=>retryFailedRender({...next,status:'render-error'},progress,11));
});

test('recovery refuses active, completed, attempted and ambiguous delivery states',()=>{
 const state={status:'render-error',renderId:'old',selection:{passageId:'97:1-5'}};
 for(const patch of [{status:'sending'},{status:'uncertain'},{status:'delivered'},{attemptedAt:'date'},
  {messageId:'id'},{channelId:'id'},{deliveredAt:'date'},{masterKey:'key'},{uploadKey:'key'}]) {
  assert.throws(()=>retryFailedRender({...state,...patch},progress,11));
 }
 for(const change of [{timeoutTimestamp:11},{timeoutTimestamp:12},{postRenderData:{}},
  {combinedFrames:1},{receivedArtifact:['out.mp4']},{chunks:[0,1,2,3,4]},{renderMetadata:null}]) {
  assert.throws(()=>retryFailedRender(state,{...progress,...change},11));
 }
 assert.throws(()=>retryFailedRender(state,{},11));
});
