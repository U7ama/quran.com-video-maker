import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {latestDueDate,makeUnits} from '../scheduler.mjs';
import {runDue,savedSelection} from '../workflow.mjs';
import {writeJson} from '../io.mjs';

const settings={timezone:'Asia/Karachi',dailyTime:'06:00'};

test('latest due date catches sleep, shutdown, and pre-deadline startup without early delivery',()=>{
 assert.equal(latestDueDate(new Date('2026-10-04T00:59:59Z'),'Asia/Karachi','06:00'),'2026-10-03');
 assert.equal(latestDueDate(new Date('2026-10-04T01:00:00Z'),'Asia/Karachi','06:00'),'2026-10-04');
 assert.equal(latestDueDate(new Date('2026-10-04T04:00:00Z'),'Asia/Karachi','06:00'),'2026-10-04');
 assert.equal(latestDueDate(new Date('2027-01-01T00:00:00Z'),'Asia/Karachi','06:00'),'2026-12-31');
 assert.equal(latestDueDate(new Date('2028-03-01T00:00:00Z'),'Asia/Karachi','06:00'),'2028-02-29');
 assert.equal(latestDueDate(new Date('2026-10-04T23:00:00Z'),'America/New_York','06:00'),'2026-10-04');
});

test('catch-up invokes only the most recent due date and skips confirmed or uncertain uploads',async t=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'quran-catchup-'));
 t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const config={...settings,dataDir};let calls=0;
 const run=async(_config,options)=>{calls++;assert.equal(options.scheduledDate,'2026-10-10');return {status:'ran'};};
 const now=new Date('2026-10-10T06:00:00Z');
 await writeJson(path.join(dataDir,'runs','2026-10-03','state.json'),{status:'delivered'});
 assert.equal((await runDue(config,{now,run,log:()=>{}})).status,'ran');assert.equal(calls,1);
 const stateFile=path.join(dataDir,'runs','2026-10-10','state.json');
 await writeJson(stateFile,{status:'delivered'});
 assert.equal((await runDue(config,{now,run,log:()=>{}})).status,'skip');assert.equal(calls,1);
 for(const status of ['sending','uncertain']) {
  await writeJson(stateFile,{status});
  assert.equal((await runDue(config,{now,run,log:()=>{}})).status,'hold');assert.equal(calls,1);
 }
});

test('a pre-6 AM reboot does not create today’s video when yesterday was delivered',async t=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'quran-before-deadline-'));
 t.after(()=>rm(dataDir,{recursive:true,force:true}));
 await writeJson(path.join(dataDir,'runs','2026-10-03','state.json'),{status:'delivered'});
 const result=await runDue({...settings,dataDir},{now:new Date('2026-10-04T00:30:00Z'),
  log:()=>{},run:async()=>{throw new Error('Must wait until today’s deadline');}});
 assert.equal(result.status,'skip');assert.equal(result.date,'2026-10-03');
});

test('failed runs retain a valid saved model selection without repeatedly spending Qwen tokens',()=>{
 const selection={passageId:'103:1-3',translationId:54,theme:'mountains',selector:'qwen',model:'qwen3.7-flash'};
 assert.equal(savedSelection({status:'failed',selection},{translationIds:[54]}),selection);
 assert.equal(savedSelection({selection:{...selection,passageId:'2:1-5'}},{translationIds:[54]}),null);
 assert.equal(savedSelection({selection},{translationIds:[131]}),null);
});

test('system units wake only at the daily time, catch up while awake, and run Node as the owner',()=>{
 const units=makeUnits(settings,{system:true,username:'usama',node:'/opt/node22/bin/node',directory:'/tmp/Quran Agent'});
 assert.match(units['quran-video-agent.timer'],/OnCalendar=\*-\*-\* 06:00:00 Asia\/Karachi/);
 assert.match(units['quran-video-agent.timer'],/WakeSystem=true/);
 assert.match(units['quran-video-agent-catchup.timer'],/WakeSystem=false/);
 assert.match(units['quran-video-agent-catchup.timer'],/OnBootSec=2min/);
 assert.match(units['quran-video-agent-catchup.timer'],/OnCalendar=\*-\*-\* \*:0\/15:00 Asia\/Karachi/);
 const service=units['quran-video-agent.service'];
 assert.match(service,/systemd-inhibit/);assert.match(service,/--what=sleep:idle:handle-lid-switch/);
 assert.match(service,/runuser" "-u" "usama" "--" "\/opt\/node22\/bin\/node"/);
 assert.match(service,/WorkingDirectory=\/tmp\/Quran Agent\n/);
 assert.match(service,/cli.mjs" "due"/);
 assert.match(service,/StartLimitIntervalSec=2min/);
 assert.match(service,/StartLimitBurst=6/);
 assert.match(service,/RestartSec=5s/);
 assert.match(service,/RestartPreventExitStatus=70 78/);
 assert.ok(!service.includes('API_KEY'));
 const userUnits=makeUnits(settings,{system:false});
 assert.match(userUnits['quran-video-agent.timer'],/WakeSystem=false/);
 assert.match(userUnits['quran-video-agent-catchup.timer'],/OnStartupSec=2min/);
});

test('application errors are separated from inhibitor launch failures for bounded startup retries',async t=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'quran-inhibitor-retry-'));
 t.after(()=>rm(dataDir,{recursive:true,force:true}));
 for(const exitCode of [undefined,78]) {
  await assert.rejects(runDue({...settings,dataDir},{now:new Date('2026-10-04T04:00:00Z'),log:()=>{},
   run:async()=>{throw Object.assign(new Error('Network or configuration unavailable'),{exitCode});}}),
   error=>error.exitCode===(exitCode || 70));
 }
});
