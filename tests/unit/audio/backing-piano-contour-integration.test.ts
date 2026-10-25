import { assertBassHandoffDelta } from './bass-handoff-assertions';
import { createHash } from 'node:crypto';
import { assertPianoPhraseRecallDelta } from './piano-phrase-recall-assertions';
import { assertBossaContourCompatibility } from './bossa-contour-assertions';
import { expect, it } from 'vitest';
import { createRollingBacking, advanceRollingBacking, type RollingBackingBar } from '$lib/audio/backing-rolling';
import { generateBacking } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { resolveCoordinatedVoicing } from '$lib/audio/coordinated-voicing';

it('settles the real Saints returning-head top without sacrificing guide tones, common notes or minimum movement', () => {
	// Actual accepted Saints Eb pair: guide dyad at223.5, Ab6 rootless-B at231.5.
	const input = {
		chord: { root: 'Ab', quality: 'maj6' }, family: 'rootless-b', registerMidi: 63,
		previous: { version: 1, chord: { root: 'Eb', quality: 'maj6' }, notes: [55, 60] }, rootlessTexture: 'three'
	} as const;
	const baseline = resolveCoordinatedVoicing(input);
	expect(baseline.notes).toEqual([53, 60, 63, 70]);
	const requested = { ...input, targetTopMidi: 63 };
	const settled = resolveCoordinatedVoicing(requested);
	expect(settled.notes).toEqual([53, 58, 60, 63]);
	expect(settled.notes.map(note => note % 12).sort((a, b) => a - b))
		.toEqual(baseline.notes.map(note => note % 12).sort((a, b) => a - b));
	for (const field of ['requestedFamily', 'resolvedFamily', 'guideMotion', 'commonTones', 'totalMovement'] as const)
		expect(settled.decision[field]).toEqual(baseline.decision[field]);
	expect(settled.decision).toMatchObject({ guideMotion: 2, commonTones: [60], totalMovement: 26 });
	expect(settled.notes.at(-1)! - input.previous.notes.at(-1)!).toBe(3);
	expect(settled.memory.notes).toEqual(settled.notes);
});

