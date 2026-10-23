import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import {runInspectionTest} from '../inspection-test.mjs';

test('cloud smoke test refuses arbitrary files before reading configuration or calling a tool',async()=>{
  let calls=0;const deps={object:async()=>{calls++;}};
  await assert.rejects(runInspectionTest({action:'inspection-test',candidate:'../../state'},deps),/Invalid/);
  await assert.rejects(runInspectionTest({action:'inspection-test',candidate:'nature',key:'cloud/state.json'},deps),/Invalid/);
  assert.equal(calls,0);
});

test('cloud smoke test rejects altered fixture bytes and cleans its temporary file',async()=>{
  let source,reviewed=false;
  await assert.rejects(runInspectionTest({action:'inspection-test',candidate:'nature'}, {
    object:async()=>({Body:{transformToString:async()=>''}}),load:async()=>({}),
    file:async(key,destination)=>{assert.equal(key,'cloud/tool-tests/2026-10-23/nature.mp4');source=destination;await writeFile(source,'wrong bytes');return true;},
    review:async()=>{reviewed=true;},
  }),/checksum/);
  assert.equal(reviewed,false);await assert.rejects(access(source));
});
