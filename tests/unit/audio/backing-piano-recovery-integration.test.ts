import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createRollingBacking, advanceRollingBacking, type RollingBackingCheckpoint } from '$lib/audio/backing-rolling';
import { seedFrom } from '$lib/audio/generation-rng';
import { generateBacking, buildBarInfos } from '$lib/audio/backing-generation';
import { planPianoRecovery } from '$lib/audio/backing-piano-recovery';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-when-the-saints', key: 'F#', soloChoruses: 2 });
const params = {
	phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
	performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {}
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Clean71cdcda0: source and accepted reply stay exact; recovery changes only local piano.
const cases = [
	{
		"style": "swing",
		"before": [
			{
				"bassEvents": "f58ed4f4d46f399c497de87861236229c6c899f77810f45bb498e13b7da430fb",
				"compEvents": "9323fc07ab3b47f4ae618246ccec85b282a6f1acd558f94276df0b53bbbfe341",
				"drumEvents": "1f00476ca38967aa59179cc341e26a4744d172112b28627bc33900174986207d"
			},
			{
				"bassEvents": "658d5d77e02cbcc3598ee6db703d2e643f7257b8f72ef1d286c97c0fccbfe0e4",
				"compEvents": "70b0b6305cda6fe37a5a6621eb7438de3f544983d0c1c225e17773f320b6f72a",
				"drumEvents": "e0b40df156f6f106d0087d4101d9c898bd738f663b041a9b848376a8527fca15"
			}
		],
		"recoveryBass": "8ee8d7fe1328f35b176501f8dff960c1764e9060bc9f0f09f66be65d0359c9e9",
		"recoveryDrums": "a53f8528fe22943902f7320012a8afc246724310fc2ab6fc08442d1ac663601d"
	},
	{
		"style": "straight",
		"before": [
			{
				"bassEvents": "00882bc2639adbcf6cec2f50b6fe71929fa11dc9ef81d25923952743d6858d47",
				"compEvents": "fc358d58092bbf7a0e84057b9a4761731ae490dd4df94b9e64ea8744afb091c5",
				"drumEvents": "e98c25456267d3fc284a7c6affad30a1937c7780f6b3916f23b476e05072b7d0"
			},
			{
				"bassEvents": "ccba2546916dfd5f7b446021e16384135f7e3be11ebf27adc5bd799add2aacd1",
				"compEvents": "a63f1abee8fe67d74bb524aa90252250f940967ce569b5245d85ae41c81efa22",
				"drumEvents": "b7c958ba3b14740424b989a8d45bb11046806172a0a41e03c4bdee8d76797f5e"
			}
		],
		"recoveryBass": "0f6df3c9e53000188c0f4ec193880844c75014448db3dc8e1d84fd22ffd4940e",
		"recoveryDrums": "3019755fdce6b2b8b9600c44d4e6370fba3204a257c41691cd0d0bbc5e0dba06"
	}
] as const;

it.each(cases)('$style leaves one recovery bar after the actual Saints reply without rewriting its source or the rhythm section', ({ style: id, before, recoveryBass, recoveryDrums }) => {
	const score = createRollingBacking(phrase.harmony, BACKING_STYLES[id], { ...params, swing: BACKING_STYLES[id].defaultSwing });
	let checkpoint;
	const bars = [];
	for (let bar = 0; bar < 20; bar++) {
		const current = advanceRollingBacking(score, checkpoint);
		checkpoint = current.checkpoint;
		bars.push(current);
	}
	const source = bars[17], reply = bars[18], recovery = bars[19];
	expect(reply.compEvents).toMatchObject([{ absBeat: 74.5, notes: [58, 61, 63, 68], velocity: 65 }]);
	for (const [index, actual] of [source, reply].entries()) {
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) {
			expect(hash(actual[field])).toBe(before[index][field]);
		}
	}
	expect(recovery.compEvents).toEqual([]);
	const receipt = recovery.ensembleDevelopment.pianoRecoveries?.[0];
	expect(receipt).toMatchObject({
		barIndex: 19, source: { barIndex: 18, attack: reply.compEvents[0] },
		action: 'space', reason: 'after_drum_reply', originalMaxAttacks: 1, effectiveMaxAttacks: 0, acceptedAttacks: [],
		returningDrums: { motifId: 'drum-motif:16:17', sourceBar: 17 }
	});
	expect(receipt!.returningDrums!.hits).toEqual(recovery.drumEvents.filter(event => event.role === 'commentary'));
	expect(reply.checkpoint.pianoRecovery?.previousAnswer).toEqual({ barIndex: 18, attack: reply.compEvents[0] });
	expect(recovery.checkpoint.pianoRecovery?.previousAnswer).toBeNull();
	expect(hash(recovery.bassEvents)).toBe(recoveryBass);
	expect(hash(recovery.drumEvents)).toBe(recoveryDrums);
	expect(recovery.ensemblePlan.bars[0].piano.maxAttacks).toBe(1);
	expect(recovery.checkpoint.piano.voicing).toEqual(reply.checkpoint.piano.voicing);
	expect(recovery.checkpoint.piano.contour).toEqual(reply.checkpoint.piano.contour);
	expect(recovery.checkpoint.drums.previousCompOnsets).toEqual([]);
	expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(reply.checkpoint)))).toEqual(recovery);
	expect(advanceRollingBacking(score, reply.checkpoint, [{
		barIndex: 30, observedAtBar: 30, source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0
	}])).toEqual(recovery);
});

