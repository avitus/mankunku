import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createRollingBacking, advanceRollingBacking } from '$lib/audio/backing-rolling';
import { generateBacking } from '$lib/audio/backing-generation';
import { BACKING_STYLES } from '$lib/audio/backing-styles';
import { buildListeningTuneSession } from '$lib/musicality/listening-tunes';
import { seedFrom } from '$lib/audio/generation-rng';

const { phrase } = buildListeningTuneSession({ tuneId: 'ls-when-the-saints', key: 'F#', soloChoruses: 2 });
const params = { phraseId: phrase.id, tempo: 140, ppq: 192, beatsPerBar: 4,
	performanceForm: phrase.performanceForm, sectionMap: phrase.sectionMap, ensemble: {} };

it.each(['swing', 'straight'] as const)('%s answers the previous accepted Saints snare phrase with one chord and room from the drummer', id => {
	const score = createRollingBacking(phrase.harmony, BACKING_STYLES[id], { ...params, swing: BACKING_STYLES[id].defaultSwing });
	let source;
	for (let bar = 0; bar < 18; bar++) source = advanceRollingBacking(score, source?.checkpoint);
	expect(source!.checkpoint.feedback!.previousDrumStatement!.hits.map(hit => hit.absBeat)).toEqual([69.5, 71.5]);
	const reply = advanceRollingBacking(score, source!.checkpoint);
	expect(reply.compEvents).toHaveLength(1);
	expect(reply.compEvents[0].absBeat).toBe(74.5);
	expect(reply.compEvents[0].velocity).toBe(65);
	expect(reply.compEvents[0].duration).toBeGreaterThan(0);
	expect(reply.compEvents[0].duration).toBeLessThanOrEqual(0.3);
	expect(reply.drumEvents.filter(event => event.role === 'commentary')).toEqual([]);
	const accepted = reply.ensembleDevelopment.pianoAnswers!;
	expect(accepted).toEqual([{ version: 1, barIndex: 18, source: source!.checkpoint.feedback!.previousDrumStatement,
		attack: reply.compEvents[0], replyOffset: 2.5, drumCommentary: 'space' }]);
	for (const hit of accepted[0].source.hits) expect(source!.drumEvents).toContainEqual(hit);
	expect(reply.checkpoint.drums.previousCompOnsets).toEqual([2.5]);
	expect(reply.checkpoint.drums.previousCompIsDrumReply).toBe(true);
	expect(reply.checkpoint.pianoAnswer).toEqual({ version: 1, lastAnswerBar: 18 });
	expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(source!.checkpoint)))).toEqual(reply);
	expect(advanceRollingBacking(score, source!.checkpoint, [{ barIndex: 30, observedAtBar: 30, source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }])).toEqual(reply);
	const { checkpointId: _id, ...withoutId } = JSON.parse(JSON.stringify(source!.checkpoint));
	withoutId.feedback.previousDrumStatement = null;
	const missing = { ...withoutId, checkpointId: `${withoutId.sessionId}:${withoutId.nextBar}:${seedFrom(JSON.stringify(withoutId)).toString(16)}` };
	const noSource = advanceRollingBacking(score, missing);
	expect(noSource.compEvents.map(event => event.absBeat)).toEqual([id === 'swing' ? 73.5 : 75.5]);
	expect(noSource.ensembleDevelopment.pianoAnswers ?? []).toEqual([]);
	expect(noSource.drumEvents.filter(event => event.role === 'commentary').map(event => event.absBeat)).toEqual([73, 75]);
	expect(reply.bassEvents).toEqual(noSource.bassEvents);
	expect(reply.drumEvents.filter(event => event.role !== 'commentary')).toEqual(noSource.drumEvents.filter(event => event.role !== 'commentary'));
	expect(reply.compEvents[0].velocity).toBe(noSource.compEvents[0].velocity);
	expect(reply.compEvents[0].duration).toBe(noSource.compEvents[0].duration);
	expect(reply.ensemblePlan).toEqual(noSource.ensemblePlan);
	expect(reply.checkpoint.drums.phrase.motif).toEqual(noSource.checkpoint.drums.phrase.motif);
	const dense = advanceRollingBacking(score, source!.checkpoint, [{ barIndex: 18, observedAtBar: 18, source: 'scripted', confidence: 1, noteDensity: 1, restBeats: 0 }]);
	expect(dense.ensembleDevelopment.pianoAnswers ?? []).toEqual([]);
	expect(dense.checkpoint.pianoAnswer!.lastAnswerBar).toBeNull();
	expect(advanceRollingBacking(score, JSON.parse(JSON.stringify(reply.checkpoint)))).toEqual(advanceRollingBacking(score, reply.checkpoint));
});

