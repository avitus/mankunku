import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import type { Page } from '@playwright/test';

/**
 * Click-to-edit melody entry on the chart: bar hit zones arm the entry
 * cursor (`data-bar-pos="{sectionIdx}:{bar}"`), typed notes land at the
 * cursor, entry auto-advances across the 4-bar page boundary with no manual
 * pager, and arrow-key selection crosses pages.
 */

const CHART_SVG = '.abcjs-container svg';

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
});

async function openEditor(page: Page): Promise<void> {
	await page.goto('/tunes/editor');
	await expect(page.locator(CHART_SVG).first()).toBeVisible();
	await expect(page.locator('[data-bar-pos="0:0"]')).toBeVisible();
}

/** Document-order index of the highlighted note, or -1 when none. */
function selectedNoteIndex(page: Page): Promise<number> {
	return page.evaluate(() => {
		const notes = [...document.querySelectorAll('.abcjs-container svg .abcjs-note')];
		return notes.findIndex((n) => n.classList.contains('selected-note'));
	});
}

/**
 * Click a bar hit zone in the clear strip below the staff: the zone rect is
 * inserted UNDER the glyphs, so its exact center sits on the middle staff
 * line, whose path would intercept a centered click. (Real users clicking a
 * line pixel still land in the bar via abcjs's proximity resolution.)
 */
async function clickBarZone(page: Page, pos: string): Promise<void> {
	const zone = page.locator(`[data-bar-pos="${pos}"]`);
	const box = await zone.boundingBox();
	if (!box) throw new Error(`bar zone ${pos} has no bounding box`);
	await zone.click({ position: { x: box.width / 2, y: box.height * 0.85 } });
}

test('clicking an empty bar arms the entry cursor there and typing inserts in that bar', async ({ page }) => {
	await openEditor(page);
	await expect(page.getByTestId('entry-rail').getByText(/Section A · Bar 1, Beat 1/)).toBeVisible();

	await clickBarZone(page, '0:2');
	await expect(page.getByTestId('entry-rail').getByText(/Section A · Bar 3, Beat 1/)).toBeVisible();

	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	await expect(notes).toHaveCount(0);
	await page.keyboard.press('c');
	await expect(notes).toHaveCount(1);
	// Second eighth advances the cursor within bar 3 — the note went into the
	// clicked bar, not appended at the front of the form.
	await page.keyboard.press('c');
	await expect(notes).toHaveCount(2);
	await expect(page.getByTestId('entry-rail').getByText(/Section A · Bar 3, Beat 2/)).toBeVisible();
});

test('entry auto-advances across the page boundary without manual paging', async ({ page }) => {
	await openEditor(page);

	await page.keyboard.press('3'); // quarter notes
	for (let i = 0; i < 20; i++) {
		await page.keyboard.press('c');
	}

	// 20 quarters = 5 bars: 16 fill the first 4-bar page, the rest rolled
	// onto bar 5 with no pager interaction anywhere.
	await expect(page.locator(`${CHART_SVG} .abcjs-note`)).toHaveCount(20);
	await expect(page.getByTestId('entry-rail').getByText(/Section A · Bar 6, Beat 1/)).toBeVisible();
});

test('clicking a gap rest jumps the entry cursor to that bar', async ({ page }) => {
	await openEditor(page);

	// Half-fill bar 1, then park the cursor elsewhere.
	await page.keyboard.press('3');
	await page.keyboard.press('c');
	await page.keyboard.press('c');
	await clickBarZone(page, '0:3');
	await expect(page.getByTestId('entry-rail').getByText(/Section A · Bar 4, Beat 1/)).toBeVisible();

	// The trailing rest in partly-filled bar 1 is a pure GAP — no stored
	// element behind it, so it carries no note anchor and the click falls
	// through to the bar: the cursor jumps back to that bar (and no chord
	// editor opens — only chord TEXT clicks mean "edit the chord").
	await page.locator(`${CHART_SVG} .abcjs-rest`).first().click();
	await expect(page.getByTestId('entry-rail').getByText(/Section A · Bar 1, Beat 1/)).toBeVisible();
	await expect(page.getByTestId('chord-input')).toHaveCount(0);
});

