import { test, expect } from './fixtures/test';
import { createServer, request, type Server } from 'node:http';
let proxy:Server;
test.beforeAll(async()=>{
 proxy=createServer((req,res)=>{
  const upstream=request({hostname:'host.docker.internal',port:5188,path:req.url,method:req.method,headers:{...req.headers,host:'localhost:5188'}},incoming=>{res.writeHead(incoming.statusCode!,incoming.headers);incoming.pipe(res);});
  upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
 });
 await new Promise<void>(resolve=>proxy.listen(5188,'127.0.0.1',resolve));
});
test.afterAll(async()=>{proxy.closeAllConnections();await new Promise<void>(resolve=>proxy.close(()=>resolve()));});

// The page and its cancellation server run in the separate Linux lab container.
// Browser automation stays in the repository's standard Linux sandbox runner.
test('local acoustic lab completes ear and lick takes and keeps mixed playback',async({page},info)=>{
 test.setTimeout(300_000);
 await page.addInitScript(()=>{
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
   const ctx=new AudioContext(),dest=ctx.createMediaStreamDestination(),osc=ctx.createOscillator(),gain=ctx.createGain();
   osc.frequency.value=220;gain.gain.value=.06;osc.connect(gain);gain.connect(dest);osc.start();await ctx.resume();
   const track=dest.stream.getAudioTracks()[0],stop=track.stop.bind(track);
   let stopped=false;track.stop=()=>{if(stopped)return;stopped=true;stop();osc.stop();void ctx.close();};return dest.stream;
  }});
 });
 await page.goto('http://localhost:5188/research/acoustic-bleed/lab.html');
 await expect(page.locator('#phrase option').first()).toBeAttached();
 await page.screenshot({path:info.outputPath('desktop.png'),fullPage:true});
 for(const mode of ['ear','lick']){
  await page.locator('#mode').selectOption(mode);
  await page.locator('#tempo').fill('160');
  if(mode==='lick')await page.locator('#accompaniment').selectOption('backing');
  await page.getByRole('button',{name:'Start a take',exact:true}).click();
  await expect.poll(async()=>{
   const cue=await page.locator('#cue').textContent();
   if(cue==='Take needs attention')return await page.locator('#instruction').textContent();
   return cue==='Ready to compare'?'Complete':'Running';
  },{timeout:120_000}).not.toBe('Running');
  expect(await page.locator('#instruction').textContent()).not.toMatch(/Error|failed/i);
  await expect(page.locator('#cue')).toHaveText('Ready to compare');
  await expect(page.locator('#players audio')).toHaveCount(3);
  await expect(page.locator('#scores tr')).toHaveCount(2);
  await expect(page.getByText('Saved playback · Mixed session',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Download paired capture'})).toBeVisible();
  const evidence=await page.evaluate(async()=>{
   const a=[...document.querySelectorAll('a')].find(a=>a.download==='paired-take.json')!;
   const data=await(await fetch(a.href)).json();
   const values=(text:string)=>new Float32Array(Uint8Array.from(atob(text),c=>c.charCodeAt(0)).buffer);
   const mic=values(data.mic),left=values(data.left),right=values(data.right);
   return {frames:[mic.length,left.length,right.length],micEnergy:mic.reduce((sum,x)=>sum+x*x,0),referenceEnergy:left.reduce((sum,x)=>sum+x*x,0),playStart:data.playStart,playEnd:data.playEnd};
  });
  expect(new Set(evidence.frames).size).toBe(1);
  expect(evidence.micEnergy).toBeGreaterThan(1);
  expect(evidence.referenceEnergy).toBeGreaterThan(1);
  expect(evidence.playEnd).toBeGreaterThan(evidence.playStart);
 }
 await page.screenshot({path:info.outputPath('comparison.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:info.outputPath('mobile.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Start a take',exact:true}).click();
 await expect(page.locator('#cue')).toHaveText('Calibrate',{timeout:30_000});
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 await expect(page.locator('#cue')).toHaveText('Stopped');
 await expect(page.getByRole('button',{name:'Start a take',exact:true})).toBeEnabled();
});
