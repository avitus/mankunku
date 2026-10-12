<script lang="ts">
	import StudioPanel from '$lib/components/console/StudioPanel.svelte';
	import SelectorPad from '$lib/components/console/SelectorPad.svelte';
	import { getPage } from '$lib/docs/structure';
	let previewSide = $state('ear');
	let tuneMode = $state('suggest');
	const tuneModes: Record<string, string> = {
		suggest: 'Discover where material from your vocabulary fits the changes.',
		points: 'Connect phrases through the form and get feedback on scored windows.',
		freestyle: 'Explore freely, with recognition when you quote licks from your collection.'
	};
	const docTeasers = [
		'getting-started',
		'architecture/scoring-algorithm',
		'architecture/audio-pipeline',
		'architecture/tonality-system'
	]
		.map((slug) => {
			const doc = getPage(slug);
			return doc ? { slug, title: doc.title, blurb: doc.blurb ?? '' } : null;
		})
		.filter((doc) => doc !== null);
</script>

{#snippet staff(variant: number)}
	{@const notes =
		variant === 0 ? [66, 56, 46, 51, 61, 46, 36, 41] : [61, 46, 56, 41, 51, 36, 46, 31]}
	<svg
		class="landing-staff"
		viewBox="0 0 420 108"
		role="img"
		aria-label="An illustrative jazz phrase on a musical staff"
	>
		{#each [31, 41, 51, 61, 71] as y}<line
				x1="12"
				y1={y}
				x2="408"
				y2={y}
				stroke="currentColor"
				opacity=".3"
			/>{/each}
		<path
			d="M33 83 C25 71 28 61 38 48 C48 35 45 17 40 19 C31 23 33 37 35 49 L41 82 C44 94 28 99 27 90 C26 83 34 82 34 88 M34 46 C15 56 21 77 36 75 C50 73 48 52 35 55 C25 57 28 68 35 68"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		/>
		<text x="48" y="39" fill="currentColor" font-size="17">♯</text><text
			x="59"
			y="54"
			fill="currentColor"
			font-size="17">♯</text
		>
		{#each notes as y, i}<g
				><ellipse
					cx={80 + i * 41}
					cy={y}
					rx="6.5"
					ry="4.5"
					fill="currentColor"
					transform="rotate(-18 {80 + i * 41} {y})"
				/><path d="M{86 + i * 41} {y} v-27" stroke="currentColor" stroke-width="1.4" /></g
			>{/each}
		{#each [0, 2, 4, 6] as i}<path
				d="M{86 + i * 41} {notes[i] - 27} L{127 + i * 41} {notes[i + 1] - 27}"
				stroke="currentColor"
				stroke-width="3"
			/>{/each}
	</svg>
{/snippet}

<div class="studio-desk landing-desk">
	<nav class="landing-sections" aria-label="About Mankunku">
		<a href="#ear-training">Ear Training</a><a href="#vocabulary">Vocabulary</a><a href="#tunes"
			>Tunes</a
		><a href="#getting-started">Getting started</a>
	</nav>
	<section class="landing-hero">
		<div>
			<p class="studio-label">Your instrument. Your daily practice.</p>
			<h1>Develop your ear.<br />Build your<br /><em>vocabulary.</em></h1>
			<p class="landing-lede">Hear more. Find your own musical voice.</p>
			<p class="landing-hero-copy">
				Connect what you hear with what you play. Train your ear, develop a vocabulary of licks and
				melodic devices, and put it to work over real tunes.
			</p>
			<div class="landing-actions" data-domain="ear-training">
				<a href="/ear-training" class="studio-action">Start practicing ↗</a><a
					href="#two-sides"
					class="studio-text-action">See how it works ↗</a
				>
			</div>
			<p class="landing-meta">In your browser · On your instrument · No account needed to begin</p>
		</div>
		<div class="studio-panel landing-preview">
			<div class="landing-preview-label">
				<span class="studio-label">The practice room</span><small>Illustrative preview</small>
			</div>
			<SelectorPad
				ariaLabel="Explore the two sides"
				columns={2}
				value={previewSide}
				options={[
					{ value: 'ear', label: 'A · Ear Training' },
					{ value: 'vocabulary', label: 'B · Vocabulary' }
				]}
				onChange={(value) => (previewSide = value)}
			/>
			<div
				class="studio-well landing-screen"
				data-domain={previewSide === 'ear' ? 'ear-training' : 'neutral'}
				aria-live="polite"
			>
				<p class="studio-label">
					{previewSide === 'ear'
						? 'Listen & respond · D major'
						: 'Licks + Tricks · Your musical language'}
				</p>
				<h2>
					{previewSide === 'ear'
						? 'From your ear to your instrument.'
						: 'An idea. A device. Your voice.'}
				</h2>
				{@render staff(previewSide === 'ear' ? 0 : 1)}
				<div class="landing-chips">
					{#each previewSide === 'ear' ? ['D', 'E', 'F♯', 'A', 'B'] : ['Learn a phrase', 'Explore a device', 'Make it yours'] as note}<span
							>{note}</span
						>{/each}
				</div>
			</div>
			<p class="studio-caption">
				{previewSide === 'ear'
					? 'Listen closely. Play it back.'
					: 'Learn it. Vary it. Put it to work.'}
			</p>
		</div>
	</section>
	<section id="two-sides" class="landing-section">
		<div class="landing-section-intro">
			<div>
				<p class="studio-label">Two sides. One musical voice.</p>
				<h2>A better ear.<br />More to say.</h2>
			</div>
			<p>Build the connection between hearing an idea and making it part of your playing.</p>
		</div>
		<div class="landing-pillars">
			<div id="ear-training" data-tour="side-a">
				<StudioPanel
					id="landing-ear"
					number="A"
					title="Ear Training"
					description="Listen & respond"
					domain="ear-training"
				>
					<h3>Hear it. Play it back.</h3>
					<p>
						Listen to a phrase, then answer on your instrument. Mankunku listens through your
						microphone and gives you feedback on pitch and rhythm.
					</p>
					<div class="studio-well landing-steps">
						{#each [['Listen', 'Let your ear lead.'], ['Play', 'Find it on your instrument.'], ['Reflect', 'Hear where to focus.']] as [title, copy], i}<div
							>
								<span class="studio-label">0{i + 1}</span><strong>{title}</strong>
								<p>{copy}</p>
							</div>{/each}
					</div>
					<p>
						Explore keys and scales with difficulty that adapts as you improve. Review your attempts
						and return to the details that need attention.
					</p>
					<a href="/ear-training" class="studio-action">Train your ear ↗</a>
				</StudioPanel>
			</div>
			<div id="vocabulary" data-tour="side-b">
				<StudioPanel
					id="landing-vocabulary"
					number="B"
					title="Vocabulary"
					description="Licks + Tricks"
				>
					<h3>Build a musical language.</h3>
					<p>
						Develop ideas to draw on when you improvise, through phrases you make your own and
						devices you can apply in new ways.
					</p>
					<div class="landing-vocabulary-type">
						<p class="studio-label">01 · Licks</p>
						<h4>Phrases you make your own.</h4>
						<p>
							Collect, write, or record musical ideas. Build fluency across keys and tempos, with
							Deep Practice where you need it.
						</p>
						<a href="/licks" class="studio-text-action">Explore licks ↗</a>
					</div>
					<div class="landing-vocabulary-type">
						<p class="studio-label">02 · Tricks</p>
						<h4>Devices that open possibilities.</h4>
						<p>
							Explore enclosures and triad pairs. Learn how they work, vary their patterns, and
							bring them into your own playing.
						</p>
						<a href="/tricks" class="studio-text-action">Explore tricks ↗</a>
					</div>
				</StudioPanel>
			</div>
		</div>
	</section>
	<section id="tunes" class="landing-section landing-tunes">
		<div>
			<p class="studio-label">Where vocabulary becomes music</p>
			<h2>Put it to work.<br />Over real tunes.</h2>
			<p>A phrase becomes more useful when you can hear where it belongs.</p>
			<p>
				Follow the melody and changes through complete song forms. Get suggestions for where your
				vocabulary fits, work through scored practice, or choose Freestyle and explore.
			</p>
			<p>
				Transpose for your instrument. Play with a generated rhythm section that follows the
				changes. Make connections beyond the practice exercise.
			</p>
			<a href="/tunes" class="studio-text-action">Explore tunes ↗</a>
		</div>
		<div class="studio-panel landing-tune-demo">
			<div class="landing-preview-label">
				<span class="studio-label">Over the changes</span><small>Example · Major ii–V–I</small>
			</div>
			<SelectorPad
				ariaLabel="Explore tune practice modes"
				columns={3}
				value={tuneMode}
				options={[
					{ value: 'suggest', label: 'Suggest' },
					{ value: 'points', label: 'Points' },
					{ value: 'freestyle', label: 'Freestyle' }
				]}
				onChange={(value) => (tuneMode = value)}
			/>
			<div class="studio-well landing-chords">
				{#each ['Dm7', 'G7', 'Cmaj7', 'Cmaj7'] as chord, i}<div>
						<small>0{i + 1}</small><strong>{chord}</strong><span aria-hidden="true"
							>／ ／ ／ ／</span
						>
					</div>{/each}
			</div>
			<div class="landing-cue" aria-live="polite">
				<p class="studio-label">
					{tuneMode === 'suggest'
						? 'Find a connection'
						: tuneMode === 'points'
							? 'Connect the phrases'
							: 'Follow your ear'}
				</p>
				<p>{tuneModes[tuneMode]}</p>
			</div>
			<p class="landing-meta">Bass · Comping · Drums — Illustrative practice view</p>
		</div>
	</section>
	<section class="landing-section landing-support">
		<div>
			<p class="studio-label">Make it personal</p>
			<h2>Bring the music<br />you want to learn.</h2>
			<p>
				Build your collection around your musical interests. Write a phrase, record a single-note
				idea and refine its transcription, or discover material shared by other musicians.
			</p>
			<p>Create tune charts or import the music you already have.</p>
			<div class="landing-chips">
				<span>iReal Pro</span><span>Band-in-a-Box</span><span>MuseScore</span><span>PDF</span>
			</div>
			<p class="landing-meta">
				AI-assisted PDF import gives you a starting point to review and refine.
			</p>
		</div>
		<div>
			<p class="studio-label">Make every session count</p>
			<h2>A rhythm section.<br />A clearer next step.</h2>
			<h3>Find your feel.</h3>
			<p>
				Generated bass, comping, and drums for lick and tune practice. Explore swing, bossa nova,
				ballad, and straight feel.
			</p>
			<h3>Know where to focus.</h3>
			<p>
				Use pitch and rhythm feedback, recorded takes, and progress views to understand your
				playing. Return to a difficult phrase or spend time in a weaker key.
			</p>
			<a href="/licks/community" class="studio-text-action">Explore the community ↗</a>
		</div>
	</section>
	<section id="getting-started" class="landing-section landing-support">
		<div>
			<p class="studio-label">Your next session starts here</p>
			<h2>Bring your instrument.<br />Follow your ear.</h2>
			<p>A little focused practice. More music at your fingertips.</p>
			<div class="landing-actions" data-domain="ear-training">
				<a href="/ear-training" class="studio-action">Start practicing ↗</a><a
					href="/docs/getting-started"
					class="studio-text-action">Read the guide ↗</a
				>
			</div>
		</div>
		<div class="landing-faq">
			<details open>
				<summary>What do I need?</summary>
				<p>
					A browser, your instrument, and a microphone for listening exercises and scored practice.
					Headphones help keep playback out of the microphone. Pitch tracking is designed for one
					note at a time.
				</p>
			</details>
			<details>
				<summary>Do I need an account?</summary>
				<p>
					You can begin practicing without one. <a href="/auth">Sign in</a> to sync supported practice
					progress across devices and participate in the community.
				</p>
			</details>
			<details>
				<summary>How does community sharing work?</summary>
				<p>
					Licks and tunes you save while signed in are shared with the community by default.
					Discover other musicians’ material and make it part of your practice.
				</p>
			</details>
		</div>
	</section>
	<section class="landing-section" aria-label="Documentation">
		<p class="studio-label">Under the hood</p>
		<div class="landing-docs">
			{#each docTeasers as doc}<a href="/docs/{doc.slug}" class="studio-well"
					><strong>{doc.title}</strong>
					<p>{doc.blurb}</p></a
				>{/each}
		</div>
	</section>
	<footer class="landing-footer">
		<div>
			<strong>MANKUNKU.</strong>
			<p class="studio-label">Yakhal’ Inkomo · Cry of the Bull</p>
			<p>Named in tribute to South African saxophonist Winston “Mankunku” Ngozi.</p>
		</div>
		<div>
			<p class="studio-label">Listen closely. Play freely.</p>
			<a href="/docs/getting-started" class="studio-text-action">Getting-started guide ↗</a>
			<p>Free and open source.</p>
		</div>
	</footer>
</div>

<style>
	.landing-desk h1,
	.landing-desk h2,
	.landing-desk h3,
	.landing-desk h4 {
		font-family: var(--font-display);
		font-weight: 500;
	}
	.landing-sections {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 24px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--studio-border);
		color: var(--studio-muted);
		font-size: 12px;
	}
	.landing-sections a {
		min-height: 36px;
		display: flex;
		align-items: center;
	}
	.landing-hero {
		display: grid;
		grid-template-columns: 1.05fr 1fr;
		gap: 64px;
		align-items: center;
		padding: 68px 0 80px;
	}
	h1 {
		font-size: clamp(42px, 5vw, 66px);
		line-height: 1.06;
		letter-spacing: -0.045em;
		margin: 22px 0;
	}
	h1 em {
		font-style: normal;
		color: var(--color-brass-soft);
	}
	:global(:root.light) h1 em {
		color: var(--color-brass);
	}
	.landing-lede {
		font-size: 20px;
		margin-bottom: 16px;
	}
	.landing-hero-copy {
		color: var(--studio-muted);
		font-size: 15px;
		line-height: 1.8;
		max-width: 450px;
	}
	.landing-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 20px;
		margin: 26px 0 18px;
	}
	.landing-meta {
		color: var(--studio-muted);
		font-size: 11px;
		line-height: 1.8;
		margin-top: 18px;
	}
	.landing-preview-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 22px;
	}
	.landing-preview-label small {
		color: var(--studio-muted);
		font-size: 10px;
	}
	.landing-screen {
		margin: 22px 0 18px;
		color: var(--studio-accent-text);
		min-height: 276px;
	}
	.landing-screen h2 {
		font-size: 25px;
		line-height: 1.3;
		margin: 18px 0 8px;
		min-height: 66px;
	}
	.landing-staff {
		width: 100%;
		height: auto;
		display: block;
	}
	.landing-chips {
		display: flex;
		gap: 7px;
		flex-wrap: wrap;
		margin-top: 16px;
	}
	.landing-chips span {
		padding: 6px 9px;
		border: 1px solid var(--studio-border);
		border-radius: 3px;
		background: var(--studio-panel);
		font-size: 11px;
	}
	.landing-section {
		padding: 64px 0;
		border-top: 1px solid var(--studio-border);
		scroll-margin-top: 20px;
	}
	.landing-section h2 {
		font-size: 42px;
		line-height: 1.15;
		letter-spacing: -0.025em;
		margin: 15px 0 24px;
	}
	.landing-section h3 {
		font-size: 25px;
		margin: 20px 0 12px;
	}
	.landing-section p:not(.studio-label):not(.landing-meta) {
		color: var(--studio-muted);
		line-height: 1.8;
		margin-bottom: 16px;
	}
	.landing-section-intro {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 32px;
		margin-bottom: 30px;
	}
	.landing-section-intro > p {
		max-width: 360px;
	}
	.landing-pillars {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 24px;
	}
	.landing-pillars > div {
		min-width: 0;
		display: flex;
		scroll-margin-top: 24px;
	}
	.landing-pillars :global(.studio-panel) {
		width: 100%;
		display: flex;
		flex-direction: column;
	}
	.landing-pillars :global(.studio-panel-heading h2) {
		font-size: 28px;
	}
	.landing-pillars :global(.studio-panel-number) {
		font: 25px/44px var(--font-display);
		min-width: 40px;
	}
	.landing-pillars .studio-action {
		margin-top: auto;
		align-self: flex-start;
	}
	.landing-steps {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin: 24px 0;
	}
	.landing-steps strong {
		display: block;
		font: 22px var(--font-display);
		margin: 16px 0 6px;
	}
	.landing-steps p {
		font-size: 11px;
	}
	.landing-vocabulary-type {
		border-top: 1px solid var(--studio-border);
		padding-top: 20px;
		margin-top: 20px;
	}
	.landing-vocabulary-type h4 {
		font-size: 21px;
		margin: 8px 0;
	}
	.landing-vocabulary-type p {
		font-size: 13px;
	}
	.landing-tunes {
		display: grid;
		grid-template-columns: 0.85fr 1.15fr;
		gap: 60px;
		align-items: center;
	}
	.landing-chords {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		margin: 24px 0;
		padding: 0;
	}
	.landing-chords > div {
		padding: 16px 10px;
		border-right: 1px solid var(--studio-border);
	}
	.landing-chords > div:last-child {
		border: 0;
	}
	.landing-chords small {
		color: var(--studio-muted);
		font-size: 10px;
	}
	.landing-chords strong {
		display: block;
		font: 23px var(--font-display);
		color: var(--color-brass-soft);
		margin: 16px 0;
	}
	:global(:root.light) .landing-chords strong {
		color: var(--color-brass);
	}
	.landing-chords span {
		font-size: 10px;
		color: var(--studio-muted);
		white-space: nowrap;
	}
	.landing-cue {
		border-left: 2px solid var(--color-brass);
		padding-left: 16px;
		min-height: 90px;
		font-size: 12px;
	}
	.landing-support {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 70px;
	}
	.landing-support h2 {
		font-size: 36px;
	}
	.landing-faq details {
		border-bottom: 1px solid var(--studio-border);
		padding: 0 0 18px;
		margin-bottom: 20px;
	}
	.landing-faq summary {
		min-height: 40px;
		cursor: pointer;
	}
	.landing-faq p {
		font-size: 13px;
	}
	.landing-faq a {
		text-decoration: underline;
	}
	.landing-docs {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 16px;
		margin-top: 20px;
	}
	.landing-docs strong {
		font: 19px var(--font-display);
	}
	.landing-docs p {
		font-size: 12px;
		margin-top: 12px;
	}
	.landing-footer {
		display: flex;
		justify-content: space-between;
		gap: 32px;
		padding: 40px 0 10px;
		border-top: 1px solid var(--studio-border);
	}
	.landing-footer strong {
		font: 28px var(--font-display);
	}
	.landing-footer p {
		font-size: 11px;
		color: var(--studio-muted);
		margin-top: 14px;
		max-width: 330px;
	}
	@media (max-width: 1100px) {
		.landing-hero {
			gap: 32px;
		}
		.landing-tunes,
		.landing-support {
			gap: 32px;
		}
		.landing-docs {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 800px) {
		.landing-hero,
		.landing-tunes,
		.landing-support,
		.landing-pillars {
			grid-template-columns: 1fr;
		}
		.landing-hero {
			padding: 38px 0 56px;
		}
		.landing-hero-copy {
			max-width: 600px;
		}
		.landing-preview {
			max-width: 620px;
			width: 100%;
		}
		.landing-section {
			padding: 48px 0;
		}
		.landing-section-intro {
			flex-direction: column;
			align-items: flex-start;
			gap: 0;
		}
		.landing-section-intro > p {
			max-width: none;
		}
	}
	@media (max-width: 500px) {
		.landing-sections {
			justify-content: space-between;
			gap: 8px;
			font-size: 10px;
		}
		.landing-section h2 {
			font-size: 34px;
		}
		.landing-screen h2 {
			font-size: 24px;
		}
		.landing-steps {
			padding: 16px 10px;
			gap: 8px;
		}
		.landing-steps strong {
			font-size: 19px;
		}
		.landing-chords strong {
			font-size: 18px;
		}
		.landing-chords > div {
			padding: 14px 6px;
		}
		.landing-chords span {
			font-size: 8px;
		}
		.landing-docs {
			grid-template-columns: 1fr;
		}
		.landing-footer {
			flex-direction: column;
		}
	}
</style>