function rekey(checkpoint: RollingBackingCheckpoint): RollingBackingCheckpoint {
	const { checkpointId: _id, ...contents } = checkpoint;
	return { ...contents, checkpointId: `${contents.sessionId}:${contents.nextBar}:${seedFrom(JSON.stringify(contents)).toString(16)}` };
}

it.each(['swing', 'straight'] as const)('%s does not invent recovery without an actual returned motif, ordinary attack or accepted receipt', id => {
	const score = createRollingBacking(phrase.harmony, BACKING_STYLES[id], { ...params, swing: BACKING_STYLES[id].defaultSwing });
	let reply;
	for (let bar = 0; bar < 19; bar++) reply = advanceRollingBacking(score, reply?.checkpoint);
	const recovered = advanceRollingBacking(score, reply!.checkpoint);

	// A valid counterfactual checkpoint has the reply, but no retained drum motif.
	const noReturnState = JSON.parse(JSON.stringify(reply!.checkpoint));
	delete noReturnState.drums.phrase.motif;
	noReturnState.drums.phrase.commentarySelected = false;
	const noReturn = advanceRollingBacking(score, rekey(noReturnState));
	expect(noReturn.compEvents.map(event => event.absBeat)).toEqual([76]);
	expect(noReturn.ensembleDevelopment.pianoRecoveries).toMatchObject([{ action: 'none', reason: 'no_drum_return' }]);

	// Numerical cooldown history alone is not a receipt for the preceding bar.
	const noReceiptState = JSON.parse(JSON.stringify(reply!.checkpoint));
	noReceiptState.pianoRecovery.previousAnswer = null;
	noReceiptState.pianoAnswer.lastAnswerBar = 17;
	delete noReceiptState.drums.previousCompIsDrumReply;
	const noReceipt = advanceRollingBacking(score, rekey(noReceiptState));
	expect(noReceipt.compEvents.map(event => event.absBeat)).toEqual([76]);
	expect(noReceipt.ensembleDevelopment.pianoRecoveries ?? []).toEqual([]);

	const dense = advanceRollingBacking(score, reply!.checkpoint, [{
		barIndex: 19, observedAtBar: 19, source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0
	}]);
	expect(dense.compEvents).toEqual([]);
	expect(dense.ensembleDevelopment.pianoRecoveries?.[0].action).toBe('none');
	expect(dense.checkpoint.piano.voicing).toEqual(reply!.checkpoint.piano.voicing);
	expect(dense.checkpoint.piano.contour).toEqual(reply!.checkpoint.piano.contour);

	// Reuse the real accepted reply/return in a protected arrangement context.
	const info = { ...buildBarInfos(64, phrase.sectionMap, phrase.performanceForm)[19], ensemble: recovered.ensemblePlan.bars[0] };
	const request = { barIndex: 19, info, currentMaxAttacks: 1 as const, previous: reply!.checkpoint.pianoRecovery,
		ordinaryAttacks: noReturn.compEvents, returningDrums: recovered.ensembleDevelopment.pianoRecoveries![0].returningDrums };
	for (const protectedInfo of [
		{ ...info, isSectionFirstBar: true },
		{ ...info, isChorusFirstBar: true },
		{ ...info, ensemble: { ...info.ensemble, phraseStartBar: 19 } },
		{ ...info, ensemble: { ...info.ensemble, responseOwner: 'piano' as const } }
	]) {
		expect(planPianoRecovery({ ...request, info: protectedInfo })).toMatchObject({ action: 'none', effectiveMaxAttacks: 1 });
	}
});

