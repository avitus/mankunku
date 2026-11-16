// Host orchestration only. All execution and audio processing stays in Linux.
import { mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const name='mankunku-acoustic-bleed-lab';
function run(args){const p=spawnSync('docker',args,{stdio:'inherit'});if(p.status!==0)throw Error('Docker command failed');}
if(process.argv.includes('--stop')){run(['rm','-f',name]);process.exit(0);}
const info=spawnSync('docker',['info','--format','{{.OSType}}'],{encoding:'utf8'});
if(info.stdout.trim()!=='linux')throw Error('A local Linux Docker engine is required.');
const snapshot=await mkdtemp(join(tmpdir(),'mankunku-bleed-lab-'));
try{
  for(const path of ['src','static','package.json','package-lock.json','research/acoustic-bleed']){
    await mkdir(join(snapshot,path,'..'),{recursive:true});
    await cp(join(root,path),join(snapshot,path),{recursive:true,filter:p=>!/(?:^|\/)(results|__pycache__|input-events)(?:\/|$)/.test(p)});
  }
  run(['build','-t','mankunku-acoustic-bleed-lab:local','-f',join(snapshot,'research/acoustic-bleed/Dockerfile'),snapshot]);
  const previous=spawnSync('docker',['container','inspect',name],{stdio:'ignore'});
  if(previous.status===0)run(['rm','-f',name]);
  run(['run','-d','--name',name,'--cpus=2','--memory=3g','--pids-limit=256','--cap-drop=ALL','--security-opt=no-new-privileges','-p','127.0.0.1:5188:5188','mankunku-acoustic-bleed-lab:local']);
  console.log('Open http://localhost:5188/research/acoustic-bleed/lab.html manually for a microphone session.');
}finally{await rm(snapshot,{recursive:true,force:true});}
