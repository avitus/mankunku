// Performed bar numbers are one-based, including the Blues head's four-bar intro.
// Keep cues attached to the loaded recipe. A fresh arc can choose different notes.
function cue(first: number, note: string, last = first) { return { first, last, note }; }
export type ListeningCue = ReturnType<typeof cue>;
export const listeningGuides = {
 'eighth-anticipation': [cue(18, 'Bass G, then G on one.'), cue(22, 'Bass E, then E on one.'), cue(78, 'Bass C before one.')],
 'quarter-anticipation': [cue(3, 'Bass C on four.'), cue(23, 'Bass A on four.'), cue(92, 'Bass D before D minor.')],
 'ride-triplet': [cue(18, 'Three ride strokes over two beats.'), cue(31, 'The ride triplet returns.')],
 'bossa-handoff': [cue(18, 'Sing the bass call.', 19), cue(20, 'Follow the keyboard answer.', 21)],
 'ballad-handoff': [cue(32, 'Follow the keyboard’s top voice.', 34), cue(35, 'Bass takes over on three.', 37)],
 'keyboard-handoff': [cue(17, 'Sing the five-note bass line.', 18), cue(19, 'Hear it in the keyboard.', 21)],
 'melodic-handoff': [cue(34, 'Follow the top keyboard note.', 36), cue(37, 'Bass echoes the contour.')],
 'displaced-answer': [cue(23, 'Tap the keyboard’s two accents.'), cue(25, 'Snare answers a beat later.')],
 'rhythm-memory': [cue(31, 'Ride accents two and three.'), cue(33, 'Bass answers on two and four.'), cue(39, 'Keys answer on the offbeats.')],
 'ballad-solo': [cue(21, 'Bass rises. Keys answer on four.', 22), cue(30, 'Hear the exchange return.')],
 straight: [cue(6, 'Listen for the extra bass pluck.', 7), cue(46, 'The broken two returns.', 47)],
 swing: [51, 53, 55].map(bar => cue(bar, 'Ride bell catches the offbeat.')),
 ballad: [cue(47, 'Keys move over the held bass.', 48)],
 'bossa-nova': [cue(34, 'High bass pickup, then keys.'), cue(37, 'Listen for the second reply.')]
};
export type ListeningExample = keyof typeof listeningGuides;