// Complete clean71cdcda0 control performances.
const controls = [
	{
		"style": "swing",
		"mode": "original",
		"engine": "fixed",
		"expected": {
			"bassEvents": "1b3ccf8654d611c84a14672915002f30a4208427a11992de7907bbbad722d14a",
			"compEvents": "a44ea3ab2ea193882a922bbeae44dfa01ce41af1824a3cea2008f7e70fa82662",
			"drumEvents": "9ef48f91092b9a4cd954201623894ac3209d0ad7f208b3534d6ec3e51afbb015"
		}
	},
	{
		"style": "swing",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"expected": {
			"bassEvents": "676d8df5daf05859592665416365cc6ef3f8a291978da42e3db78742b9c1a8a2",
			"compEvents": "a0887c22c1244d7b6f98f2a45e29906b7a04c3d8fc3f2f4a70947fb0337ce7d2",
			"drumEvents": "b8ed25a9bf3eaeaa4bbf562587148d5df057e26aea2849db0a3aa48fa14f4217"
		}
	},
	{
		"style": "swing",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"expected": {
			"bassEvents": "dc6fca7c91f98967413135e9fa75773597fb1883cac8e70ede26a6fc0e7fd10c",
			"compEvents": "b44916281ee5f50c6fce0a93fe2b205ebe8b3f476515037438e65287d77122f4",
			"drumEvents": "95962a0a1a77918ee4979d8c8a06d06ebb5fcc03ba6bf816d10f496def60ae11"
		}
	},
	{
		"style": "swing",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"expected": {
			"bassEvents": "87cd1af1e443a5c93038322a0b98e050eed97322671aa0b09e6fcf1d39a32b5e",
			"compEvents": "dd1493c272fd2edf151f39b3ee23d07033da8a700799df1ec31cfa966362d3ee",
			"drumEvents": "d2cb65b2aa42f45b5d61ea5031eefa504cc7bbc8ad8bca5096489dd1b3f4b2e3"
		}
	},
	{
		"style": "straight",
		"mode": "original",
		"engine": "fixed",
		"expected": {
			"bassEvents": "63e6b6c4b4c8f4bcd831ad260c56abef7d24236970c7818e20568aede4149397",
			"compEvents": "66591430da1eed739b965e0ce6ed2853c203cf43e1298e86edd6c51017d3ac7e",
			"drumEvents": "aa660021560f3a51c8321d853671c8298080c13bbdff6e1a88f4e4e090753f2e"
		}
	},
	{
		"style": "straight",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"expected": {
			"bassEvents": "e1810c04a8313ebb8b12b704aaebca35a201518e521918c2e417914dec5ec54f",
			"compEvents": "d690bf4b5f8bb868e18c81731ff8bb8ed01ec0cd5793097f098da7bf5ec1e9e8",
			"drumEvents": "27492e1c835a0e7bfdf75ec9a17b85c0b8f3f0d186426bee022106320b766a90"
		}
	},
	{
		"style": "straight",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"expected": {
			"bassEvents": "ad8869e3518063bd5d843bacc09800ab4c4326fb9fd8abb0cb50b5b9ee99d399",
			"compEvents": "273220bee86fa3426ce3363da6b861ec14ee728611950f24c96cb90d9d922756",
			"drumEvents": "dd596849d07fc6f60acd47e053f40a47a2707993a1a97c40d2635ce030081ba3"
		}
	},
	{
		"style": "straight",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"expected": {
			"bassEvents": "a288961cc25f96564d98ca2f900eb74a3933f624fb0a458bc6012612c095a050",
			"compEvents": "0a6389685206934abdc3c06dd45d41b61162d0a60e6fc03134ab11fc16c64732",
			"drumEvents": "ef15386df0433ae767f0dc795598e141fa98566aeedca22f1621500315b57096"
		}
	},
	{
		"style": "bossa-nova",
		"mode": "original",
		"engine": "fixed",
		"expected": {
			"bassEvents": "ef6af96e714efc28c36d4e411b524050d913ef97495eb4f248d1367c21e7a751",
			"compEvents": "242c17e78de40380c5839eddd75bc3fabf4a4dbb029704f1eabe6eec2745b6a7",
			"drumEvents": "d63b27cd61f6fec8e66b6bf3a3bd808b96b359ac03f4dc06527ae76ea308cb8e"
		}
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"expected": {
			"bassEvents": "85d5668dc54490c683fb2aa105a821c33eecd6940c0a2eb0a696790d41ca8da8",
			"compEvents": "3a1dcf7b793a7d8eb57731f60be2ae1d44d53fa8902ab75a62d50eb0b4de4e5e",
			"drumEvents": "20200f0cc57f85e1d5c6914e67dc14622ac79b999c69b2035af7d8424c3ced5c"
		}
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"expected": {
			"bassEvents": "66e3679e3dfcf8057adbd68fbe4ab0dbb6b4c572744d06398f2a7b02f85b529c",
			"compEvents": "d0f78fbaebd97a3aca2186abdc66c9f618fe91dc9b2cec004e29360accdd5ddd",
			"drumEvents": "e540efcf3aca189cd94e9ed28d7cb2cd4c33c1aeb69a583ac9d6cb9377646629"
		}
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"expected": {
			"bassEvents": "9d8d70e84c7b7e9bbba0bc974281aae5ae50a07421896b49a9dd66a1a53093a8",
			"compEvents": "a4c639bd4acfd075688bb24b268e25554b23222cec92efb60ae02a2a7c38cd26",
			"drumEvents": "9235d78a8742de843a912af7a0f138e2dea53bb0d99cc22ec57883bf11bd37b2"
		}
	},
	{
		"style": "bossa-nova",
		"mode": "coordinated-explicit",
		"engine": "rolling",
		"expected": {
			"bassEvents": "714da8934b1030c02d6ce5aac40bad83465b16cdb3237430c82a39d7c1c61d7e",
			"compEvents": "8cb4ce5e8303c3f66bdca1220f6cb76713f27724d8883129c0bdd165c7ff7d96",
			"drumEvents": "cb37e69bf3ada3ebf2f2dfdd99f09bf804ef4dacb657332138a0bab18e3796e6"
		}
	},
	{
		"style": "ballad",
		"mode": "original",
		"engine": "fixed",
		"expected": {
			"bassEvents": "d23d41394009f5090ff496033bc1052cd061f85c8c4f683cdf157358c9d45211",
			"compEvents": "86d334356399946cfedef23340012cd74327dcba2671d799ad6e49bc8b42e43b",
			"drumEvents": "e49f5a0cf4c222e71c2c1ed45ed091786ef18034ffdc2db701a149040da65dfa"
		}
	},
	{
		"style": "ballad",
		"mode": "coordinated-implicit",
		"engine": "fixed",
		"expected": {
			"bassEvents": "f06c6e68e965af8616b295ccbbfb2e3dbe37524da68f966941ea0b51f0da2004",
			"compEvents": "eaef0afd57e935d3c9456ec6932130e2948bcbbccbe51aca6a00857944ef2aa5",
			"drumEvents": "edb4657403089965e6f33674bc81c76c72f8a77916ac44a2c5e5013e067e38f6"
		}
	},
	{
		"style": "ballad",
		"mode": "coordinated-implicit",
		"engine": "rolling",
		"expected": {
			"bassEvents": "27b69abe2cf03df76d565d6f2b6d21f8735428c090c25a3c6d30ddf470e41315",
			"compEvents": "c403dfd550ebe615eeeb73dba83f08d069753d604474e0d4e46440e5948b92b1",
			"drumEvents": "ba85d92fd383c07c65738a3a43a990cb00c6b34450837c92fa6121a0236b7273"
		}
	},
	{
		"style": "ballad",
		"mode": "coordinated-explicit",
		"engine": "fixed",
		"expected": {
			"bassEvents": "005bf81fcd5f592740da007ba3cd104e00435c98956d7639e2edbbb271752e35",
			"compEvents": "8eb7506611f6b252272502bb12eeba94fd816363098fd9735a30092c751d6cf4",
			"drumEvents": "771bdb9afebc72952f917e7fc452b184c25b608f4992ad537517ecee7949707f"
		}
	},
	{
		"style": "ballad",
		"mode": "coordinated-explicit",
		"engine": "rolling",
		"expected": {
			"bassEvents": "85ab2dffb7684b0e1ed5cfaaa29ebfce0ec034b2107c1989d28434276d40d1ac",
			"compEvents": "4e6c91018d2a312f06e6ff9861f235fbe417540bc6bcb8b9c2bf2ec7acbe9872",
			"drumEvents": "75ba424f2605fea5309693aef9048545dbdec5b39c3df3f13c424df33ffe9ac5"
		}
	}
] as const;
it.each(controls)('$style $mode $engine preserves the complete baseline performance', ({ style: id, mode, engine, expected }) => {
	const { performanceForm, ensemble, ...plain } = params;
	const input = {
		...plain,
		...(mode !== 'coordinated-implicit' ? { performanceForm } : {}),
		...(mode !== 'original' ? { ensemble } : {}),
		swing: BACKING_STYLES[id].defaultSwing
	};
	const generated = engine === 'fixed' ? generateBacking(phrase.harmony, BACKING_STYLES[id], input) : (() => {
		const score = createRollingBacking(phrase.harmony, BACKING_STYLES[id], input);
		let checkpoint;
		const bars = [];
		for (let bar = 0; bar < score.totalBars; bar++) {
			const next = advanceRollingBacking(score, checkpoint);
			checkpoint = next.checkpoint;
			bars.push(next);
		}
		return {
			bassEvents: bars.flatMap(bar => bar.bassEvents),
			compEvents: bars.flatMap(bar => bar.compEvents),
			drumEvents: bars.flatMap(bar => bar.drumEvents)
		};
	})();
	for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) {
		expect(hash(generated[field])).toBe(expected[field]);
	}
});

