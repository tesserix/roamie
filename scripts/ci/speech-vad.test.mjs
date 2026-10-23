import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const root=resolve('apps/mobile/modules/roamie-capture');
const sources=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sources(join(dir,e.name)):e.name.endsWith('.c')?[join(dir,e.name)]:[]);
test('native denoiser suppresses noise and preserves speech detection',()=>{
 const temp=mkdtempSync(join(tmpdir(),'roamie-vad-'));
 try {
  const binary=join(temp,'check');
  execFileSync('cc',['-std=gnu11','-O2','-DCOMPILE_OPUS','-I',join(root,'ios/common/include'),'-I',join(root,'ios/common/src'),'-I',join(root,'ios/common/fvad/include'),'-I',join(root,'ios/common/fvad/src'),join(root,'tests/check.c'),...sources(join(root,'ios/common/src')),...sources(join(root,'ios/common/fvad/src')),'-lm','-o',binary]);
  const run=pcm=>{
   const file=join(temp,'audio.pcm');writeFileSync(file,pcm);
   return Object.fromEntries(execFileSync(binary,[file],{encoding:'utf8'}).trim().split(' ').map(item=>{const[k,v]=item.split('=');return[k,Number(v)];}));
  };
  assert.equal(run(Buffer.alloc(48000*2*3)).speech_frames,0);
  const noise=Buffer.alloc(48000*2*3);let seed=42;
  for(let i=0;i<noise.length;i+=2){seed=(Math.imul(seed,1664525)+1013904223)>>>0;noise.writeInt16LE(Math.round((seed/4294967295*2-1)*1800),i);}
  const result=run(noise);
  assert.ok(result.max_run_ms<300,JSON.stringify(result));
  assert.ok(result.reduction_db>6,JSON.stringify(result));
  const clicks=Buffer.alloc(48000*2*3);
  for(let burst=0;burst<3;burst++) for(let i=0;i<96;i++) clicks.writeInt16LE(i%2?24000:-24000,(burst*48000+12000+i)*2);
  const impulsive=run(clicks);
  assert.ok(impulsive.max_run_ms<300,JSON.stringify(impulsive));
  const wav=readFileSync(join(root,'tests/speech.wav'));let offset=12;let pcm;
  while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}
  assert.ok(pcm?.length);
  const resampled=Buffer.alloc(pcm.length*3);
  for(let i=0;i<pcm.length/2;i++) for(let j=0;j<3;j++) {
   const a=pcm.readInt16LE(i*2),b=pcm.readInt16LE(Math.min(i+1,pcm.length/2-1)*2);
   resampled.writeInt16LE(Math.round(a+(b-a)*j/3),(i*3+j)*2);
  }
  pcm=resampled;
  const soft=Buffer.from(pcm);
  for(let i=0;i<soft.length;i+=2) soft.writeInt16LE(Math.round(soft.readInt16LE(i)/4),i);
  assert.ok(run(soft).speech_frames>30,'soft speech must remain detectable');
  const mixed=Buffer.from(pcm);
  for(let i=0;i<mixed.length;i+=2){const value=pcm.readInt16LE(i)+noise.readInt16LE(i%noise.length);mixed.writeInt16LE(Math.max(-32768,Math.min(32767,value)),i);}
  const speech=run(Buffer.concat([noise,mixed,noise]));
  assert.ok(speech.speech_frames>30,JSON.stringify(speech));
  assert.ok(speech.last_speech_ms<3000+pcm.length/96+500,JSON.stringify(speech));
 } finally {rmSync(temp,{recursive:true,force:true});}
});