it.each(['swing', 'straight'] as const)('%s preserves a causal answer prefix across declared loops and never answers its own reply', id => {
	const style = BACKING_STYLES[id];
	const single = createRollingBacking(phrase.harmony, style, { ...params, swing: style.defaultSwing });
	const repeated = createRollingBacking(phrase.harmony, style, { ...params, swing: style.defaultSwing }, { loopCount: 2 });
	let one; let two;
	const answerBars = new Set<number>();
	for (let bar = 0; bar < repeated.totalBars; bar++) {
		two = advanceRollingBacking(repeated, two?.checkpoint);
		if (bar < 19) {
			one = advanceRollingBacking(single, one?.checkpoint);
			for (const field of ['bassEvents', 'compEvents', 'drumEvents', 'ensembleDevelopment'] as const)
				expect(two[field]).toEqual(one[field]);
		}
		for (const answer of two.ensembleDevelopment.pianoAnswers ?? []) {
			expect(answer.source.barIndex).toBe(bar - 1);
			expect(two.compEvents).toContainEqual(answer.attack);
			answerBars.add(bar);
		}
		for (const decision of two.ensembleDevelopment.drumPhrases) {
			if (decision.commentary.source === 'piano') expect(answerBars.has(decision.commentary.sourceBar!)).toBe(false);
		}
		if ([18, 63, 64].includes(bar)) {
			expect(advanceRollingBacking(repeated, JSON.parse(JSON.stringify(two.checkpoint))))
				.toEqual(advanceRollingBacking(repeated, two.checkpoint));
		}
	}
	expect(answerBars.has(18)).toBe(true);
});

