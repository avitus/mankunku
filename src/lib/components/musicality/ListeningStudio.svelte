<script lang="ts">
 import { onDestroy } from 'svelte';
 import { LISTENING_TUNES, buildListeningTuneSession, type ListeningTuneSession } from '$lib/musicality/listening-tunes';
 import { createListeningPlayer, type ListeningSnapshot } from '$lib/musicality/listening-player';
 import { describeMusicianDecisions } from '$lib/musicality/musician-decisions';
 import { getBackingMix } from '$lib/audio/backing-track';
 import { settings } from '$lib/state/settings.svelte';
 import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
 import type { BackingStyle } from '$lib/types/instruments';
 let { buildVersion }: { buildVersion: string } = $props();
 const defaultTune = LISTENING_TUNES.find(tune=>tune.title==='Mankunku Blues') ?? LISTENING_TUNES[0];
 let tuneId = $state(defaultTune.id);
 let key = $state<PitchClass>(defaultTune.key);
 let style = $state<BackingStyle>(settings.backingStyle);
 let tempo = $state(140);
 let solos = $state(2);
 let mode = $state<'original' | 'coordinated'>('coordinated');
 const styles: {value:BackingStyle;label:string;character:string}[] = [
  {value:'swing',label:'Swing',character:'Walking bass, swung phrasing and ride-led time.'},
  {value:'straight',label:'Straight',character:'Even eighths with a clear bass pulse.'},
  {value:'bossa-nova',label:'Bossa nova',character:'Clave, even eighths and root–fifth bass.'},
  {value:'ballad',label:'Ballad',character:'Sustained chords, two-feel bass and a quieter kit.'}
 ];
 const session = $derived(buildListeningTuneSession({tuneId,key,soloChoruses:solos}));
 let snapshot = $state<ListeningSnapshot>({status:'idle',generated:null,params:null,ppq:192,startAudioTime:null,audioTime:null,elapsedBeats:0,durationBeats:0,barIndex:null,ending:false,error:null});
 const player = createListeningPlayer({onChange: next => snapshot = next});
 let takeSession = $state<ListeningTuneSession | null>(null);
 let marks = $state<{barIndex:number;elapsedBeats:number;note:string}[]>([]);
 let note = $state('');
 const busy = $derived(snapshot.status === 'playing' || snapshot.status === 'loading');
 const shownSession = $derived(takeSession ?? session);
 const bar = $derived(snapshot.barIndex === null ? null : shownSession.bars[snapshot.barIndex]);
 const chorus = $derived(shownSession.phrase.performanceForm.choruses[bar?.context.chorusIndex ?? 0]);
 const shownBars = $derived(shownSession.bars.slice(chorus.startBar,chorus.endBarExclusive));
 const decisions = $derived(snapshot.generated && snapshot.barIndex !== null ? describeMusicianDecisions(snapshot.generated,{barIndex:snapshot.barIndex,ppq:snapshot.ppq,beatsPerBar:4,style:snapshot.params?.style ?? style,orchestration:snapshot.params?.orchestration ?? mode}) : []);
 const position = $derived(bar ? `${passName(bar.context.chorusIndex)} · ${bar.sectionLabel} · Bar ${bar.context.barInChorus+1} of ${bar.context.barsInChorus}` : 'Ready to listen');
 function passName(index:number):string { return index === 0 ? 'Head in' : index === shownSession.phrase.performanceForm.choruses.length-1 ? 'Head out' : `Solo ${index}`; }
 function clearTake() { player.stop();snapshot={...player.snapshot(),status:'idle',generated:null,params:null,barIndex:null,startAudioTime:null};takeSession=null;marks=[];note=''; }
 function changeTune() { key=LISTENING_TUNES.find(t=>t.id===tuneId)!.key;clearTake(); }
 async function play() {
  if(!Number.isFinite(tempo) || tempo < 40 || tempo > 240) return;
  const captured=structuredClone(session);takeSession=captured;marks=[];note='';
  await player.start({phrase:captured.phrase,style,tempo,swing:settings.swing,instrument:'piano',volume:settings.backingTrackVolume,mix:{...getBackingMix()},orchestration:mode});
 }
 function mark() { if(snapshot.barIndex !== null) {marks=[...marks,{barIndex:snapshot.barIndex,elapsedBeats:snapshot.elapsedBeats,note:note.trim()}];note='';} }
 function exportTake() {
  if(!snapshot.generated || !takeSession) return;
  const content={version:1,buildVersion,session:{tuneId:takeSession.tune.id,headBars:takeSession.headBars,chorusBars:takeSession.chorusBars,soloChoruses:takeSession.soloChoruses,bars:takeSession.bars},playback:snapshot,decisions,marks};
  const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`musicality-${takeSession.tune.id}-${snapshot.params?.orchestration}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 onDestroy(()=>player.dispose());
</script>

<section class="setup" aria-label="Listening setup">
 <label class="tune">Tune<select data-testid="listening-tune" bind:value={tuneId} onchange={changeTune} disabled={busy}>{#each LISTENING_TUNES as tune}<option value={tune.id}>{tune.title}</option>{/each}</select></label>
 <label>Style<select data-testid="listening-style" bind:value={style} onchange={clearTake} disabled={busy}>{#each styles as item}<option value={item.value}>{item.label}</option>{/each}</select></label>
 <label>Key<select data-testid="listening-key" bind:value={key} onchange={clearTake} disabled={busy}>{#each PITCH_CLASSES as pitch}<option value={pitch}>{pitch.replace('b','♭').replace('#','♯')}</option>{/each}</select></label>
 <label>Tempo<input data-testid="listening-tempo" type="number" min="40" max="240" step="1" bind:value={tempo} onchange={clearTake} disabled={busy} /></label>
 <label>Solo choruses<select data-testid="listening-choruses" bind:value={solos} onchange={clearTake} disabled={busy}>{#each [1,2,3,4] as count}<option value={count}>{count}</option>{/each}</select></label>
</section>
<section class="transport" aria-label="Playback">
 <div class="transport-main">
  {#if busy}<button class="play" data-testid="listening-stop" onclick={()=>player.stop()}>■ Stop</button>{:else}<button class="play" data-testid="listening-play" onclick={play} disabled={!Number.isFinite(tempo)||tempo<40||tempo>240}>▶ Listen</button>{/if}
  <div><strong data-testid="listening-status" role="status">{snapshot.status === 'loading' ? 'Loading the band…' : snapshot.status === 'playing' ? snapshot.ending ? 'Letting the last chord ring' : 'Playing' : snapshot.status === 'completed' ? 'Take complete' : snapshot.status === 'stopped' ? 'Stopped' : snapshot.status === 'error' ? 'Unable to play' : 'Ready to listen'}</strong><small>Head in → {solos} solo {solos===1?'chorus':'choruses'} → Head out · {session.bars.length} bars</small></div>
 </div>
 <label class="mode">Arrangement<select data-testid="listening-mode" bind:value={mode} onchange={clearTake} disabled={busy}><option value="original">Original</option><option value="coordinated">Coordinated</option></select></label>
</section>
{#if snapshot.error}<p role="alert" class="error">{snapshot.error}</p>{/if}
<p class="style-note">{styles.find(s=>s.value===style)?.character} <span>Rhythm section only — play the melody yourself.</span></p>
<section class="chart" aria-label="Tune form">
 <div class="section-head"><span class="eyebrow">The form</span><span data-testid="listening-position" data-bar-index={snapshot.barIndex ?? ''} data-start-audio-time={snapshot.startAudioTime ?? ''}>{position}</span></div>
 <div class="form-strip" aria-label="Complete performance">{#each shownSession.phrase.performanceForm.choruses as pass}<div class:current={bar?.context.chorusIndex===pass.index} style:flex-grow={pass.endBarExclusive-pass.startBar}><span>{passName(pass.index)}</span><small>{pass.endBarExclusive-pass.startBar} bars</small></div>{/each}</div>
 <div class="chords">{#each shownBars as chord}<div class:current={bar?.barIndex===chord.barIndex} aria-current={bar?.barIndex===chord.barIndex?'true':undefined}><small>{chord.context.barInChorus+1}</small><strong>{chord.chordSymbols.join(' / ') || '—'}</strong></div>{/each}</div>
</section>
<section class="players" aria-labelledby="players-title">
 <div class="section-head"><h2 id="players-title">Inside the band</h2><span>{snapshot.status==='playing'&&!snapshot.ending&&bar ? '● Live · Current sounding bar' : snapshot.generated ? 'Last sounding bar' : 'The decisions appear as the tune plays.'}</span></div>
 <div class="musicians">{#each ['bass','piano','drums'] as name,i}{@const decision=decisions.find(d=>d.instrument===name)}<article data-testid={`musician-${name}`} data-bar-index={snapshot.barIndex ?? ''}><div class="player-title"><span>0{i+1}</span><h3>{name==='bass'?'Bass':name==='piano'?'Piano':'Drums'}</h3><small>{decision?.role ?? 'Ready'}</small></div><h4>{decision?.action ?? 'Waiting for the first bar'}</h4><p>{decision?.detail ?? 'Actual scheduled events and phrase decisions will appear here.'}</p>{#if decision}<details class="evidence"><summary>{decision.eventCount} scheduled {decision.eventCount===1?'event':'events'} · Details</summary><ul>{#each decision.evidence as evidence}<li>{evidence}</li>{/each}</ul></details>{:else}<div class="waiting">No audio playing</div>{/if}</article>{/each}</div>
</section>
<details class="take-notes"><summary>Listening notes & take export <span>+</span></summary><div class="notes-body"><p>Mark a moment worth revisiting. Export preserves this take’s settings, scheduled notes and decision evidence.</p><div class="note-controls"><input aria-label="Listening note" bind:value={note} maxlength="500" placeholder="What did you hear?" /><button onclick={mark} disabled={snapshot.barIndex===null}>Mark this bar</button><button data-testid="listening-export" onclick={exportTake} disabled={!snapshot.generated}>Export take</button></div>{#if marks.length}<ul>{#each marks as item}<li>Bar {item.barIndex+1} · {item.note || 'Marked moment'}</li>{/each}</ul>{/if}</div></details>
<footer><span>Same tune, key and tempo. Two arrangements. Your ears decide.</span><a href="/docs/architecture/musicality">Architecture & roadmap ↗</a></footer>

<style>
 .setup{display:grid;grid-template-columns:2.4fr 1.35fr .75fr .8fr 1.1fr;gap:1.1rem;padding:1.75rem 0 1.5rem}
 label{font-size:.58rem;letter-spacing:.08em;text-transform:uppercase;color:var(--color-text-secondary)}
 select,input{width:100%;margin-top:.6rem;padding:.6rem 0;background:transparent;color:var(--color-text);border:0;border-bottom:1px solid var(--color-bg-tertiary);font:inherit;font-size:.88rem;letter-spacing:normal;text-transform:none;border-radius:0}
 option{background:var(--color-bg-secondary);color:var(--color-text)}
 button:disabled,select:disabled,input:disabled{opacity:.55;cursor:default}
 .transport{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;border:1px solid var(--color-bg-tertiary);background:var(--color-bg-secondary);padding:1.25rem;gap:1rem}
 .transport-main{display:flex;align-items:center;gap:1.3rem}.play{background:var(--color-brass);color:var(--color-bg);padding:.9rem 1.5rem;min-width:7rem;font-size:.85rem;font-weight:600}
 .transport strong{font-weight:500;font-size:.9rem}.transport small{display:block;color:var(--color-text-secondary);font-size:.65rem;margin-top:.4rem}.mode{display:flex;align-items:center;gap:1rem}.mode select{margin:0;min-width:8.8rem;border:1px solid var(--color-brass);color:var(--color-brass);padding:.6rem}
 .style-note{font-size:.68rem;line-height:1.7;color:var(--color-text-secondary);margin:.7rem 0 0}.style-note span{margin-left:.5rem}.error{color:var(--color-error);font-size:.8rem;margin-top:1rem}
 .section-head{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:1rem}.eyebrow{font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--color-brass)}.section-head>span:last-child{font-size:.65rem;color:var(--color-text-secondary);text-align:right}
 .chart{padding:1.6rem 0}.form-strip{display:flex;gap:.25rem;margin-bottom:.7rem}.form-strip>div{flex-basis:0;border-top:2px solid var(--color-bg-tertiary);padding:.5rem .3rem;color:var(--color-text-secondary)}.form-strip>div.current{border-color:var(--color-brass);color:var(--color-brass)}.form-strip span{font-size:.65rem}.form-strip small{display:block;font-size:.55rem;margin-top:.2rem}
 .chords{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));border-top:1px solid var(--color-bg-tertiary);border-left:1px solid var(--color-bg-tertiary)}.chords>div{padding:.6rem;border-right:1px solid var(--color-bg-tertiary);border-bottom:1px solid var(--color-bg-tertiary);min-height:4.6rem}.chords small{font-size:.55rem;color:var(--color-text-secondary);display:block}.chords strong{font-family:var(--font-display,Georgia,serif);font-size:1.1rem;font-weight:400;display:block;margin-top:.7rem;overflow-wrap:anywhere}.chords .current{background:color-mix(in srgb,var(--color-brass) 15%,transparent);box-shadow:inset 0 -2px var(--color-brass)}
 h2{font-family:var(--font-display,Georgia,serif);font-size:1.6rem;font-weight:400;margin:.5rem 0}.musicians{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--color-bg-tertiary);border-bottom:1px solid var(--color-bg-tertiary)}.musicians article{padding:1.5rem 1.3rem 1.3rem 0}.musicians article+article{padding-left:1.5rem;border-left:1px solid var(--color-bg-tertiary)}.player-title{display:flex;align-items:center;gap:.6rem}.player-title>span{font-size:.55rem;color:var(--color-brass)}h3{font-family:var(--font-display,Georgia,serif);font-size:1.4rem;font-weight:400;margin:0}.player-title small{margin-left:auto;color:var(--color-text-secondary);font-size:.6rem}.musicians h4{font-size:.85rem;font-weight:400;margin:1.5rem 0 .75rem}.musicians p{font-size:.75rem;line-height:1.8;color:var(--color-text-secondary);min-height:3rem}.evidence,.waiting{font-size:.6rem;color:var(--color-brass);margin-top:1.5rem;line-height:1.7}.evidence ul{padding-left:1rem;margin-top:.6rem;color:var(--color-text-secondary)}.waiting{text-transform:uppercase;letter-spacing:.08em}
 .take-notes{padding:1.4rem 0;border-bottom:1px solid var(--color-bg-tertiary);font-size:.75rem;color:var(--color-text-secondary)}summary{cursor:pointer}.take-notes>summary{list-style:none}.take-notes>summary span{float:right}.notes-body{padding-top:1rem}.notes-body p{line-height:1.7}.note-controls{display:flex;gap:1rem;align-items:center}.note-controls input{flex:1;min-width:0}.note-controls button{color:var(--color-brass);border:1px solid var(--color-bg-tertiary);padding:.65rem;white-space:nowrap}.notes-body ul{padding:1rem 0 0 1rem;line-height:1.8}
 footer{display:flex;justify-content:space-between;gap:1rem;padding-top:1.4rem;color:var(--color-text-secondary);font-size:.65rem}a{color:inherit}button{cursor:pointer}button:focus-visible,a:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--color-brass);outline-offset:4px}
 @media(max-width:700px){.setup{grid-template-columns:repeat(2,minmax(0,1fr))}.tune{grid-column:1/-1}.transport{align-items:start;gap:1.2rem;flex-direction:column}.mode{width:100%;justify-content:space-between}.mode select{width:auto}.chords{grid-template-columns:repeat(4,minmax(0,1fr))}.musicians{grid-template-columns:1fr}.musicians article+article{padding-left:0;border-left:0;border-top:1px solid var(--color-bg-tertiary)}.style-note span{display:block;margin-left:0}footer{line-height:1.6}.section-head>span:last-child{max-width:55%}.note-controls{flex-wrap:wrap}.note-controls input{flex-basis:100%}}
</style>