it.each(['swing', 'straight'] as const)('%s preserves recovery across JSON resume and keeps the same declared-loop prefix', id => {
	const style = BACKING_STYLES[id];
	const input = { ...params, swing: style.defaultSwing };
	const one = createRollingBacking(phrase.harmony, style, input);
	const two = createRollingBacking(phrase.harmony, style, input, { loopCount: 2 });
	let single;
	let repeated;
	let recoveries = 0;
	for (let bar = 0; bar < two.totalBars; bar++) {
		const previous = repeated;
		repeated = advanceRollingBacking(two, repeated?.checkpoint);
		if (bar < 21) {
			single = advanceRollingBacking(one, single?.checkpoint);
			for (const field of ['bassEvents', 'compEvents', 'drumEvents', 'ensembleDevelopment'] as const) {
				expect(repeated[field]).toEqual(single[field]);
			}
		}
		for (const receipt of repeated.ensembleDevelopment.pianoRecoveries ?? []) {
			expect(receipt.source.barIndex).toBe(bar - 1);
			expect(previous!.compEvents).toContainEqual(receipt.source.attack);
			if (receipt.action === 'space') {
				recoveries++;
				expect(repeated.compEvents).toEqual([]);
				expect(repeated.checkpoint.piano.voicing).toEqual(previous!.checkpoint.piano.voicing);
				expect(repeated.checkpoint.piano.contour).toEqual(previous!.checkpoint.piano.contour);
				for (const hit of receipt.returningDrums!.hits) expect(repeated.drumEvents).toContainEqual(hit);
			}
		}
		if ([18, 19, 63, 64, 82, 83].includes(bar)) {
			expect(advanceRollingBacking(two, JSON.parse(JSON.stringify(repeated.checkpoint))))
				.toEqual(advanceRollingBacking(two, repeated.checkpoint));
		}
		if (bar === 64) expect(repeated.ensembleDevelopment.pianoRecoveries?.some(receipt => receipt.action === 'space') ?? false).toBe(false);
	}
	expect(recoveries).toBeGreaterThan(0);
});