// Complete event signatures captured from clean4301fe15 before reciprocal replies.
const controls = [
	{"style":"swing","mode":"original","engine":"fixed","expected":{"bassEvents":"1b3ccf8654d611c84a14672915002f30a4208427a11992de7907bbbad722d14a","compEvents":"a44ea3ab2ea193882a922bbeae44dfa01ce41af1824a3cea2008f7e70fa82662","drumEvents":"9ef48f91092b9a4cd954201623894ac3209d0ad7f208b3534d6ec3e51afbb015"}},
	{"style":"swing","mode":"coordinated-implicit","engine":"fixed","expected":{"bassEvents":"676d8df5daf05859592665416365cc6ef3f8a291978da42e3db78742b9c1a8a2","compEvents":"a0887c22c1244d7b6f98f2a45e29906b7a04c3d8fc3f2f4a70947fb0337ce7d2","drumEvents":"b8ed25a9bf3eaeaa4bbf562587148d5df057e26aea2849db0a3aa48fa14f4217"}},
	{"style":"swing","mode":"coordinated-implicit","engine":"rolling","expected":{"bassEvents":"dc6fca7c91f98967413135e9fa75773597fb1883cac8e70ede26a6fc0e7fd10c","compEvents":"b44916281ee5f50c6fce0a93fe2b205ebe8b3f476515037438e65287d77122f4","drumEvents":"95962a0a1a77918ee4979d8c8a06d06ebb5fcc03ba6bf816d10f496def60ae11"}},
	{"style":"swing","mode":"coordinated-explicit","engine":"fixed","expected":{"bassEvents":"87cd1af1e443a5c93038322a0b98e050eed97322671aa0b09e6fcf1d39a32b5e","compEvents":"f007a4fd3e93cf1e57fbeb410d756e2cb48c85245bc52763dbb3566e94c5e8ce","drumEvents":"d2cb65b2aa42f45b5d61ea5031eefa504cc7bbc8ad8bca5096489dd1b3f4b2e3"}},
	{"style":"straight","mode":"original","engine":"fixed","expected":{"bassEvents":"63e6b6c4b4c8f4bcd831ad260c56abef7d24236970c7818e20568aede4149397","compEvents":"66591430da1eed739b965e0ce6ed2853c203cf43e1298e86edd6c51017d3ac7e","drumEvents":"aa660021560f3a51c8321d853671c8298080c13bbdff6e1a88f4e4e090753f2e"}},
	{"style":"straight","mode":"coordinated-implicit","engine":"fixed","expected":{"bassEvents":"e1810c04a8313ebb8b12b704aaebca35a201518e521918c2e417914dec5ec54f","compEvents":"d690bf4b5f8bb868e18c81731ff8bb8ed01ec0cd5793097f098da7bf5ec1e9e8","drumEvents":"27492e1c835a0e7bfdf75ec9a17b85c0b8f3f0d186426bee022106320b766a90"}},
	{"style":"straight","mode":"coordinated-implicit","engine":"rolling","expected":{"bassEvents":"ad8869e3518063bd5d843bacc09800ab4c4326fb9fd8abb0cb50b5b9ee99d399","compEvents":"273220bee86fa3426ce3363da6b861ec14ee728611950f24c96cb90d9d922756","drumEvents":"dd596849d07fc6f60acd47e053f40a47a2707993a1a97c40d2635ce030081ba3"}},
	{"style":"straight","mode":"coordinated-explicit","engine":"fixed","expected":{"bassEvents":"a288961cc25f96564d98ca2f900eb74a3933f624fb0a458bc6012612c095a050","compEvents":"03a1aa4f1c8ca5a3d50f27d0315070495a91c66abc8067afef9e73b64c2b80d2","drumEvents":"ef15386df0433ae767f0dc795598e141fa98566aeedca22f1621500315b57096"}},
	{"style":"bossa-nova","mode":"original","engine":"fixed","expected":{"bassEvents":"ef6af96e714efc28c36d4e411b524050d913ef97495eb4f248d1367c21e7a751","compEvents":"242c17e78de40380c5839eddd75bc3fabf4a4dbb029704f1eabe6eec2745b6a7","drumEvents":"d63b27cd61f6fec8e66b6bf3a3bd808b96b359ac03f4dc06527ae76ea308cb8e"}},
	{"style":"bossa-nova","mode":"coordinated-implicit","engine":"fixed","expected":{"bassEvents":"85d5668dc54490c683fb2aa105a821c33eecd6940c0a2eb0a696790d41ca8da8","compEvents":"3a1dcf7b793a7d8eb57731f60be2ae1d44d53fa8902ab75a62d50eb0b4de4e5e","drumEvents":"20200f0cc57f85e1d5c6914e67dc14622ac79b999c69b2035af7d8424c3ced5c"}},
	{"style":"bossa-nova","mode":"coordinated-implicit","engine":"rolling","expected":{"bassEvents":"66e3679e3dfcf8057adbd68fbe4ab0dbb6b4c572744d06398f2a7b02f85b529c","compEvents":"d0f78fbaebd97a3aca2186abdc66c9f618fe91dc9b2cec004e29360accdd5ddd","drumEvents":"e540efcf3aca189cd94e9ed28d7cb2cd4c33c1aeb69a583ac9d6cb9377646629"}},
	{"style":"bossa-nova","mode":"coordinated-explicit","engine":"fixed","expected":{"bassEvents":"9d8d70e84c7b7e9bbba0bc974281aae5ae50a07421896b49a9dd66a1a53093a8","compEvents":"a4c639bd4acfd075688bb24b268e25554b23222cec92efb60ae02a2a7c38cd26","drumEvents":"9235d78a8742de843a912af7a0f138e2dea53bb0d99cc22ec57883bf11bd37b2"}},
	{"style":"bossa-nova","mode":"coordinated-explicit","engine":"rolling","expected":{"bassEvents":"714da8934b1030c02d6ce5aac40bad83465b16cdb3237430c82a39d7c1c61d7e","compEvents":"8cb4ce5e8303c3f66bdca1220f6cb76713f27724d8883129c0bdd165c7ff7d96","drumEvents":"cb37e69bf3ada3ebf2f2dfdd99f09bf804ef4dacb657332138a0bab18e3796e6"}},
	{"style":"ballad","mode":"original","engine":"fixed","expected":{"bassEvents":"d23d41394009f5090ff496033bc1052cd061f85c8c4f683cdf157358c9d45211","compEvents":"86d334356399946cfedef23340012cd74327dcba2671d799ad6e49bc8b42e43b","drumEvents":"e49f5a0cf4c222e71c2c1ed45ed091786ef18034ffdc2db701a149040da65dfa"}},
	{"style":"ballad","mode":"coordinated-implicit","engine":"fixed","expected":{"bassEvents":"f06c6e68e965af8616b295ccbbfb2e3dbe37524da68f966941ea0b51f0da2004","compEvents":"eaef0afd57e935d3c9456ec6932130e2948bcbbccbe51aca6a00857944ef2aa5","drumEvents":"edb4657403089965e6f33674bc81c76c72f8a77916ac44a2c5e5013e067e38f6"}},
	{"style":"ballad","mode":"coordinated-implicit","engine":"rolling","expected":{"bassEvents":"27b69abe2cf03df76d565d6f2b6d21f8735428c090c25a3c6d30ddf470e41315","compEvents":"c403dfd550ebe615eeeb73dba83f08d069753d604474e0d4e46440e5948b92b1","drumEvents":"ba85d92fd383c07c65738a3a43a990cb00c6b34450837c92fa6121a0236b7273"}},
	{"style":"ballad","mode":"coordinated-explicit","engine":"fixed","expected":{"bassEvents":"005bf81fcd5f592740da007ba3cd104e00435c98956d7639e2edbbb271752e35","compEvents":"8eb7506611f6b252272502bb12eeba94fd816363098fd9735a30092c751d6cf4","drumEvents":"771bdb9afebc72952f917e7fc452b184c25b608f4992ad537517ecee7949707f"}},
	{"style":"ballad","mode":"coordinated-explicit","engine":"rolling","expected":{"bassEvents":"85ab2dffb7684b0e1ed5cfaaa29ebfce0ec034b2107c1989d28434276d40d1ac","compEvents":"4e6c91018d2a312f06e6ff9861f235fbe417540bc6bcb8b9c2bf2ec7acbe9872","drumEvents":"75ba424f2605fea5309693aef9048545dbdec5b39c3df3f13c424df33ffe9ac5"}}
] as const;

it.each(controls)('$style $mode $engine preserves the complete baseline performance', ({ style: id, mode, engine, expected }) => {
	const { performanceForm, ensemble, ...plain } = params;
	const input = { ...plain, ...(mode !== 'coordinated-implicit' ? { performanceForm } : {}),
		...(mode !== 'original' ? { ensemble } : {}), swing: BACKING_STYLES[id].defaultSwing };
	const generated = engine === 'fixed' ? generateBacking(phrase.harmony, BACKING_STYLES[id], input) : (() => {
		const score = createRollingBacking(phrase.harmony, BACKING_STYLES[id], input);
		const bars = []; let checkpoint;
		for (let bar = 0; bar < score.totalBars; bar++) {
			const next = advanceRollingBacking(score, checkpoint); checkpoint = next.checkpoint; bars.push(next);
		}
		return { bassEvents: bars.flatMap(b => b.bassEvents), compEvents: bars.flatMap(b => b.compEvents), drumEvents: bars.flatMap(b => b.drumEvents) };
	})();
	for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const)
		expect(createHash('sha256').update(JSON.stringify(generated[field])).digest('hex')).toBe(expected[field]);
});
