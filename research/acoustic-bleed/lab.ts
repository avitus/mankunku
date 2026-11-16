import { ALL_CURATED_LICKS } from '../../src/lib/data/licks';
import { BEGINNER_CELL_LICKS } from '../../src/lib/data/licks/beginner-cells';
import { loadInstrument, playPhrase, stopPlayback } from '../../src/lib/audio/playback';
import { getMasterGain, getNativeAudioContext } from '../../src/lib/audio/audio-context';
import { createRecorder } from '../../src/lib/audio/recorder';
import { isBackingLoaded } from '../../src/lib/audio/backing-track';
import { transposePitchClass, pitchClassInterval } from '../../src/lib/music/transposition';
import type { Phrase, PitchClass } from '../../src/lib/types/music';
import type { PlaybackOptions } from '../../src/lib/types/audio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const val = (id:string) => $<HTMLInputElement>(id).value;
const mode = $<HTMLSelectElement>('mode'), phraseSelect = $<HTMLSelectElement>('phrase');
const keys: PitchClass[] = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
keys.forEach(key=>$<HTMLSelectElement>('key').add(new Option(key,key)));
let phrases: Phrase[] = [], imported: Phrase | null = null, generation = 0, running = false;
let cleanup: (()=>Promise<void>) | null = null;
let analysisWorker: Worker | null = null;
const urls: string[] = [];
let drawPlot=()=>{};
new ResizeObserver(()=>drawPlot()).observe($('plot'));

function list() {
  phrases = imported ? [imported] : mode.value==='ear' ? BEGINNER_CELL_LICKS : ALL_CURATED_LICKS;
  phraseSelect.replaceChildren(...phrases.map(p=>new Option(p.name,p.id)));
  if(!imported&&mode.value==='lick')phraseSelect.value='blues-001';
  $('start').style.background = mode.value==='ear'?'#2e7788':'#ab5732';
}
mode.onchange=()=>{imported=null;list();}; list();
$<HTMLInputElement>('import').onchange=async event=>{
  try {
    const file=(event.target as HTMLInputElement).files?.[0]; if(!file)return;
    if(file.size>2_000_000)throw Error('Choose a phrase or diagnostic JSON smaller than 2 MB.');
    const json=JSON.parse(await file.text()), p=json.phrase??json;
    if(!p || typeof p.name!=='string' || !keys.includes(p.key) || !Array.isArray(p.notes) || !p.notes.length || p.notes.length>200)throw Error('This file does not contain a supported phrase.');
    const fraction=(f:unknown)=>Array.isArray(f)&&f.length===2&&f.every(Number.isFinite)&&f[0]>=0&&f[1]>0;
    if(p.notes.some((n:any)=>!(n.pitch===null||Number.isInteger(n.pitch)&&n.pitch>=24&&n.pitch<=108)||!fraction(n.offset)||!fraction(n.duration)))throw Error('Invalid note pitch or timing.');
    if(!Array.isArray(p.timeSignature)||p.timeSignature[0]!==4||p.timeSignature[1]!==4)throw Error('The first lab supports 4/4 phrases.');
    // Validate optional harmony before handing imported data to the real engine.
    if(p.harmony && (!Array.isArray(p.harmony)||p.harmony.some((h:any)=>!h.chord||!keys.includes(h.chord.root)||!['maj7','min7','7','min7b5','dim7','aug','maj','min','sus4','6','min6','minMaj7'].includes(h.chord.quality)||!fraction(h.startOffset)||!fraction(h.duration)||typeof h.scaleId!=='string')))throw Error('Unsupported harmony in this import.');
    imported={...p,id:'research-import'};list();$('status').textContent='Imported '+p.name;
  }catch(e){$('status').textContent=String(e);}
};

