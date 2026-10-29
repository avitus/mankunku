<script lang="ts">
 import { onDestroy, onMount, untrack } from 'svelte';
 import ListeningScore from './ListeningScore.svelte';
 import ListeningArc from './ListeningArc.svelte';
 import { CURRENT_MUSICALITY_RELEASE } from '$lib/musicality/release';
 import { createListeningFeedback, readListeningFeedback, saveListeningFeedback, serializeListeningFeedback, type ListeningFeedback } from '$lib/musicality/listening-feedback';
 import { page } from '$app/state';
 import { LISTENING_TUNES, assessCuratedListeningTune, assessListeningTune, type ListeningTuneSession } from '$lib/musicality/listening-tunes';
 import { createListeningPlayer, type ListeningSnapshot } from '$lib/musicality/listening-player';
 import { describeMusicianDecisions, describePerformanceArc } from '$lib/musicality/musician-decisions';
 import { getListeningReviewExtent, selectListeningReviewBar } from '$lib/musicality/listening-review';
 import { createListeningLibrary, type ListeningLibrarySnapshot } from '$lib/musicality/listening-library';
 import { getAllTunes, isCuratedTuneId } from '$lib/tunes/book-loader';
 import { getLastUserId, getScopeGeneration } from '$lib/persistence/user-scope';
 import { awaitHydration } from '$lib/state/hydration';
 import type { Tune } from '$lib/types/tune';
 import { getBackingMix } from '$lib/audio/backing-track';
 import { BACKING_STYLES } from '$lib/audio/backing-styles';
 import { assessTerminalArrangement } from '$lib/audio/backing-terminal';
 import { settings } from '$lib/state/settings.svelte';
 import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
 import type { BackingStyle } from '$lib/types/instruments';
 let { buildVersion, oncompare }: { buildVersion: string; oncompare: () => void } = $props();
 const defaultTune = LISTENING_TUNES.find(tune=>tune.title==='Mankunku Blues') ?? LISTENING_TUNES[0];
 let tuneId = $state(defaultTune.id);
 let key = $state<PitchClass>(defaultTune.key);
 let style = $state<BackingStyle>(settings.backingStyle);
 let tempo = $state(140);
 let solos = $state(2);
 let mode = $state<'original' | 'coordinated'>('coordinated');
 let ending = $state<'continue' | 'hold-release'>('continue');
 const endingSupported = $derived(mode === 'coordinated' && (style === 'swing' || style === 'straight' || style === 'ballad' || style === 'bossa-nova'));
 const styles: {value:BackingStyle;label:string;character:string}[] = [
  {value:'swing',label:'Swing',character:'Walking bass, swung phrasing and ride-led time.'},
  {value:'straight',label:'Straight',character:'Even eighths with a clear bass pulse.'},
  {value:'bossa-nova',label:'Bossa nova',character:'Clave, even eighths and root–fifth bass.'},
  {value:'ballad',label:'Ballad',character:'Sustained chords, two-feel bass and a quieter kit.'}
 ];
 let library = $state.raw<ListeningLibrarySnapshot>({tunes:[],error:null});
 let libraryLoaded = $state(false);
 const bookEntries = $derived(library.tunes.flatMap(tune => {
  if (!tune || typeof tune !== 'object') return [];
  const row = tune as Record<string,unknown>;
  if (typeof row.id !== 'string' || !row.id || isCuratedTuneId(row.id)) return [];
  return [{id:row.id,title:typeof row.title==='string' && row.title.trim() ? row.title.slice(0,200) : 'Untitled saved chart',tune}];
 }));
 const unreadableBookEntries = $derived(library.tunes.some(tune=>!tune || typeof tune!=='object' || typeof (tune as Record<string,unknown>).id!=='string' || !(tune as Record<string,unknown>).id));
 const selectedBookEntry = $derived(bookEntries.find(tune=>tune.id===tuneId));
 const admission = $derived(isCuratedTuneId(tuneId)
  ? assessCuratedListeningTune({tuneId,key,soloChoruses:solos})
  : assessListeningTune(selectedBookEntry?.tune,{key,soloChoruses:solos}));
 const session = $derived(admission.ok ? admission.session : null);
 const endingAssessment = $derived(endingSupported && ending === 'hold-release' && session
  ? assessTerminalArrangement(session.phrase.harmony, BACKING_STYLES[style], {
   phraseId: session.phrase.id, tempo, ppq: 192, beatsPerBar: 4, swing: settings.swing,
   sectionMap: session.phrase.sectionMap, performanceForm: session.phrase.performanceForm, ensemble: {},
   terminalArrangement: { ending: 'hold-release', melody: session.phrase.notes }
  }) : null);
 const endingUnavailable = $derived(endingAssessment?.available === false ? endingAssessment.reason : null);
 let snapshot = $state<ListeningSnapshot>({status:'idle',generated:null,params:null,ppq:192,startAudioTime:null,audioTime:null,elapsedBeats:0,durationBeats:0,barIndex:null,ending:false,error:null});
 const player = createListeningPlayer({onChange: next => snapshot = next});
 let takeScope = '';
 let takeSession = $state<ListeningTuneSession | null>(null);
 let takeSource = $state<Pick<Tune,'id'|'title'|'composer'|'source'> | null>(null);
 const shownBookEntries = $derived(takeSource && !bookEntries.some(entry=>entry.id===takeSource?.id)
  ? [...bookEntries,{id:takeSource.id,title:takeSource.title,tune:undefined}] : bookEntries);
 let marks = $state<{barIndex:number;elapsedBeats:number;note:string}[]>([]);
 let note = $state('');
 let notesPanel = $state<HTMLDetailsElement>();
 let pinnedBarIndex = $state<number | null>(null);
 let verdict = $state<'promising'|'needs-work'|'unsure'>('unsure');
 let feedback = $state<ListeningFeedback[]>([]);
 let showArchive = $state(false);
 let feedbackMessage = $state('');
 let feedbackError = $state('');
 let reviewBarIndex = $state<number | null>(null);
 let reviewSlider = $state<HTMLInputElement>();
 const busy = $derived(snapshot.status === 'playing' || snapshot.status === 'loading');
 const shownSession = $derived(takeSession ?? session);
 const reviewExtent = $derived(takeSession ? getListeningReviewExtent(snapshot, takeSession.bars.length) : null);
 const selectedReviewBar = $derived(busy ? pinnedBarIndex : selectListeningReviewBar(reviewBarIndex ?? pinnedBarIndex, reviewExtent));
 const displayBarIndex = $derived(selectedReviewBar ?? snapshot.barIndex);
 const reviewValue = $derived(selectedReviewBar ?? reviewExtent?.lastBarIndex ?? 0);
 const reviewValueBar = $derived(shownSession?.bars[reviewValue]);
 const reviewValueText = $derived(reviewValueBar ? `Bar ${reviewValue+1} · ${passName(reviewValueBar.context.chorusIndex)} · ${reviewValueBar.sectionLabel}` : '');
 const bar = $derived(displayBarIndex === null ? null : shownSession?.bars[displayBarIndex]);
 const chorus = $derived(shownSession?.phrase.performanceForm.choruses[bar?.context.chorusIndex ?? 0]);
 const shownBars = $derived(shownSession && chorus ? shownSession.bars.slice(chorus.startBar,chorus.endBarExclusive) : []);
 function decisionsAt(barIndex: number | null) {
  return snapshot.generated && barIndex !== null ? describeMusicianDecisions(snapshot.generated,{barIndex,ppq:snapshot.ppq,beatsPerBar:4,style:snapshot.params?.style ?? style,orchestration:snapshot.params?.orchestration ?? mode}) : [];
 }
 // Review changes only presentation; exported playback decisions keep their original clock cursor.
 const playbackDecisions = $derived(decisionsAt(snapshot.barIndex));
 const decisions = $derived(selectedReviewBar === null ? playbackDecisions : decisionsAt(selectedReviewBar));
 const performanceArc = $derived(snapshot.generated && displayBarIndex !== null ? describePerformanceArc(snapshot.generated,{barIndex:displayBarIndex,ppq:snapshot.ppq,beatsPerBar:4,style:snapshot.params?.style ?? style,orchestration:snapshot.params?.orchestration ?? mode}) : null);
 const position = $derived(bar ? `${passName(bar.context.chorusIndex)} · ${bar.sectionLabel} · Bar ${bar.context.barInChorus+1} of ${bar.context.barsInChorus}` : 'Ready to listen');
 function passName(index:number):string { return index === 0 ? 'Head in' : index === (shownSession?.phrase.performanceForm.choruses.length ?? 0)-1 ? 'Head out' : `Solo ${index}`; }
 function clearTake() { pinnedBarIndex=null;feedbackMessage='';feedbackError='';verdict='unsure';reviewBarIndex=null;player.stop();snapshot={...player.snapshot(),status:'idle',generated:null,params:null,barIndex:null,startAudioTime:null,provenance:undefined};takeSession=null;takeSource=null;marks=[];note=''; }
 function changeArrangement() { ending='continue';clearTake(); }
 function changeTune() {
  const source = isCuratedTuneId(tuneId) ? LISTENING_TUNES.find(t=>t.id===tuneId) : selectedBookEntry?.tune as Partial<Tune> | undefined;
  key=source?.key && PITCH_CLASSES.includes(source.key) ? source.key : 'C';
  clearTake();
 }
 const book = createListeningLibrary({
  read: () => {
   // A loop-guarded account switch may return page data before the realm reloads.
   if ((page.data.user?.id ?? null) !== getLastUserId()) throw new Error('Tune-book namespace changed');
   return getAllTunes();
  },
  whenHydrated: awaitHydration,
  scope: () => JSON.stringify([getLastUserId(),getScopeGeneration()]),
  onChange: next => { library=next;libraryLoaded=true; },
  onAccountChange: () => {
   feedback=[];showArchive=false;clearTake();refreshFeedback();
   if (!isCuratedTuneId(tuneId) || takeSource) {
    clearTake();tuneId=defaultTune.id;key=defaultTune.key;
   }
  }
 });
 $effect(() => {
  const accountId=page.data.user?.id ?? 'anon';
  void page.data.session?.expires_at;
  untrack(()=>book.refresh(accountId));
 });
 async function play() {
  if(!session || endingUnavailable || !Number.isFinite(tempo) || tempo < 40 || tempo > 240) return;
  takeScope=JSON.stringify([getLastUserId(),getScopeGeneration()]);const captured=structuredClone(session);pinnedBarIndex=null;feedbackMessage='';feedbackError='';verdict='unsure';reviewBarIndex=null;takeSession=captured;marks=[];note='';
  takeSource=isCuratedTuneId(tuneId) ? null : {id:tuneId,title:captured.tune.title,composer:captured.tune.composer,source:captured.tune.source};
  await player.start({phrase:captured.phrase,style,tempo,swing:settings.swing,instrument:'piano',volume:settings.backingTrackVolume,mix:{...getBackingMix()},orchestration:mode,...(endingSupported && ending === 'hold-release' ? {ending} : {})});
 }
 function mark() { if(selectedReviewBar === null && snapshot.barIndex !== null) {marks=[...marks.slice(-49),{barIndex:snapshot.barIndex,elapsedBeats:snapshot.elapsedBeats,note:note.trim()}];note='';} }
 function markMoment() { mark();if(notesPanel) notesPanel.open=true; }
 function annotateMark(index:number,value:string) { marks=marks.map((mark,i)=>i===index?{...mark,note:value.slice(0,500)}:mark); }
 function reviewBar(requested: number, focus = false) {
  reviewBarIndex=selectListeningReviewBar(requested, reviewExtent);
  if(reviewBarIndex !== null && focus) reviewSlider?.focus();
 }
 function exportTake() {
  if(!snapshot.generated || !takeSession) return;
  const content={version:1,buildVersion,feedback:{verdict,note:note.trim()},completion:snapshot.status==='completed'?'complete':'partial',session:{tuneId:takeSession.tune.id,headBars:takeSession.headBars,chorusBars:takeSession.chorusBars,soloChoruses:takeSession.soloChoruses,bars:takeSession.bars,...(takeSource ? {source:takeSource} : {})},playback:snapshot,decisions:playbackDecisions,marks,...(selectedReviewBar === null ? {} : {review:{barIndex:selectedReviewBar,decisions}})};
  const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`musicality-${takeSession.tune.id}-${snapshot.params?.orchestration}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function pin() { if(snapshot.barIndex!==null && snapshot.generated) pinnedBarIndex=snapshot.barIndex; }
 function follow() { pinnedBarIndex=null;reviewBarIndex=null; }
 function refreshFeedback() { try { if((page.data.user?.id??null)!==getLastUserId()) throw new Error('Account changed'); feedback=readListeningFeedback(localStorage); } catch { feedback=[];feedbackError='Saved feedback is unavailable in this browser. You can still export a take.'; } }
 let feedbackReady = $state(false);
 onMount(() => { refreshFeedback(); feedbackReady = true; });
 function saveFeedback() {
  if(!takeSession) return;
  try {
   if((page.data.user?.id??null)!==getLastUserId()||takeScope!==JSON.stringify([getLastUserId(),getScopeGeneration()])) throw new Error('Account changed');
   const record=createListeningFeedback({playback:snapshot,session:takeSession,buildVersion,marks:$state.snapshot(marks),note,verdict});
   feedback=saveListeningFeedback(localStorage,record);
   feedbackMessage='Feedback saved on this browser. Export to keep a copy.';feedbackError='';
  } catch { feedbackError='Could not save feedback. Stop after listening to a bar, or export your take to keep a copy.'; }
 }
 function exportFeedback(record:ListeningFeedback) {
  const url=URL.createObjectURL(new Blob([serializeListeningFeedback(record)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`musicality-feedback-${record.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 onDestroy(()=>{book.dispose();player.dispose();});
</script>

<header class="tune-heading"><div><span class="eyebrow">Musicality <span class="release" data-testid="musicality-release">{CURRENT_MUSICALITY_RELEASE.version} · Pending listening</span></span><h1>{shownSession?.tune.title ?? 'Choose a tune'}</h1></div> <label class="tune">Tune<select data-testid="listening-tune" bind:value={tuneId} onchange={changeTune} disabled={busy}><optgroup label="Built-in">{#each LISTENING_TUNES as tune}<option value={tune.id}>{tune.title}</option>{/each}</optgroup>{#if shownBookEntries.length}<optgroup label="Your tune book">{#each shownBookEntries as tune}<option value={tune.id}>{takeSource?.id===tune.id ? takeSource.title : tune.title}</option>{/each}</optgroup>{/if}</select></label></header>

{#if !admission.ok && !busy}<p data-testid="listening-unavailable" role="status" class="error">{admission.reason}</p>{/if}
{#if endingUnavailable && !busy}<p data-testid="listening-ending-unavailable" role="status" class="error">Hold &amp; release is unavailable: {endingUnavailable}</p>{/if}
{#if snapshot.error}<p role="alert" class="error">{snapshot.error}</p>{/if}
<div class="desk-layout">
 <div class="score-column">
  <section class="score-panel" aria-label="Score and playback">
<section class="setup" aria-label="Listening setup">

 <label>Style<select data-testid="listening-style" bind:value={style} onchange={changeArrangement} disabled={busy}>{#each styles as item}<option value={item.value}>{item.label}</option>{/each}</select></label>
 <label>Key<select data-testid="listening-key" bind:value={key} onchange={clearTake} disabled={busy}>{#each PITCH_CLASSES as pitch}<option value={pitch}>{pitch.replace('b','♭').replace('#','♯')}</option>{/each}</select></label>
 <label>Tempo<input data-testid="listening-tempo" type="number" min="40" max="240" step="1" bind:value={tempo} onchange={clearTake} disabled={busy} /></label>
 <label>Solo choruses<select data-testid="listening-choruses" bind:value={solos} onchange={clearTake} disabled={busy}>{#each [1,2,3,4] as count}<option value={count}>{count}</option>{/each}</select></label>
</section><div class="arrangement-row"><div class="mode-segments" data-testid="listening-mode" role="group" aria-label="Arrangement"><button aria-pressed={mode==='original'} disabled={busy} onclick={()=>{mode='original';changeArrangement();}}>Original</button><button aria-pressed={mode==='coordinated'} disabled={busy} onclick={()=>{mode='coordinated';changeArrangement();}}>Coordinated</button></div><span class="engine-caption">{mode==='original'?'Original baseline':`Musicality ${CURRENT_MUSICALITY_RELEASE.version}`}</span><button class="text-button" data-testid="blind-open" onclick={oncompare}>Blind A/B ↗</button></div>
   {#if shownSession}<ListeningScore session={shownSession} barIndex={displayBarIndex} />{/if}
   <section class="transport" aria-label="Playback">
    {#if busy}<button class="play" data-testid="listening-stop" onclick={()=>player.stop()}>■ Stop</button>{:else}<button class="play" data-testid="listening-play" onclick={play} disabled={!admission.ok||!!endingUnavailable||!Number.isFinite(tempo)||tempo<40||tempo>240}>{snapshot.generated ? '↻ Replay take' : '▶ Listen'}</button>{/if}
    <div class="transport-status" data-testid="listening-position" data-bar-index={displayBarIndex ?? ''} data-start-audio-time={snapshot.startAudioTime ?? ''}><strong data-testid="listening-status" role="status">{snapshot.status === 'loading' ? 'Loading the band…' : snapshot.status === 'playing' ? snapshot.ending ? 'Letting the last chord ring' : 'Playing' : snapshot.status === 'completed' ? 'Take complete' : snapshot.status === 'stopped' ? 'Stopped' : snapshot.status === 'error' ? 'Unable to play' : 'Ready to listen'}</strong><small>{shownSession ? `${shownSession.bars.length} bars` : 'Arrangement unavailable'} · Rhythm section only</small>{#if bar}<small>{selectedReviewBar!==null?'Reviewing · ':''}{position}</small>{/if}</div>
    <span class="tempo-readout">{tempo}<small>BPM</small></span>
   </section>
   {#if shownSession}<div class="form-strip" aria-label="Complete performance">{#each shownSession.phrase.performanceForm.choruses as pass}<div class:current={bar?.context.chorusIndex===pass.index} style:flex-grow={pass.endBarExclusive-pass.startBar}><span>{passName(pass.index)}</span><small>{pass.endBarExclusive-pass.startBar} bars</small></div>{/each}</div>{/if}
  </section>

  <div class="ending-row">{#if endingSupported}<label>Ending<select data-testid="listening-ending" bind:value={ending} onchange={clearTake} disabled={busy}><option value="continue">Keep groove to the end</option><option value="hold-release">Hold &amp; release</option></select></label>{/if}</div>
  <p class="style-note">{styles.find(s=>s.value===style)?.character} <span>Play the melody yourself.</span></p>
  {#if reviewExtent}<section class="decision-review" aria-label="Take decision review"><div class="review-heading"><label for="listening-review">Review decisions</label><span>{reviewValueText}</span></div><input id="listening-review" data-testid="listening-review" bind:this={reviewSlider} type="range" min="0" max={reviewExtent.lastBarIndex} step="1" value={reviewValue} aria-valuetext={reviewValueText} aria-describedby="review-evidence-note" oninput={event=>reviewBar(Number(event.currentTarget.value))} /><p id="review-evidence-note">Scheduled evidence from this take · No audio playback</p></section>{/if}
  <div class="review-actions"><button class="mark-quick" onclick={markMoment} disabled={snapshot.barIndex===null||selectedReviewBar!==null}>Mark moment</button><span>{marks.length} marked</span><button class="saved-toggle" disabled={!feedbackReady} aria-expanded={showArchive} onclick={()=>showArchive=!showArchive}>Saved feedback <span>{feedback.length}</span> {showArchive?'−':'+'}</button></div>
  <details class="take-notes" bind:this={notesPanel}><summary>Listening notes & take export <span>+</span></summary><div class="notes-body"><p>Mark what you hear. Feedback keeps the release and settings; exports also include the scheduled notes. Partial takes remain labelled partial.</p><div class="note-controls"><input aria-label="Listening note" bind:value={note} maxlength="500" placeholder="What did you hear?" /><button onclick={mark} disabled={snapshot.barIndex===null || selectedReviewBar!==null}>Mark this bar</button></div>{#if marks.length}<ul class="marks">{#each marks as item,index}<li>{#if selectListeningReviewBar(item.barIndex,reviewExtent)!==null}<button class="marked-moment" onclick={()=>reviewBar(item.barIndex,true)}>Bar {item.barIndex+1} · {item.note || 'Marked moment'}</button>{:else}Bar {item.barIndex+1} · {item.note || 'Marked moment'}{/if}<input aria-label={`Note for marked moment ${index+1}`} value={item.note} maxlength="500" placeholder="What happened at this moment?" oninput={event=>annotateMark(index,event.currentTarget.value)} /></li>{/each}</ul>{/if}<div class="feedback-controls"><label>Your verdict<select aria-label="Your verdict" bind:value={verdict}><option value="unsure">Not sure yet</option><option value="promising">Promising</option><option value="needs-work">Needs work</option></select></label><button data-testid="listening-save-feedback" onclick={saveFeedback} disabled={busy||snapshot.barIndex===null}>Save feedback</button><button data-testid="listening-export" onclick={exportTake} disabled={!snapshot.generated}>Export take</button></div></div></details>
  {#if feedbackMessage}<p class="feedback-message" role="status">{feedbackMessage}</p>{/if}{#if feedbackError}<p class="error" role="alert">{feedbackError}</p>{/if}

  {#if showArchive}<section class="feedback-archive" data-testid="listening-feedback-archive" aria-label="Saved listening feedback"><p>Latest 20 summaries on this browser. Exports keep a portable copy. These are your impressions, not acceptance of a release.</p>{#each feedback as item}<article><div class="saved-heading"><strong>{item.tune.title}</strong><span>{item.musicalityRelease ? `Musicality ${item.musicalityRelease.version}` : 'Unversioned'}</span></div><p class="saved-meta">{item.settings.style} · {item.settings.key} · {item.settings.tempo} BPM · {item.settings.mode} · {item.completion==='complete'?'Complete':'Partial'} ({item.reachedBars}/{item.totalBars} bars)</p><p class="saved-verdict">{item.verdict==='promising'?'Promising':item.verdict==='needs-work'?'Needs work':'Not sure yet'} <time datetime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString()}</time></p>{#if item.note}<p class="saved-note">{item.note}</p>{/if}{#each item.marks as moment}<p class="saved-note">Bar {moment.barIndex+1} · {moment.note||'Marked moment'}</p>{/each}<button onclick={()=>exportFeedback(item)}>Export feedback</button></article>{:else}<p>No saved feedback yet. Listen, stop, then save your notes.</p>{/each}</section>{/if}
  <p class="book-note">{#if library.error}{library.error} {:else if unreadableBookEntries}Some saved charts are unreadable. {:else if libraryLoaded && !bookEntries.length}Add a saved chart to listen beyond the built-in tunes. {:else}Saved charts are available from your tune book. {/if}<a href="/tunes">Open Tunes ↗</a></p>
 </div>
 <section class="players" aria-labelledby="players-title">
  <div class="intention"><div class="intention-heading"><span class="eyebrow" id="players-title">The shared intention</span>{#if selectedReviewBar!==null}<button data-testid="listening-follow" onclick={follow}>Follow music ↗</button>{:else}<button data-testid="listening-pin" onclick={pin} disabled={snapshot.barIndex===null||!busy}>Pin this bar</button>{/if}</div>{#if performanceArc}<p class="performance-arc" data-testid="listening-performance-arc" data-bar-index={displayBarIndex} data-phase={performanceArc.phase}><span class="arc-label">Planned arc · </span>{performanceArc.label}</p>{:else}<p>{snapshot.generated?'Follow the scheduled notes and the space between them.':'The band’s decisions appear as the tune plays.'}</p>{/if}{#if shownSession}<ListeningArc form={shownSession.phrase.performanceForm} orchestration={snapshot.params?.orchestration ?? mode} barIndex={displayBarIndex} reviewing={selectedReviewBar !== null} />{/if}<div class="beat-indicator" aria-hidden="true">{#each [0,1,2,3] as beat}<i class:active={snapshot.status==='playing'&&selectedReviewBar===null&&!snapshot.ending&&Math.floor(snapshot.elapsedBeats%4)===beat}></i>{/each}<span>{selectedReviewBar!==null?'Pinned · scheduled evidence':snapshot.status==='playing'?'Current sounding bar':'Ready when you are'}</span></div></div>
  <div class="musicians">{#each ['bass','piano','drums'] as name,i}{@const decision=decisions.find(d=>d.instrument===name)}<article class={name} data-testid={`musician-${name}`} data-bar-index={displayBarIndex ?? ''}><div class="player-title"><h3><span aria-hidden="true">{['♩','▥','◌'][i]}</span>{name==='bass'?'Bass':name==='piano'?'Piano':'Drums'}</h3><small>{decision?.role ?? 'Ready'}</small></div><h4>{decision?.action ?? 'Waiting for the first bar'}</h4><p>{decision?.detail ?? 'Actual scheduled events and phrase decisions will appear here.'}</p>{#if decision}<details class="evidence"><summary>{decision.eventCount} scheduled {decision.eventCount===1?'event':'events'} · Why this choice</summary><ul>{#each decision.evidence as evidence}<li>{evidence}</li>{/each}</ul></details>{:else}<div class="waiting">No audio playing</div>{/if}</article>{/each}</div>
  <p class="evidence-note"><span>{selectedReviewBar!==null?`Reviewing bar ${selectedReviewBar+1} · Scheduled evidence`:snapshot.status==='playing'&&!snapshot.ending&&bar?'Live · Current sounding bar':snapshot.generated?'Last sounding bar':'No invented commentary.'}</span> · Pinning and review do not seek audio.</p>
 </section>
</div>
<footer><span>Musicality {CURRENT_MUSICALITY_RELEASE.version} · Listening review pending</span><a href="/docs/architecture/musicality">Architecture & roadmap ↗</a></footer>

<style>
 .tune-heading .tune{width:220px;flex-shrink:0}.mode-segments{display:flex;background:#101b2a;border:1px solid #52617588;padding:3px;border-radius:4px}.mode-segments button{padding:.4rem .65rem;font-size:.65rem;color:#a6b5c7;border-radius:2px}.mode-segments button[aria-pressed=true]{background:#374354;color:#f1dfbf}.engine-caption{font-size:.6rem;color:#a8b7c9}.ending-row{display:flex;justify-content:flex-end;margin-top:.6rem}.ending-row label{display:flex;align-items:center;gap:.5rem}.ending-row select{width:auto;margin-top:0;padding:.35rem .5rem;font-size:.65rem}.review-actions{display:flex;align-items:center;gap:.7rem;border-block:1px solid #46566b;padding:.5rem 0;margin-top:1rem}.review-actions>span{font-size:.62rem;color:#91a1b4}.review-actions .saved-toggle{margin-left:auto;padding:.4rem 0}.mark-quick{border:1px solid #7d7566;padding:.5rem .7rem;border-radius:3px;color:#e0c69e;font-size:.7rem}.tune-heading{display:flex;justify-content:space-between;align-items:end;gap:1rem;margin:1.8rem 0 1.5rem}.eyebrow{font-size:.6rem;letter-spacing:.12em;color:#d5ad6c;text-transform:uppercase}.tune-heading h1{font:400 clamp(1.7rem,3vw,2.1rem)/1.3 var(--font-display);letter-spacing:-.035em;margin:.5rem 0 0}.tune-meta{color:#9aaabc;font-size:.72rem;display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;justify-content:flex-end}.release{border-left:1px solid #46566b;padding-left:.7rem;margin-left:.7rem;font-size:.55rem;color:#9aaabc;letter-spacing:0;text-transform:none;white-space:nowrap}
 .setup{display:grid;grid-template-columns:1.25fr 1fr 1fr 1fr;gap:1.1rem;padding:0 0 .8rem}label{font-size:.6rem;letter-spacing:.07em;text-transform:uppercase;color:#a3b1c2}select,input{width:100%;margin-top:.4rem;padding:.4rem 0;background:transparent;color:#e8edf2;border:0;border:1px solid #46566b;background:#172334;padding:.5rem .6rem;font:inherit;font-size:.8rem;letter-spacing:normal;text-transform:none;border-radius:3px}option{background:#1d293a;color:#f3eee5}button{cursor:pointer}button:disabled,select:disabled,input:disabled{opacity:.5;cursor:default}
 .desk-layout{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:32px;align-items:start}.score-column,.players{min-width:0}.score-panel{padding:18px 18px 0;background:#1d293a;border:1px solid #46566b;border-radius:6px;overflow:hidden}.transport{display:flex;align-items:center;gap:1rem;padding:15px 0}.play{background:#d5ad6c;color:#121d2b;padding:.75rem 1.25rem;border-radius:3px;min-width:104px;font-size:.8rem;font-weight:600}.transport-status{font-size:.75rem;color:#cad4df;min-width:0}.transport-status strong{font-weight:500}.transport-status small{display:block;font-size:.65rem;color:#9aaabc;margin-top:.3rem}.tempo-readout{margin-left:auto;font-size:1.2rem;font-variant-numeric:tabular-nums;white-space:nowrap}.tempo-readout small{font-size:.55rem;margin-left:.35rem;color:#9aaabc}.form-strip{display:flex;gap:3px;padding-bottom:15px}.form-strip>div{min-width:0;border-top:2px solid #52617577;padding:.6rem .15rem 0;color:#91a1b4;flex-basis:0}.form-strip>div.current{border-color:#d5ad6c;color:#d5ad6c}.form-strip span{font-size:.65rem;display:block}.form-strip small{display:block;font-size:.55rem;margin-top:.2rem}
 .arrangement-row{display:flex;align-items:center;gap:.75rem;padding:.8rem 0;border-top:1px solid #46566b;flex-wrap:wrap}.text-button{margin-left:auto;font-size:.72rem;color:#d5ad6c;padding:.5rem 0}.style-note{font-size:.65rem;line-height:1.7;color:#9aaabc}.style-note span{color:#c6d1dd}.intention{padding:0 0 1.2rem}.intention-heading{display:flex;align-items:center;justify-content:space-between;gap:.5rem}.intention-heading button{font-size:.65rem;color:#d5ad6c}.intention-heading>.eyebrow{font-size:.5rem;color:#95a6bb}.arc-label{color:#95a6bb;font-size:.65rem}.intention p{font-size:.8rem;line-height:1.7;color:#dbe0e5;margin:.4rem 0 .75rem}.beat-indicator{display:flex;gap:5px;align-items:center}.beat-indicator i{width:18px;height:3px;background:#44556a;border-radius:2px}.beat-indicator i.active{background:#d5ad6c}.beat-indicator span{font-size:.55rem;color:#91a1b4;margin-left:7px}.musicians{border:1px solid #52617588;border-radius:6px;overflow:hidden;background:linear-gradient(120deg,#233041,#1b2839)}.musicians article{padding:18px;--voice:#9eb8d1}.musicians article+article{border-top:1px solid #52617577}.musicians article.piano{--voice:#d5ad6c}.musicians article.drums{--voice:#9dc2b1}.player-title{display:flex;justify-content:space-between;align-items:center;gap:.5rem}.player-title h3{font-size:.75rem;font-weight:500;color:var(--voice);display:flex;align-items:center;gap:.5rem}.player-title h3 span{font-size:1rem}.player-title small{font-size:.58rem;color:#91a2b6}.musicians h4{font:400 1.3rem/1.28 var(--font-display);letter-spacing:-.02em;margin:.8rem 0 .6rem}.musicians p{font-size:.74rem;line-height:1.8;color:#c0cad6}.evidence{margin-top:.9rem}.evidence summary{font-size:.6rem;color:#abb9c9;cursor:pointer;line-height:1.7}.evidence ul{padding-left:1rem;color:#acbdcd;font-size:.65rem;line-height:1.8;margin-top:.6rem;overflow-wrap:anywhere}.waiting,.evidence-note{font-size:.6rem;color:#91a1b4;margin-top:.8rem;line-height:1.7}
 .take-notes{border-bottom:1px solid #46566b;margin-top:0}.take-notes>summary{padding:.95rem 0;cursor:pointer;font-size:.75rem;color:#d7dfe8;list-style:none;display:flex;justify-content:space-between}.notes-body{padding-bottom:1rem}.notes-body>p,.feedback-archive>p{font-size:.7rem;line-height:1.7;color:#a3b1c2}.note-controls{display:flex;gap:.7rem;align-items:center;margin-top:.6rem}.note-controls input{flex:1;min-width:0}.note-controls button,.feedback-controls button,.feedback-archive button{border:1px solid #526175;padding:.6rem .75rem;border-radius:3px;color:#d5ad6c;font-size:.68rem}.feedback-controls{display:flex;gap:.7rem;align-items:end;flex-wrap:wrap;margin-top:.9rem}.feedback-controls label{margin-right:auto}.marks{font-size:.7rem;color:#c0cad6;line-height:1.8;padding:.8rem 0 0}.marks li{padding:.5rem 0}.marks input{font-size:.7rem}.marked-moment{text-align:left;color:#d5ad6c}.decision-review{margin-top:1rem;padding:1rem 0;border-top:1px solid #46566b}.review-heading{display:flex;gap:1rem;justify-content:space-between;align-items:center}.review-heading>span{font-size:.65rem;color:#c0cad6}.decision-review input{accent-color:#d5ad6c;margin:.6rem 0;cursor:pointer}.decision-review p{font-size:.6rem;color:#91a1b4}.saved-toggle{display:flex;gap:.6rem;align-items:center;padding:.9rem 0;font-size:.7rem;color:#a3b1c2}.saved-toggle span{font-size:.6rem;border:1px solid #46566b;border-radius:3px;padding:0 .3rem}.feedback-message{color:#a8c7b5;font-size:.7rem;margin-top:.75rem}.feedback-archive{border:1px solid #46566b;border-radius:4px;padding:1rem}.feedback-archive article{padding:1rem 0;border-top:1px solid #46566b}.saved-heading{display:flex;justify-content:space-between;gap:.8rem;font-size:.75rem;flex-wrap:wrap}.saved-heading span{font-size:.6rem;color:#d5ad6c}.saved-meta,.saved-verdict,.saved-note{font-size:.67rem;color:#a3b1c2;line-height:1.8;margin:.4rem 0;overflow-wrap:anywhere}.saved-verdict{color:#d5ad6c}.saved-verdict time{color:#91a1b4;margin-left:.6rem}.saved-note{color:#dbe0e5}.feedback-archive button{margin-top:.5rem}.book-note{font-size:.62rem;color:#91a1b4;line-height:1.8;margin-top:.7rem}.book-note a{color:#d5ad6c;margin-left:.5rem}.error{color:#edb4a5;font-size:.75rem;line-height:1.7;margin:1rem 0}footer{border-top:1px solid #52617555;margin-top:1.7rem;padding-top:1rem;display:flex;justify-content:space-between;gap:1rem;font-size:.6rem;color:#91a1b4}button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #d5ad6c;outline-offset:4px}
 @media(min-width:1500px){.desk-layout{grid-template-columns:minmax(0,1fr) 380px}.musicians article{padding:20px}.musicians h4{font-size:1.4rem}}
 @media(max-width:1100px){.desk-layout{grid-template-columns:minmax(0,1fr) 310px;gap:24px}.setup{gap:.7rem}.tune-heading h1{font-size:1.8rem}}
 @media(max-width:800px){.tune-heading .tune{width:100%}.engine-caption{display:none}.desk-layout{grid-template-columns:1fr;gap:28px}.tune-heading{display:block}.tune-meta{justify-content:flex-start;margin-top:.8rem}.setup{grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}.tune-heading .tune{display:block;margin-top:1rem;width:100%}.setup label{font-size:.5rem}.setup select,.setup input{font-size:.72rem}.score-panel{padding:12px 12px 0}.transport{gap:.6rem}.transport-status small{font-size:.58rem}.play{padding:.7rem .8rem;min-width:90px}.form-strip span{font-size:.6rem}.form-strip small{font-size:.5rem}.musicians article{padding:20px}.text-button{margin-left:auto}.note-controls{flex-wrap:wrap}.note-controls input{flex-basis:100%}.review-heading{flex-wrap:wrap;gap:.4rem}footer{line-height:1.6}.book-note{margin-top:1rem}}
</style>