test('clicking an entered rest selects it; Backspace deletes it in place', async ({ page }) => {
	await openEditor(page);

	// Quarter entry: note, explicit rest, note → bar 1 holds C · rest · C
	// plus a trailing gap rest on beat 4. (Slash bars elsewhere also render
	// .abcjs-rest glyphs, so assertions avoid whole-chart rest counts; the
	// bar-1 rest is first in document order.)
	await page.keyboard.press('3');
	await page.keyboard.press('c');
	await page.keyboard.press('0');
	await page.keyboard.press('c');
	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	const rests = page.locator(`${CHART_SVG} .abcjs-rest`);
	const rail = page.getByTestId('entry-rail');
	await expect(notes).toHaveCount(2);
	await expect(rail.getByText(/Section A · Bar 1, Beat 4/)).toBeVisible();

	// The ENTERED rest is a stored element with a note anchor: clicking it
	// selects it, and the selected element IS the position the rail reads
	// (2026-10-15 — a letter typed now fills the rest; contrast the gap-rest
	// test above, where the click falls through to the bar).
	await rests.first().click();
	await expect(page.locator(`${CHART_SVG} .abcjs-rest.selected-note`)).toHaveCount(1);
	await expect(rail.getByText(/Section A · Bar 1, Beat 2/)).toBeVisible();

	// Backspace removes just the rest and its time — both notes survive, the
	// second pulls onto beat 2 and is selected there, so the rail reads beat 2.
	await page.keyboard.press('Backspace');
	await expect(notes).toHaveCount(2);
	await expect(rail.getByText(/Section A · Bar 1, Beat 2/)).toBeVisible();
});

test('arrow keys cross the page boundary', async ({ page }) => {
	await openEditor(page);

	await page.keyboard.press('3'); // quarter notes
	for (let i = 0; i < 17; i++) {
		await page.keyboard.press('c');
	}
	await expect(page.locator(`${CHART_SVG} .abcjs-note`)).toHaveCount(17);

	// The 17th note (first of bar 5, past the page boundary) is selected by
	// the entry flow itself.
	await expect.poll(() => selectedNoteIndex(page)).toBe(16);

	// ArrowLeft hops back across the boundary to the last note of bar 4…
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => selectedNoteIndex(page)).toBe(15);

	// …and ArrowRight hops forward again to the first note of bar 5.
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => selectedNoteIndex(page)).toBe(16);
});

test('enters sixteenths and a dotted-eighth/sixteenth pair, filling one bar', async ({ page }) => {
	await openEditor(page);
	const rail = page.getByTestId('entry-rail');
	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	// The resolved-name label is hidden in the narrow rail, so the glyph
	// buttons' aria-pressed is the readable signal for the active duration.
	const glyph = (name: string) => rail.getByRole('button', { name });

	// Beat 1: four sixteenths (key 5 is the new glyph).
	await page.keyboard.press('5');
	await expect(glyph('Sixteenth Note')).toHaveAttribute('aria-pressed', 'true');
	for (let i = 0; i < 4; i++) await page.keyboard.press('c');
	await expect(notes).toHaveCount(4);
	await expect(rail.getByText(/Section A · Bar 1, Beat 2/)).toBeVisible();

	// Beat 2: dotted eighth + sixteenth. Dotted is only legal once the base is
	// back on an eighth, which is the pairing this feature exists for.
	await page.keyboard.press('4');
	await page.keyboard.press('.');
	await expect(glyph('Eighth Note')).toHaveAttribute('aria-pressed', 'true');
	await expect(rail.getByRole('button', { name: /Dotted/ })).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('c');
	await page.keyboard.press('.');
	await page.keyboard.press('5');
	await page.keyboard.press('c');
	await expect(notes).toHaveCount(6);

	// 4×1/16 + 3/16 + 1/16 = 1/2 — exactly two beats of 4/4.
	await expect(rail.getByText(/Section A · Bar 1, Beat 3/)).toBeVisible();
});