function selected(): Phrase {
  const p=phrases.find(p=>p.id===phraseSelect.value)!;
  const shift=pitchClassInterval(p.key,val('key') as PitchClass)+Number(val('octave'));
  return {...p,key:val('key') as PitchClass,notes:p.notes.map(n=>({...n,pitch:n.pitch===null?null:n.pitch+shift})),
    harmony:p.harmony?.map(h=>({...h,chord:{...h.chord,root:transposePitchClass(h.chord.root,shift)}}))};
}
function phase(cue:string,instruction:string){$('cue').textContent=cue;$('instruction').textContent=instruction;$('status').textContent=cue;}
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function encode(x:Float32Array){const b=new Uint8Array(x.buffer,x.byteOffset,x.byteLength);let s='';for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s);}
function decode(s:string){const b=Uint8Array.from(atob(s),c=>c.charCodeAt(0));return new Float32Array(b.buffer);}
function wav(samples:Float32Array,sr:number){
  const b=new ArrayBuffer(44+samples.length*2),v=new DataView(b);
  const str=(at:number,s:string)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,b.byteLength-8,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);
  samples.forEach((x,i)=>v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,x))*32767),true));return new Blob([b],{type:'audio/wav'});
}
function link(blob:Blob,name:string,label:string,parent:HTMLElement){const url=URL.createObjectURL(blob);urls.push(url);const a=document.createElement('a');a.href=url;a.download=name;a.textContent=label;parent.append(a);return url;}
function player(title:string,blob:Blob,name:string){const label=document.createElement('label');label.textContent=title;const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=link(blob,name,'Download '+title,$('downloads'));audio.onplay=()=>document.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause();});label.append(audio);$('players').append(label);}

$('stop').onclick=async()=>{
  document.querySelectorAll('audio').forEach(audio=>audio.pause());
  generation++; analysisWorker?.terminate(); analysisWorker=null;
  await stopPlayback();await cleanup?.();cleanup=null;running=false;
  $<HTMLFieldSetElement>('setup').disabled=false;$<HTMLButtonElement>('start').disabled=false;$<HTMLButtonElement>('stop').disabled=true;
  phase('Stopped','Start a new take when you are ready.');
};
window.addEventListener('pagehide',()=>{generation++;void stopPlayback();void cleanup?.();analysisWorker?.terminate();});

