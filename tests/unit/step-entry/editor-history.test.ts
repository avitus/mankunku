import { describe, expect, it } from 'vitest';
import { EditorHistory } from '$lib/step-entry/editor-history';

const original = JSON.stringify({ key: 'D', mode: 'minor', notes: [{ pitch: 62, duration: [1, 8], tied: true }, { pitch: 62, duration: [1, 8] }] });
const cleared = JSON.stringify({ key: 'D', mode: 'minor', notes: [] });

describe('lick editor history', () => {
	it('restores ties, fractions and setup after clearing, without sharing live note references', () => {
		const history = new EditorHistory();
		history.record(original);
		history.record(cleared);
		const restored = history.undo()!;
		expect(JSON.parse(restored)).toEqual(JSON.parse(original));
		const live = JSON.parse(restored);
		live.notes[0].pitch = 65;
		expect(history.redo()).toBe(cleared);
		expect(history.undo()).toBe(original);
	});

	it('does not record the restored snapshot as a new edit or lose redo to a reactive echo', () => {
		const history = new EditorHistory();
		history.record(original);
		history.record(cleared);
		expect(history.record(history.undo()!)).toBe(false);
		expect(history.canRedo).toBe(true);
		expect(history.canUndo).toBe(false);
		expect(history.redo()).toBe(cleared);
	});

	it('discards the abandoned redo branch when a new note is entered after undo', () => {
		const history = new EditorHistory();
		history.record(original);
		history.record(cleared);
		history.undo();
		history.record('new phrase');
		expect(history.canRedo).toBe(false);
		expect(history.redo()).toBeNull();
		expect(history.undo()).toBe(original);
	});

	it('cannot restore another lick after a save or edit-target change', () => {
		const history = new EditorHistory();
		history.record(original);
		history.record(cleared);
		history.undo();
		history.reset();
		history.record('next lick');
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
		expect(history.undo()).toBeNull();
		expect(history.redo()).toBeNull();
	});

	it('keeps only the latest 50 content edits', () => {
		const history = new EditorHistory();
		for (let n = 0; n <= 60; n++) history.record(String(n));
		for (let n = 59; n >= 10; n--) expect(history.undo()).toBe(String(n));
		expect(history.undo()).toBeNull();
	});
});