test('Triplet is inert on a sixteenth, from both the button and the keyboard', async ({ page }) => {
	await openEditor(page);
	const rail = page.getByTestId('entry-rail');
	const triplet = rail.getByRole('button', { name: /Triplet/ });

	await page.keyboard.press('5');
	await expect(triplet).toBeDisabled();

	// The keyboard bypasses the disabled button, so the state module has to
	// refuse it too — otherwise the flag would lie in wait for the next base.
	await page.keyboard.press('t');
	await page.keyboard.press('4');
	await expect(triplet).toBeEnabled();
	await expect(triplet).toHaveAttribute('aria-pressed', 'false');

	// An eighth, not an eighth triplet: three notes must not fill a whole beat.
	for (let i = 0; i < 2; i++) await page.keyboard.press('c');
	await expect(rail.getByText(/Section A · Bar 1, Beat 2/)).toBeVisible();
});

test('deleting a note mid-score leaves a rest and nothing moves; deleting the rest closes the gap across the page', async ({ page }) => {
	await openEditor(page);
	await page.keyboard.press('3'); // quarter notes
	// A (second space on the tenor's written staff): no staff or ledger line crosses the notehead, so clicks land on it.
	for (let i = 0; i < 20; i++) await page.keyboard.press('a');
	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	const rail = page.getByTestId('entry-rail');
	// Click the notehead ellipse: a note group's centre can be empty space over the bar hit zone.
	const noteheads = page.locator(`${CHART_SVG} .abcjs-note .abcjs-notehead`);
	await expect(notes).toHaveCount(20);
	await expect(rail.getByText(/Section A · Bar 6, Beat 1/)).toBeVisible();

	// Delete the second note (2026-10-15, MuseScore's Del): a rest takes its
	// beat and the cursor parks on it — the rail reads the rest's position,
	// not the page's end — so the right note can be typed straight in.
	await noteheads.nth(1).click();
	await page.keyboard.press('Backspace');
	await expect(notes).toHaveCount(19);
	await expect(page.locator(`${CHART_SVG} .abcjs-rest.selected-note`)).toHaveCount(1);
	await expect(rail.getByText(/Section A · Bar 1, Beat 2/)).toBeVisible();
	await page.keyboard.press('b');
	await expect(notes).toHaveCount(20);
	await expect(rail.getByText(/Section A · Bar 1, Beat 3/)).toBeVisible();

	// Delete it again, then delete the REST: its time goes and the 18 notes
	// behind it pull a beat earlier, across the four-bar page boundary.
	await noteheads.nth(1).click();
	await page.keyboard.press('Backspace');
	await expect(page.locator(`${CHART_SVG} .abcjs-rest.selected-note`)).toHaveCount(1);
	await page.keyboard.press('Backspace');
	await expect(notes).toHaveCount(19);

	// Saved, the melody is 19 contiguous quarters from beat 1 — the note that
	// sat on bar 5 beat 1 now sits on bar 4 beat 4.
	await page.getByRole('textbox', { name: 'Tune title' }).fill('Nineteen');
	await page.getByRole('button', { name: 'Save tune' }).click();
	await page.waitForURL(/\/tunes\/nineteen$/);
	const stored = await page.evaluate(() => window.localStorage.getItem('mankunku:user-tunes'));
	const sheets = JSON.parse(stored ?? '[]') as Array<{
		sections: Array<{ notes: Array<{ pitch: number | null; offset: [number, number] }> }>;
	}>;
	const pitched = sheets[0].sections[0].notes.filter((n) => n.pitch !== null);
	expect(pitched).toHaveLength(19);
	expect(pitched.map((n) => n.offset[0] / n.offset[1])).toEqual(pitched.map((_, i) => i / 4));
});