it('prefers an even closer stationary top when the same real pair requests MIDI60', () => {
	const input = {
		chord: { root: 'Ab', quality: 'maj6' }, family: 'rootless-b', registerMidi: 63,
		previous: { version: 1, chord: { root: 'Eb', quality: 'maj6' }, notes: [55, 60] }, rootlessTexture: 'three', targetTopMidi: 60
	} as const;
	const actual = resolveCoordinatedVoicing(input);
	expect(actual.notes).toEqual([51, 53, 58, 60]);
	expect(actual.decision).toMatchObject({ guideMotion: 2, commonTones: [60], totalMovement: 26, topLine: { targetMidi: 60, actualMidi: 60, distance: 0, eligible: true } });
});

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-when-the-saints', key: 'Eb', soloChoruses: 2 });
const params = {
	phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
	performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {}
};
// Complete clean a00ea1f3 signatures: only explicit Swing/Straight pitches may change.
const baselineCases = [
	{
		"style": "swing",
		"mode": "original",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "f08052b259b71b819fac25cb7c6b0084f100eac1d91f8c2cff2de6ba98602454",
			"compNonPitches": "9f4cedb0a3bc21c43edb115d00ff1d3c35a250c22ac72d15e891718f74962d1c",
			"bassEvents": "e99e0fa82aa13e9bb31eee2de465cc06a40fae1589b7080af88a03a56f236b8b",
			"drumEvents": "c6b3afefaffc2237b475d56ce357b9570780289b2e263352357dbc20efd4627b",
			"compCount": 106
		}
	},
	{
		"style": "swing",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "bcd0dc480350fb70ff2633c2064aa604174e859d95c1bace790292d65a1b3472",
			"compNonPitches": "02b484b2cacf6e10125995b84ee2de9e857d77f564b664c0ccde610f6eb7f99a",
			"bassEvents": "c035acc741354afc942ed4fb6df856a194eb5f6553a0d4e74a57aa814978c993",
			"drumEvents": "488242eeaa8c6383cd62c0b66093b7f16f538736b635b5e4607a3ed538ecc0e1",
			"compCount": 44
		}
	},
	{
		"style": "swing",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "143052acf5cef8e525225cbc560dbaf2caea053bbb949f96ac6f520dd8dac427",
			"compNonPitches": "448b21f6556d982a8b0e2baa837df1d1b167adc22c882234323ef391499001d2",
			"bassEvents": "fe91a457a8e50a16ddb1a97e85c73134a4551790da6eb014ca66bfdaa3180d2b",
			"drumEvents": "0f8067f0f1f2e04dbd088fc1e0f39c1ee76bb839439a69d1a8efbbf91f7c8a3e",
			"compCount": 46
		}
	},
	{
		"style": "swing",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"pitchControl": false,
		"expected": {
			"compEvents": "ad920be43357382cc05267606bad9ad4563d38e1577392c9d40f531a2e29c991",
			"compNonPitches": "b66c650603392fb81ede73ce356a5f53302749bc2a2322757c2c60b5786f9e2c",
			"bassEvents": "a462723a15f015654955eb950cc7f58239b03faf107148f940b182a52c174517",
			"drumEvents": "d972ff341f443816ed95bf91025909c18088354cc2b3c77f3f916e9c7c0be431",
			"compCount": 33
		}
	},
	{
		"style": "swing",
		"mode": "coordinated-explicit",
		"engine": "rolling",
		"pitchControl": false,
		"expected": {
			"compEvents": "31850df1ef877ef51a4b2e5196b1df292c5fdfc007791e889d607724f582fcf3",
			"compNonPitches": "516bcef593c37569314624b1989791c3c8955a41946424bbf51d10da340069ee",
			"bassEvents": "c6828c8363c8d3d200dd4f7cacec0fc498cc188090e5aa351447c9f013f2fbf0",
			"drumEvents": "02ab6b88c5d95041b2659b3b6fc1ae3370135f3f60cb8e81b9a7a32693d6c107",
			"compCount": 35
		}
	},
	{
		"style": "straight",
		"mode": "original",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "84cc0895d014ce8716ab88984117ec01e2ef84a0cfc2293251ff436a391e06f5",
			"compNonPitches": "567bc97930c4e2ad9386e5b2baf722303c3a012929f3af950318e6a3745473df",
			"bassEvents": "1d40305875d7b7f85acb4c0c7093dbf7714362a1b0fab18936a072121a85aafb",
			"drumEvents": "f75bf3d610eaee2bec769547e92632e7ce86e8c4b7c23495b68b130d9af0d130",
			"compCount": 103
		}
	},
	{
		"style": "straight",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "92d4af75f0d263442b5a84ec7bec8a79eb45c5b2f58135f4eff64441c6fa5eaf",
			"compNonPitches": "120e5c00c45d187a2e61fddfffb44391aff95ee8229ff62979616f73e78d8d37",
			"bassEvents": "66ba35175eb4506943bfe430ed905026fa0a64b7edf2dc11d240114d9d6ab345",
			"drumEvents": "f3816242c0c69d0beb79e1ecc13519bf4ecd9230c8f5dfb0e62cce80878909ba",
			"compCount": 43
		}
	},
	{
		"style": "straight",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "48c426d4e61fd46fe6876562909123d0fc72541b3e69a12b4caf305ffa764020",
			"compNonPitches": "1e8c8278028e2dfffd906562dbf9dcc95fa35dc81cf86d7512720cd5fcfec323",
			"bassEvents": "744d2137ce1911d48df07d51f2fafd16e98f971401464455f543866506700b69",
			"drumEvents": "7fb5102bfcee4aa5c4e86b98b6dde9582854304db04535c83a2bff2b707a1bfd",
			"compCount": 45
		}
	},
	{
		"style": "straight",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"pitchControl": false,
		"expected": {
			"compEvents": "64e36ce61ebdb6e4044698f18fb5289a841c43e10271ffbefe35503a1a1b170e",
			"compNonPitches": "bcf4e2e68ca21c206057897cd6333c0c628914b6b787fdb1ef5d3e649ef291c3",
			"bassEvents": "30709d8e2c3deef5d5dbff8cbcfdbc36f4ad316748c31b2a17e87c915c23d4f1",
			"drumEvents": "df7e0cb085a3d892d1222835064003cb0a2f80c1b9ed67bd2cb5eb37d974247b",
			"compCount": 32
		}
	},
	{
		"style": "straight",
		"mode": "coordinated-explicit",
		"engine": "rolling",
		"pitchControl": false,
		"expected": {
			"compEvents": "aca979e436a45592a7364f612053944edfea6c1a6db79103971e555f1eac89d4",
			"compNonPitches": "af79cf8ec66a72830df0e0f9443885ee87d28618e2495134aa2a9b3a1ed2e62d",
			"bassEvents": "9449c7fe6c5eae7bacf85711b8432010a0d420d37ebd39e39e07fa339f31edd5",
			"drumEvents": "aac8bb9ba7ca26b34feb6c2ceca85bd447833660facf00a2008ca29cc720334e",
			"compCount": 35
		}
	},
	{
		"style": "bossa-nova",
		"mode": "original",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "a341704a69eb0b53d7280bda13c3beb4dab7d05a6e35d39d32bd854e9af73170",
			"compNonPitches": "e040500cc29f8b9f1c68ecf6e207d86dde63a910838fd0327fd1301b0db8d34e",
			"bassEvents": "e3d9fac32859c68c94a446ef634d047d7aae931aae07d3201652a8fddefd69ba",
			"drumEvents": "3b77a66f97bd03afd971809567074e69d05d18c4b37762f5d2738baf535a4490",
			"compCount": 151
		}
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "2e1c8a7b7553881f345208b9b63ef8163290f44d805e5b9b0693007cafe4e6d7",
			"compNonPitches": "8df7d574f3168c9b67ec02dffe4cb319f8e3aa5600defe39fe51f39e353c367a",
			"bassEvents": "d2c4509e0b9e719a4de51a2dff6bb23b56b95747a411963c7040e18661990bc3",
			"drumEvents": "92a14b5a43109377dfbdbb60ccadbbc38341a0b4c721fee2a8a6f0e2f8550270",
			"compCount": 64
		}
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "469266a3a87ccc0c8f3e68181e4e357f2f9cf686046575e1cba1570c96a34313",
			"compNonPitches": "8770b57c37f678a0574dc88ac50b3c4ef3e9731293f164fc9fb1208e4b13dcdb",
			"bassEvents": "841e11fc3b88a7a0eb1d6bda3071b976051b52c1557103a53bc18dcbf95ea529",
			"drumEvents": "6bea242c4394d00b78f2d95732e04e9a669bd8572db700b68c7b2a61de35b3bf",
			"compCount": 64
		}
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "62e09105b7d7755e270709708b3044bf3aed2d527d1d9c1360b1884a00d0def4",
			"compNonPitches": "e102f4c29960eddd200f5ea41dbe0ccc272b81ed26f311445401d47519f1cc46",
			"bassEvents": "627d85b80363b2c3ae2dac0225e5be8f3842a07ca1e4dcc10fbe0f49eccfc995",
			"drumEvents": "bdd51f917db2a19608f6c07bd3ed5b7671f154acd58fa37990c5c1bd404a8382",
			"compCount": 50
		}
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-explicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "2d444d5acf2dd8bc49e4eadd3559f2a2bc4a593f72f17af17c175c23882e9b64",
			"compNonPitches": "561abe60b89182c5f5ed2a02ddcfed5d965da25fee0809a394d75b2b5fe3b39a",
			"bassEvents": "ba7f4b3ae331a4d0261f9555c5b1fda596a93acc3a73b6ba78dc6173c0d3495e",
			"drumEvents": "2ee8592d91a750516ffe447837b5d01c1089143738145223a1fda70ba03cc887",
			"compCount": 50
		}
	},
	{
		"style": "ballad",
		"mode": "original",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "92a2a54e4e0b1dfdad094980b89a879c381a370bca197267cdf30bfcf3086f5d",
			"compNonPitches": "c0f076a1d3b4687b29570ce1a6d911c6bf9082ea11c2d32af9678ad79369e881",
			"bassEvents": "784d81e04d608e3e5bbc9c1a3800b1875403ddab8f4b93b434ad58835804791f",
			"drumEvents": "24181feb66a68e8d42fc9082e434b031ebf68ad01ee6328b6b6a2bef1cd172a4",
			"compCount": 71
		}
	},
	{
		"style": "ballad",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "739e5090ada1645f4a77c09a9ac2ecf6790f58617323b38fc5cfc10c1af90482",
			"compNonPitches": "63ab3087b83db2562a9c708aca0740d4ef6888e1f65aa236958f6ebf26fb469b",
			"bassEvents": "4a4a1344c7752b0919e225f983251b081a3231eef6226cdde410b16c2589e6db",
			"drumEvents": "200ad8af5e40532a7a20d6a2dac5fcb628bb31e054546aa47df1ec45c306911c",
			"compCount": 43
		}
	},
	{
		"style": "ballad",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "076b513fe2c20509382bc294ccf9fbb59dec9cbb1784fe4535da07844ff199bd",
			"compNonPitches": "4f73a8b6cb6fced65975dad98ced5fb32896bbc6fa80b33571a199f79c86c840",
			"bassEvents": "460096fe486efafb12a4e545e0c17c674ffdb651283e57561df3b7476c18ee88",
			"drumEvents": "abdf523bf39e91bae4ec21e5267ec596ed51a8565203f62afcd0fe066c88501a",
			"compCount": 43
		}
	},
	{
		"style": "ballad",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"pitchControl": true,
		"expected": {
			"compEvents": "ac4bf1810fb199736bc9083965b1449750f68d0ab1d90db43ab56fe652c94aef",
			"compNonPitches": "5d807ae238cfa6841311d554570126c55d2a7b8ad299c648c4796074639383e8",
			"bassEvents": "02f53a84b44bf72aabdd8e35bb716ceeb31cd1e499cc2a2eb6bcec25a8f74850",
			"drumEvents": "a6a5eddb2276c4988eb50ef5dfefefe57984f21bbbaccbe7effe058163209cab",
			"compCount": 34
		}
	},
	{
		"style": "ballad",
		"mode": "coordinated-explicit",
		"engine": "rolling",
		"pitchControl": true,
		"expected": {
			"compEvents": "5a49d31ed4fa8805b1ee285f3053a20a6af1d78831694c25157685d338b9c589",
			"compNonPitches": "955332034e79db0eb8e66bd52742fb0727eeb1d27fb6b5a942dbbd66e3c7236d",
			"bassEvents": "02ebfb56d9cb2736fdb95afb339ef7602296a129d00e7cac7148d9bab55e9cf3",
			"drumEvents": "bf3de81a394c59a516c3e3325b7c751f1120f92ce2debcd8157b74441da625ce",
			"compCount": 34
		}
	}
] as const;
it.each(baselineCases)('$style $mode $engine preserves full-tune contracts outside explicitly admitted recall changes', ({ style: id, mode, engine, pitchControl, expected }) => {
	const { performanceForm, ensemble, ...plain } = params;
	const input = {
		...plain,
		...(mode !== 'coordinated-implicit' ? { performanceForm } : {}),
		...(mode !== 'original' ? { ensemble } : {}),
		swing: BACKING_STYLES[id].defaultSwing
	};
	let recallEnergy: number | undefined;
	let bassWindows: RollingBackingBar[] = [];
	const current = engine === 'fixed' ? generateBacking(phrase.harmony, BACKING_STYLES[id], input) : (() => {
		const score = createRollingBacking(phrase.harmony, BACKING_STYLES[id], input);
		let checkpoint;
		const bars = [];
		for (let bar = 0; bar < score.totalBars; bar++) {
			const next = advanceRollingBacking(score, checkpoint);
			checkpoint = next.checkpoint;
			bars.push(next);
		}
		recallEnergy = bars[24].ensemblePlan.bars[0].energy;
		bassWindows = bars;
		return {
			bassEvents: bars.flatMap(bar => bar.bassEvents),
			compEvents: bars.flatMap(bar => bar.compEvents),
			drumEvents: bars.flatMap(bar => bar.drumEvents),
			ensembleDevelopment: { version: 1 as const, pianoVoicings: bars.flatMap(bar => bar.ensembleDevelopment.pianoVoicings ?? []),
				pianoMotifs: bars.flatMap(bar => bar.ensembleDevelopment.pianoMotifs ?? []),
				drumPhrases: bars.flatMap(bar => bar.ensembleDevelopment.drumPhrases) }
		};
	})();
	// The earlier pitch-only milestone's hashes remain immutable. Validate the new
	// exact rhythm/source/harmony delta, then reconstruct its original event footprint.
	const bassCompatible = engine === 'rolling' && mode === 'coordinated-explicit' && (id === 'swing' || id === 'straight')
		? { ...current, bassEvents: assertBassHandoffDelta(current.bassEvents, bassWindows, phrase.harmony, `SaintsEb-${id}-none`) } : current;
	const generated = engine === 'rolling' && mode === 'coordinated-explicit' && (id === 'swing' || id === 'straight')
		? assertPianoPhraseRecallDelta(bassCompatible, id, recallEnergy!) : bassCompatible;
	const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
	for (const field of ['bassEvents', 'drumEvents'] as const) {
		expect(hash(generated[field])).toBe(expected[field]);
	}
	expect(hash(generated.compEvents.map(({ notes, ...event }) => event))).toBe(expected.compNonPitches);
	expect(generated.compEvents).toHaveLength(expected.compCount);
	if (id === 'bossa-nova' && mode === 'coordinated-explicit') {
		assertBossaContourCompatibility(generated, expected.compEvents);
	} else if (pitchControl) expect(hash(generated.compEvents)).toBe(expected.compEvents);
});

