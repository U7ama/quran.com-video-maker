import {mkdir,writeFile} from 'node:fs/promises';
import {userInfo} from 'node:os';
import path from 'node:path';
import {AGENT_DIR,dayKey} from './config.mjs';

// Last scheduled calendar date, including a missed run before today's deadline.
export function latestDueDate(now,timezone,dailyTime) {
 const today=dayKey(now,timezone);
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const time=`${parts.find(p=>p.type==='hour').value}:${parts.find(p=>p.type==='minute').value}`;
 if(time>=dailyTime)return today;
 const [year,month,day]=today.split('-').map(Number);
 return new Date(Date.UTC(year,month-1,day-1)).toISOString().slice(0,10);
}

export function makeUnits(config,{system=false,username=userInfo().username,node=process.execPath,directory=AGENT_DIR}={}) {
 if(!/^[a-z_][a-z0-9_-]*[$]?$/i.test(username))throw new Error('Invalid scheduler user');
 const quote=value=>`"${value.replace(/%/g,'%%').replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;
 const invocation=[node,path.join(directory,'cli.mjs'),'due'];
 // Only the trusted inhibitor wrapper runs as root. Node, Chrome and FFmpeg run
 // as the owner's account through runuser; credentials stay in that private .env.
 const start=system ? ['/usr/bin/systemd-inhibit','--what=sleep:idle:handle-lid-switch','--mode=block',
  '--who=Daily Quran Agent','--why=Generating and delivering the daily Quran video',
  '/usr/sbin/runuser','-u',username,'--',...invocation] : invocation;
 const retry=system ? 'Restart=on-failure\nRestartSec=5s\nRestartPreventExitStatus=70 78\n' : '';
 const service=`[Unit]\nDescription=Generate and DM the latest due Quran video\nWants=network-online.target\nAfter=network-online.target\nStartLimitIntervalSec=2min\nStartLimitBurst=6\n\n[Service]\nType=oneshot\nWorkingDirectory=${directory.replace(/%/g,'%%')}\nExecStart=${start.map(quote).join(' ')}\nEnvironment=NODE_ENV=production\nEnvironment=PATH=/usr/local/bin:/usr/bin:/bin\nUMask=0077\nNice=10\nIOSchedulingClass=best-effort\nIOSchedulingPriority=7\nTimeoutStartSec=45min\n${retry}SuccessExitStatus=78\n\n`;
 const timer=`[Unit]\nDescription=Daily Quran video at ${config.dailyTime} ${config.timezone}\n\n[Timer]\nOnCalendar=*-*-* ${config.dailyTime}:00 ${config.timezone}\nPersistent=true\nWakeSystem=${system ? 'true' : 'false'}\nAccuracySec=1s\nUnit=quran-video-agent.service\n\n[Install]\nWantedBy=timers.target\n`;
 const catchup=`[Unit]\nDescription=Catch up the latest due Quran video after boot, resume or network recovery\n\n[Timer]\n${system ? 'OnBootSec' : 'OnStartupSec'}=2min\nOnCalendar=*-*-* *:0/15:00 ${config.timezone}\nPersistent=true\nWakeSystem=false\nAccuracySec=1min\nUnit=quran-video-agent.service\n\n[Install]\nWantedBy=timers.target\n`;
 return {'quran-video-agent.service':service,'quran-video-agent.timer':timer,'quran-video-agent-catchup.timer':catchup};
}

export async function schedule(config,options={}) {
 const directory=path.join(AGENT_DIR,options.system ? 'systemd-system' : 'systemd');
 await mkdir(directory,{recursive:true,mode:0o700});
 for(const [name,contents] of Object.entries(makeUnits(config,options)))await writeFile(path.join(directory,name),contents);
 console.log(`Generated ${options.system ? 'system' : 'user'} units: ${directory}`);
 return directory;
}