test('a wrong note is fixed in place: click it, type the letter; a duration key resizes it', async ({ page }) => {
	await openEditor(page);
	await page.keyboard.press('3'); // quarter notes
	for (const key of ['a', 'a', 'a', 'a']) await page.keyboard.press(key);
	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	const noteheads = page.locator(`${CHART_SVG} .abcjs-note .abcjs-notehead`);
	const rail = page.getByTestId('entry-rail');
	await expect(notes).toHaveCount(4);

	// Click the second note and type B: it is re-pitched in place (same beat,
	// same length), the count is unchanged, and the selection moves on to the
	// third note — the rail reads beat 3 — ready for the next letter.
	await noteheads.nth(1).click();
	await expect(rail.getByText(/Section A · Bar 1, Beat 2/)).toBeVisible();
	await page.keyboard.press('b');
	await expect(notes).toHaveCount(4);
	await expect(rail.getByText(/Section A · Bar 1, Beat 3/)).toBeVisible();
	await expect(page.locator(`${CHART_SVG} .abcjs-note.selected-note`)).toHaveCount(1);

	// A duration key on the selected (third) note resizes it: a half note
	// swallows the fourth quarter, MuseScore-style.
	await page.keyboard.press('2');
	await expect(notes).toHaveCount(3);
	await expect(page.getByRole('button', { name: 'Half Note' })).toHaveAttribute('aria-pressed', 'true');

	// Saved: B on beat 2, a half on beat 3, nothing shifted.
	await page.getByRole('textbox', { name: 'Tune title' }).fill('Fixed');
	await page.getByRole('button', { name: 'Save tune' }).click();
	await page.waitForURL(/\/tunes\/fixed$/);
	const stored = await page.evaluate(() => window.localStorage.getItem('mankunku:user-tunes'));
	const sheets = JSON.parse(stored ?? '[]') as Array<{
		sections: Array<{ notes: Array<{ pitch: number | null; offset: [number, number]; duration: [number, number] }> }>;
	}>;
	const pitched = sheets[0].sections[0].notes.filter((n) => n.pitch !== null);
	expect(pitched.map((n) => [n.offset[0] / n.offset[1], n.duration[0] / n.duration[1]])).toEqual([[0, 0.25], [0.25, 0.25], [0.5, 0.5]]);
	expect(pitched[1].pitch).toBe(pitched[0].pitch! + 2); // A → B, a whole step up
});

test('insert mode puts a note in front of the selection and pushes the rest later; Insert bar and Delete bar resize the section', async ({ page }) => {
	await openEditor(page);
	await page.keyboard.press('3'); // quarter notes
	for (const key of ['a', 'a', 'a', 'a']) await page.keyboard.press(key);
	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	const noteheads = page.locator(`${CHART_SVG} .abcjs-note .abcjs-notehead`);
	const rail = page.getByTestId('entry-rail');
	await expect(notes).toHaveCount(4);

	// I turns insert mode on: B goes in front of the second note and the rest
	// moves a beat later; the pushed note stays selected, now on beat 3.
	await noteheads.nth(1).click();
	await expect(rail.getByText(/Section A · Bar 1, Beat 2/)).toBeVisible();
	await page.keyboard.press('i');
	await expect(page.getByTestId('insert-badge')).toBeVisible();
	await page.keyboard.press('b');
	await expect(notes).toHaveCount(5);
	await expect(rail.getByText(/Section A · Bar 1, Beat 3/)).toBeVisible();
	await page.keyboard.press('i');
	await expect(page.getByTestId('insert-badge')).toHaveCount(0);

	// Insert bar before bar 1: the section grows to 9 bars and every note
	// moves a bar later; Delete bar on the (now empty) first bar undoes it.
	await page.getByRole('button', { name: 'Insert bar' }).click();
	await expect(page.getByRole('button', { name: /^A\s*9 bars$/ })).toBeVisible();
	await expect(notes).toHaveCount(5);
	await clickBarZone(page, '0:0');
	await page.getByRole('button', { name: 'Delete bar' }).click();
	await expect(page.getByRole('button', { name: /^A\s*8 bars$/ })).toBeVisible();
	await expect(notes).toHaveCount(5);
	await clickBarZone(page, '0:0');
	await expect(rail.getByText(/Section A · Bar 1, Beat 1/)).toBeVisible();
});