$('start').onclick=async()=>{
  if(running)return;
  document.querySelectorAll('audio').forEach(audio=>audio.pause());
  const take=++generation; running=true;
  const active=()=>{if(take!==generation)throw Error('Take cancelled');};
  const phrase=selected(),tempo=Number(val('tempo')),swing=Number(val('swing')),choice=val('accompaniment');
  const duration=Math.max(...phrase.notes.map(n=>4*(n.offset[0]/n.offset[1]+n.duration[0]/n.duration[1])))*60/tempo;
  if(!Number.isFinite(tempo)||tempo<60||tempo>240||duration>30||phrase.timeSignature[0]!==4||phrase.timeSignature[1]!==4){running=false;phase('Choose a shorter phrase','Use a 4/4 phrase lasting no more than 30 seconds, at 60–240 BPM.');return;}
  const options:PlaybackOptions={tempo,swing,countInBeats:4,metronomeEnabled:choice!=='backing',metronomeVolume:Number(val('volume')),
    backingTrackEnabled:choice!=='metro',backingTrackVolume:Number(val('volume')),backingInstrument:'piano',backingStyle:'swing'};
  $<HTMLFieldSetElement>('setup').disabled=true;$<HTMLButtonElement>('start').disabled=true;$<HTMLButtonElement>('stop').disabled=false;
  let stream:MediaStream|null=null,source:MediaStreamAudioSourceNode|null=null,node:AudioWorkletNode|null=null,recorder:ReturnType<typeof createRecorder>|null=null,master:GainNode|null=null;
  let stopRecord:Promise<any>|null=null,controller=new AbortController();
  cleanup=async()=>{controller.abort();node?.disconnect();try{master?.disconnect(node!);}catch{}source?.disconnect();stream?.getTracks().forEach(t=>t.stop());if(recorder){stopRecord??=recorder.stop();await stopRecord;recorder.dispose();recorder=null;}node?.port.close();};
  try{
    phase('Preparing','Loading the app’s instruments. Your microphone opens only for this take.');
    await loadInstrument('tenor-sax',.75,choice!=='metro'?'piano':undefined);active();
    if(choice!=='metro'&&!isBackingLoaded())throw Error('Backing samples could not load. Try again or select Metronome.');
    const ctx=await getNativeAudioContext();
    // Tone uses standardized-audio-context wrappers. A native AudioWorklet
    // needs the native master node, on exactly the same native clock.
    const wrapped=getMasterGain() as GainNode & {_nativeAudioNode?:GainNode};
    master=wrapped._nativeAudioNode??wrapped;
    if(master.context!==ctx)throw Error('The output reference is not on the microphone audio clock.');
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    if(take!==generation){stream.getTracks().forEach(t=>t.stop());active();}
    const trackSettings=stream.getAudioTracks()[0].getSettings();
    if(trackSettings.echoCancellation||trackSettings.noiseSuppression||trackSettings.autoGainControl)throw Error('The device is applying microphone processing. Select an unprocessed input for this experiment.');
    await ctx.audioWorklet.addModule(new URL('./capture-worklet.js',import.meta.url));active();
    source=ctx.createMediaStreamSource(stream);
    node=new AudioWorkletNode(ctx,'paired-research-capture',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[1],channelCount:2,channelCountMode:'explicit'});
    source.connect(node,0,0);master.connect(node,0,1);node.connect(ctx.destination);
    let resolveCapture:(value:any)=>void=()=>{},rejectCapture:(error:Error)=>void=()=>{};
    const capture=new Promise<any>((resolve,reject)=>{resolveCapture=resolve;rejectCapture=reject;});
    // Attach a rejection handler immediately; an early worklet error remains handled.
    void capture.catch(()=>{});
    node.port.onmessage=({data})=>data.error?rejectCapture(Error(data.error)):resolveCapture(data);
    node.onprocessorerror=()=>rejectCapture(Error('Audio capture failed'));
    recorder=createRecorder(source,master,ctx);recorder.start();node.port.postMessage('start');
    const calibration:Phrase={...phrase,notes:[],harmony:[{...(phrase.harmony?.[0]??{chord:{root:phrase.key,quality:'7'},scaleId:'mixolydian'}),startOffset:[0,1],duration:[4,1]}]};
    phase('Calibrate','Stay silent while the band plays. Keep the microphone and speakers still.');
    await playPhrase(calibration,options,false,{skipMelody:true,countIn:{bars:0,drums:false}});active();
    const calibrationEndAbs=ctx.currentTime;
    await pause(400);active();
    phase('Listen',mode.value==='ear'?'Remember the phrase. Your turn follows the count-in.':'Hear the lick. Play the same phrase after the count-in.');
    await playPhrase(phrase,options,false,{countIn:{bars:1,drums:false}});active();await pause(400);active();
    phase('Count in','Enter on the Play cue.');
    const Tone=await import('tone');let playStartAbs=0;
    await playPhrase(phrase,options,false,{skipMelody:true,countIn:{bars:1,drums:false},onStarted:()=>{
      Tone.getTransport().scheduleOnce(time=>{playStartAbs=time;Tone.getDraw().schedule(()=>{if(take===generation)phase('Play','Play the phrase.');},time);},`${4*Tone.getTransport().PPQ}i`);
    }});active();
    const playEndAbs=ctx.currentTime+.15;
    phase('Stay quiet','Final room measurement. Let the band play without you.');await pause(400);active();
    const tailStartAbs=ctx.currentTime;
    await playPhrase(calibration,options,false,{skipMelody:true,countIn:{bars:0,drums:false}});active();
    node.port.postMessage('stop');stopRecord=recorder.stop();
    const paired=await Promise.race([capture,new Promise((_,reject)=>setTimeout(()=>reject(Error('Capture did not finish')),3000))]);active();
    const mixed=await stopRecord;const mixedBlob=mixed instanceof Blob?mixed:mixed.blob;
    stream.getTracks().forEach(t=>t.stop());source.disconnect();node.disconnect();master.disconnect(node);
    const start=paired.start/paired.sampleRate,sr=paired.sampleRate,[mic,left,right]=paired.channels as Float32Array[];
    if(!playStartAbs)throw Error('The play window was not captured. Try another take.');
    const payload={sampleRate:sr,mic:encode(mic),left:encode(left),right:encode(right),calibrationEnd:calibrationEndAbs-start,tailStart:tailStartAbs-start};
    const windowStart=Math.max(0,playStartAbs-start),windowEnd=playEndAbs-start;
    phase('Comparing','Estimating the room response in the local Linux sandbox.');
    // Publish raw downloads before cleanup so a failed cancellation never loses a take.
    urls.splice(0).forEach(URL.revokeObjectURL);$('players').replaceChildren();$('downloads').replaceChildren();$('scores').replaceChildren();$('notes').textContent='';$('metrics').textContent='';$('comparison').hidden=false;
    const clip=(x:Float32Array)=>x.slice(Math.round(windowStart*sr),Math.round(windowEnd*sr));
    player('Original microphone',wav(clip(mic),sr),'original-microphone.wav');
    player('Saved playback · Mixed session',mixedBlob,'mixed-session.'+(mixedBlob.type.includes('mp4')?'m4a':'webm'));
    const metadata={version:1,phrase,mode:mode.value,tempo,swing,options,trackSettings,sampleRate:sr,playStart:windowStart,playEnd:windowEnd,
      calibrationEnd:payload.calibrationEnd,tailStart:payload.tailStart,baseLatency:ctx.baseLatency,outputLatency:ctx.outputLatency,
      timestamp:new Date().toISOString(),captureStartFrame:paired.start};
    link(new Blob([JSON.stringify({...metadata,...payload})],{type:'application/json'}),'paired-take.json','Download paired capture',$('downloads'));
    $('verdict').textContent='Original audio is saved here. Cleaning is running.';
    const response=await fetch('/api/clean',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
    if(!response.ok)throw Error('Cleaning failed. Your original and paired capture remain available below.');
    const result=await response.json();active();const cleaned=decode(result.cleaned);
    if(cleaned.length!==mic.length)throw Error('Cleaned audio has a mismatched length.');
    player('Cleaned microphone',wav(clip(cleaned),sr),'cleaned-microphone.wav');
    $('players').insertBefore($('players').lastElementChild!,$('players').children[1]);
    $('verdict').textContent=result.metrics.accepted?'Experimental cleaning applied. Compare the note attacks and rhythm before trusting a score change.':'Calibration was not reliable enough. Cleaned audio is the unchanged original.';
    $('metrics').textContent=JSON.stringify(result.metrics,null,2);
    analysisWorker=new Worker(new URL('./analyze-worker.ts',import.meta.url),{type:'module'});
    const analysis=await new Promise<any>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Analysis timed out; audio downloads remain available.')),90_000);
      analysisWorker!.onmessage=({data})=>{clearTimeout(timeout);data.error?reject(Error(data.error)):resolve(data.results);};
      analysisWorker!.onerror=e=>{clearTimeout(timeout);reject(Error(e.message));};
      analysisWorker!.postMessage({original:mic,cleaned,sampleRate:sr,start:windowStart,end:windowEnd,phrase,tempo,swing});
    });active();analysisWorker.terminate();analysisWorker=null;
    analysis.forEach((r:any,i:number)=>{const tr=document.createElement('tr');for(const value of [i?'Cleaned':'Original',`${(r.score.pitchAccuracy*100).toFixed(1)}%`,`${(r.score.rhythmAccuracy*100).toFixed(1)}%`,r.detected.length,`${r.score.timing.latencyCorrectionMs.toFixed(1)} ms`]){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}$('scores').append(tr);});
    $('notes').textContent=JSON.stringify(analysis.map((r:any,i:number)=>({version:i?'cleaned':'original',notes:r.detected})),null,2);
    drawPlot=()=>{
      const canvas=$<HTMLCanvasElement>('plot'),draw=canvas.getContext('2d')!,width=canvas.clientWidth,dpr=devicePixelRatio||1;
      canvas.width=Math.round(width*dpr);canvas.height=240*dpr;draw.scale(dpr,dpr);
      const all=analysis.flatMap((r:any)=>r.readings.map((p:any)=>p.midi)),lo=Math.floor(Math.min(48,...all)-2),hi=Math.ceil(Math.max(72,...all)+2);
      draw.font='12px system-ui';draw.fillStyle='#a3aebc';draw.fillText('Concert MIDI pitch',12,20);
      for(let midi=Math.ceil(lo/6)*6;midi<hi;midi+=6){const y=210-(midi-lo)/(hi-lo)*170;draw.fillStyle='#a3aebc';draw.fillText(String(midi),8,y+4);draw.fillStyle='#ffffff12';draw.fillRect(35,y,width-45,1);}
      for(let i=0;i<=4;i++){draw.fillStyle='#a3aebc';draw.fillText(((windowEnd-windowStart)*i/4).toFixed(1)+'s',35+i*(width-70)/4,231);}
      analysis.forEach((r:any,i:number)=>{draw.fillStyle=i?'#83bdc8':'#94a3b8';for(const p of r.readings)draw.fillRect(35+p.time/(windowEnd-windowStart)*(width-50),210-(p.midi-lo)/(hi-lo)*170,2,i?3:5);});
    };drawPlot();
    link(new Blob([JSON.stringify({metadata,metrics:result.metrics,analysis},null,2)],{type:'application/json'}),'analysis.json','Download analysis',$('downloads'));
    phase('Ready to compare','Listen to both microphone versions. Saved playback stays mixed.');
  }catch(e){if(take===generation){phase('Take needs attention',String(e));$('status').textContent='Stopped with an error';}}
  finally{if(take===generation){await stopPlayback();await cleanup?.();cleanup=null;running=false;$<HTMLFieldSetElement>('setup').disabled=false;$<HTMLButtonElement>('start').disabled=false;$<HTMLButtonElement>('stop').disabled=true;analysisWorker?.terminate();analysisWorker=null;}}
};
// The shared sandbox fixture waits for installed event handlers before clicking.
document.documentElement.dataset.hydrated='true';