it.each(['swing', 'straight'] as const)('%s updates phrase contour only from actual accepted chords, including rests and loop seams', id => {
	const style = BACKING_STYLES[id];
	const input = { ...params, swing: style.defaultSwing };
	const one = createRollingBacking(phrase.harmony, style, input);
	const two = createRollingBacking(phrase.harmony, style, input, { loopCount: 2 });
	let checkpoint;
	let prefix;
	let actualTop: number | undefined;
	let rests = 0;
	let attacks = 0;
	for (let bar = 0; bar < two.totalBars; bar++) {
		const previous = checkpoint;
		const current = advanceRollingBacking(two, checkpoint);
		checkpoint = current.checkpoint;
		const contour = checkpoint.piano.contour;
		if (bar === 57) {
			expect(actualTop).toBe(60);
			expect(current.compEvents.map(event => ({ absBeat: event.absBeat, notes: event.notes })))
				.toEqual([{ absBeat: 231.5, notes: [51, 53, 58, 60] }]);
			expect(current.ensembleDevelopment.pianoVoicings?.[0].decision).toMatchObject({
				guideMotion: 2, commonTones: [60], totalMovement: 26,
				topLine: { targetMidi: 58, actualMidi: 60, distance: 2, eligible: true }
			});
		}
		if (current.compEvents.length) {
			attacks += current.compEvents.length;
			actualTop = current.compEvents.at(-1)!.notes.at(-1)!;
			expect(contour?.lastTopMidi).toBe(actualTop);
			expect(contour?.lastBarIndex).toBe(bar);
			for (const trace of current.ensembleDevelopment.pianoVoicings ?? []) {
				expect(current.compEvents).toContainEqual(expect.objectContaining({ time: trace.time, absBeat: trace.absBeat, notes: trace.notes }));
				if (trace.decision.topLine) {
					expect(trace.decision.topLine.actualMidi).toBe(trace.notes.at(-1));
					expect(trace.decision.topLine.targetMidi).toBe(contour?.targetMidi);
				}
			}
			if (previous?.piano.contour?.phraseStartBar === contour?.phraseStartBar &&
				previous?.piano.contour?.chorusIndex === contour?.chorusIndex) {
				expect(contour?.targetMidi).toBe(previous?.piano.contour?.targetMidi);
			}
		} else {
			rests++;
			expect(contour).toEqual(previous?.piano.contour);
			expect(contour?.lastTopMidi).toBe(actualTop);
		}
		if (bar < 19) {
			prefix = advanceRollingBacking(one, prefix?.checkpoint);
			for (const field of ['bassEvents', 'compEvents', 'drumEvents', 'ensembleDevelopment'] as const) {
				expect(current[field]).toEqual(prefix[field]);
			}
		}
		if ([0, 17, 18, 56, 63, 64, 95].includes(bar)) {
			expect(advanceRollingBacking(two, JSON.parse(JSON.stringify(checkpoint))))
				.toEqual(advanceRollingBacking(two, checkpoint));
			expect(advanceRollingBacking(two, checkpoint, [{
				barIndex: bar + 10, observedAtBar: bar + 10, source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0
			}])).toEqual(advanceRollingBacking(two, checkpoint));
		}
	}
	expect(rests).toBeGreaterThan(20);
	expect(attacks).toBeGreaterThan(20);
});
