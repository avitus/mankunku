/** Presentation metadata for the native import workspace. Parsers retain their own contracts. */
export const IMPORT_METHODS = {
	ireal: {
		name: 'iReal Pro', eyebrow: 'From your playlist to your book', description: 'Bring the changes. Make the tune yours.',
		input: 'Your link', accept: '', formats: 'One song or a whole playlist', title: 'Paste a song. Bring a playlist.',
		detail: 'In iReal Pro, choose Share → Copy, then paste the link below.', primary: 'Read link',
		imports: ['Chord changes', 'Sections & form'], missing: 'Add the melody later in the editor.',
		note: 'iReal charts use concert pitch. Change this only for a chart authored at written pitch.',
		guide: [['Copy the link.', 'Share a song or playlist from iReal Pro.'], ['Find your tunes.', 'Scan a compact list and choose what to keep.'], ['Make it yours.', 'Review the changes, then add the melody.']]
	},
	biab: {
		name: 'Band-in-a-Box', eyebrow: 'From the arrangement to your book', description: 'Bring your changes into a space built for practice.',
		input: 'Your song file', accept: '.sgu,.mgu,.mg1,.mg2,.mg3,.mg4,.mg5,.mg6,.mg7,.mg8,.mg9,.xml,.musicxml,.txt',
		formats: 'SGU / MGU · MusicXML · Text', title: 'Bring your song file.', detail: 'Drop a Band-in-a-Box song or a MusicXML export here.', primary: 'Read file',
		imports: ['Chord changes', 'Sections & form'], missing: 'Melody and backing audio stay out of the import.',
		note: 'BIAB songs store concert chords. Change this only if the file was authored at written pitch.',
		guide: [['Choose your format.', 'MusicXML gives the most faithful chord read.'], ['Check the changes.', 'Import notes stay attached to your results.'], ['Build your chart.', 'Add melody and refine the tune in the editor.']]
	},
	musescore: {
		name: 'MuseScore', eyebrow: 'From your score to your book', description: 'Keep the melody, changes, and shape of your tune.',
		input: 'Your score', accept: '.mscz,.mscx', formats: 'MSCZ · MSCX', title: 'Bring the whole idea.',
		detail: 'Drop a MuseScore score here. We’ll bring its music into your book.', primary: 'Read score',
		imports: ['Melody & rhythm', 'Chord changes', 'Sections & form'], missing: 'Review the extracted part before adding it to your book.',
		note: 'Transposing parts convert automatically. A score that claims concert pitch defaults to your instrument — pick Concert if it really is a concert chart.',
		guide: [['Bring your score.', 'Open an MSCZ or MSCX file directly.'], ['Check your part.', 'Confirm the extracted staff and source pitch.'], ['Keep the music.', 'Review melody, harmony, and form together.']]
	}
} as const;
export type TuneImportKind = keyof typeof IMPORT_METHODS;