test('Shift+click selects a range on the chart; Ctrl/⌘+Backspace removes its time across the section', async ({ page }) => {
	await openEditor(page);
	await page.keyboard.press('3');
	for (let i = 0; i < 6; i++) await page.keyboard.press('a');
	const notes = page.locator(`${CHART_SVG} .abcjs-note`);
	const noteheads = page.locator(`${CHART_SVG} .abcjs-note .abcjs-notehead`);
	await expect(notes).toHaveCount(6);

	await noteheads.nth(1).click();
	await noteheads.nth(3).click({ modifiers: ['Shift'] });
	await expect(page.locator(`${CHART_SVG} .abcjs-note.selected-note`)).toHaveCount(3);
	await expect(page.locator('.td-status')).toContainText('3 selected');

	await page.keyboard.press('ControlOrMeta+Backspace');
	await expect(notes).toHaveCount(3);
	// Saved: the three survivors are contiguous quarters from beat 1.
	await page.getByRole('textbox', { name: 'Tune title' }).fill('Trimmed');
	await page.getByRole('button', { name: 'Save tune' }).click();
	await page.waitForURL(/\/tunes\/trimmed$/);
	const stored = await page.evaluate(() => window.localStorage.getItem('mankunku:user-tunes'));
	const sheets = JSON.parse(stored ?? '[]') as Array<{ sections: Array<{ notes: Array<{ pitch: number | null; offset: [number, number] }> }> }>;
	const pitched = sheets[0].sections[0].notes.filter((n) => n.pitch !== null);
	expect(pitched.map((n) => n.offset[0] / n.offset[1])).toEqual([0, 0.25, 0.5]);
});

test('common keyboard edits: transpose a range, copy, paste, repeat, undo, redo and clear selection', async ({ page }) => {
	await openEditor(page);
	await page.keyboard.press('3');
	for (const key of ['a', 'b', 'c', 'd']) await page.keyboard.press(key);
	await page.getByRole('textbox', { name: 'Tune title' }).fill('Keyboard edits');
	await page.getByRole('button', { name: 'Save tune' }).click();
	await page.waitForURL('**/tunes/keyboard-edits');
	const original = await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-tunes')!)[0]);
	const originalPitches = original.sections[0].notes.slice(0, 2).map((n: { pitch: number }) => n.pitch);
	await page.goto(`/tunes/editor?edit=${original.id}`);
	const heads = page.locator(`${CHART_SVG} .abcjs-note .abcjs-notehead`);
	await expect(heads).toHaveCount(4);
	await heads.first().click();
	await page.keyboard.press('Shift+ArrowRight');
	await expect(page.locator(`${CHART_SVG} .selected-note`)).toHaveCount(2);
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ControlOrMeta+c');
	await heads.nth(2).click();
	await page.keyboard.press('ControlOrMeta+v');
	await expect(heads).toHaveCount(4);
	await page.keyboard.press('r');
	await expect(heads).toHaveCount(6);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(heads).toHaveCount(4);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(heads).toHaveCount(6);
	await page.keyboard.press('Escape');
	await expect(page.locator(`${CHART_SVG} .selection-outline`)).toHaveCount(0);
	await page.getByRole('button', { name: 'Update tune' }).click();
	await page.waitForURL('**/tunes/keyboard-edits');
	const sheets = await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:user-tunes')!));
	const notes = sheets[0].sections[0].notes.filter((n: { pitch: number | null }) => n.pitch !== null);
	expect(notes.slice(0, 2).map((n: { pitch: number }) => n.pitch)).toEqual(originalPitches.map((pitch: number) => pitch + 1));
	expect(notes.map((n: { pitch: number }) => n.pitch)).toEqual([notes[0].pitch, notes[0].pitch + 2, notes[0].pitch, notes[0].pitch + 2, notes[0].pitch, notes[0].pitch + 2]);
	expect(notes.map((n: { offset: number[] }) => n.offset[0] / n.offset[1])).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25]);
});
