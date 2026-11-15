<script lang="ts">
 import {onMount,onDestroy,untrack} from 'svelte';
 import StudioPage from '$lib/components/console/StudioPage.svelte';
 import NotationDisplay from '$lib/components/notation/NotationDisplay.svelte';
 import {settings,getInstrument,getEffectiveHighestNote} from '$lib/state/settings.svelte';
 import {createLickAudition} from '$lib/state/lick-audition.svelte';
 import {leadSheetTuneFor,leadSheetAbcOptions} from '$lib/music/lead-sheet';
 import {BROWSER_PROGRESSIONS,searchProgression} from '$lib/lickbrowser/progressions';
 import type {ChordProgressionType} from '$lib/types/lick-practice';
 import {excerptPhrases} from '$lib/lickbrowser/phrase';
 import type {Phrase} from '$lib/types/music';
 import {getUserLicksLocal} from '$lib/persistence/user-licks';
 import {whenHydrated} from '$lib/state/hydration';
 import {excerptReference,stealExcerpt} from '$lib/lickbrowser/steal';
 import type {Solo,Excerpt} from '$lib/lickbrowser/types';
 let corpus: Solo[]=$state.raw([]),results: Excerpt[]=$state.raw([]);
 let progression: ChordProgressionType=$state('ii-V-I-major-long');
 let artist=$state(''),error=$state(''),loading=$state(true),limit=$state(10),speed=$state(1);
 const audition=createLickAudition();
 const artists=$derived([...new Set(corpus.map(s=>s.performer))].sort());
 const displayed=$derived(results.slice(0,limit).map(r=>({r,...excerptPhrases(r,getInstrument(),getEffectiveHighestNote())})));
 $effect(()=>{void settings.instrumentId;void settings.highestNote;void speed;untrack(()=>audition.stop());});
 let personalLicks: Phrase[]=$state([]);
 /** Steal checks the local book for an earlier copy, so it waits for cloud
  * hydration to land on this device. A failed hydration settles too (the
  * layout swallows it) and Steal then runs on local state, as every route does. */
 let licksReady=$state(false);
 let stolen: Phrase | null=$state(null);
 /** Saves an excerpt to the player's own licks and refreshes the personal list. */
 function steal(score: Phrase, excerpt: Excerpt){
  if(!licksReady)return;
  error='';stolen=null;
  try{stolen=stealExcerpt(score,excerpt);personalLicks=getUserLicksLocal();}
  catch(e){error=e instanceof Error?e.message:'The lick could not be saved. Please try again.';}
 }
 /** Searches the corpus for the chosen progression and artist, resetting the page size. */
 function run(){audition.stop();error='';limit=10;try{results=searchProgression(corpus,progression,{artist,transpose:true});}catch(e){results=[];error=e instanceof Error?e.message:'Search failed.';}}
 onMount(()=>{personalLicks=getUserLicksLocal();let live=true;whenHydrated().then(()=>{if(!live)return;personalLicks=getUserLicksLocal();licksReady=true;});const controller=new AbortController();fetch('/data/weimar-licks.json',{signal:controller.signal}).then(async response=>{if(!response.ok)throw Error('The Weimar collection could not load. Reload to try again.');corpus=await response.json();run();}).catch(e=>{if(!controller.signal.aborted)error=e.message;}).finally(()=>loading=false);return ()=>{live=false;controller.abort();};});
 onDestroy(()=>audition.dispose());
</script>
<svelte:head><title>Lick Browser — Mankunku</title></svelte:head>
<StudioPage eyebrow="Weimar collection" title="Lick browser" description="Find recorded solo phrases over your chord changes.">
 <form onsubmit={(e)=>{e.preventDefault();run();}}>
  <label for="progression">Progression</label>
  <div class="search"><select id="progression" bind:value={progression} onchange={run}>{#each BROWSER_PROGRESSIONS as item}<option value={item.type}>{item.name}</option>{/each}</select><button disabled={loading}>Find licks</button></div>
  <div class="options"><label>Artist <select bind:value={artist}><option value="">All artists</option>{#each artists as name}<option>{name}</option>{/each}</select></label><label>Playback speed <select bind:value={speed}><option value={1}>Original</option><option value={0.75}>75%</option><option value={0.5}>50%</option></select></label></div>
  <p>Matches use chord families. Each phrase starts over the first chord and lands in the first bar of the final chord. Notation and sound follow your <a href="/settings">instrument settings</a>.</p>
 </form>
 {#if error || audition.state.error}<p role="alert">{error || audition.state.error}</p>{/if}
 <p role="status">{#if stolen}Added to your licks. <a href={`/licks/${stolen.id}`}>View lick</a>{/if}</p>
 <p role="status">{loading?'Loading collection…':`${results.length} matching excerpts`}</p>
 {#each displayed as {r,score,performance} (r.id)}
  <article><h2>{r.performer} — {r.title}</h2><p>Bar {r.bar}, beat {r.beat} · {Math.round(r.tempo)} BPM · {getInstrument().name}</p>
   <NotationDisplay tune={leadSheetTuneFor(score,Infinity).tune} tuneOptions={{...leadSheetAbcOptions(score,4),omitMasthead:true}} instrument={getInstrument()} variant="practice" frameless staffWidth={750}/>
   <button onclick={()=>audition.play(performance,{tempo:r.tempo*speed,swing:0.5})}>{audition.state.playingId===performance.id?'Stop':'Listen'}</button> <button disabled={!licksReady||personalLicks.some(lick=>lick.tags.includes(excerptReference(r)))} onclick={()=>steal(score,r)}>{personalLicks.some(lick=>lick.tags.includes(excerptReference(r)))?'Stolen':'Steal'}</button>
   <div class="lick-reference" title="Weimar solo ID and starting chord-change index">Ref: WJD {r.id}</div>
  </article>
 {/each}
 {#if !loading&&!error&&!results.length}<p>No matching phrases. Try another progression or all artists.</p>{/if}
 {#if results.length>limit}<button onclick={()=>limit+=10}>Show more</button>{/if}
 <footer>Transcriptions: <a href="https://jazzomat.hfm-weimar.de/">Weimar Jazz Database</a>, release 2.1. Pfleiderer et al., Inside the Jazzomat (2017). <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL 1.0</a> / DbCL 1.0. Written rhythms are inferred; playback retains performed timing.</footer>
</StudioPage>
<style>
 .lick-reference{margin-top:12px;text-align:right;font-size:12px;font-family:monospace;color:var(--color-text-secondary,#a3aebc);user-select:all}
 form,article{padding:24px;margin:20px 0;border:1px solid var(--color-border,#536174);border-radius:6px}label{display:block}select,button{border:1px solid #536174;border-radius:4px;padding:10px;background:transparent;color:inherit}button{cursor:pointer;min-height:44px}button:disabled{opacity:.5}.search{display:flex;gap:12px;margin:12px 0}.search select{flex:1;min-width:0}.options{display:flex;gap:20px;flex-wrap:wrap;align-items:center}p,footer{font-size:13px;opacity:.85}h2{font-family:var(--font-display,Georgia);font-size:24px}footer{margin:32px 0}a{text-decoration:underline}@media(max-width:600px){form,article{padding:16px}.options{display:grid}}
</style>
