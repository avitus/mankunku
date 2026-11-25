import { FLY_ME_TO_THE_MOON } from './scenarios/fly-me-to-the-moon';
import { ALL_THE_THINGS_YOU_ARE } from './scenarios/all-the-things-you-are';

/** Fixed test charts for the listening desk. Account-owned tune books have their own identities. */
export const LISTENING_SCENARIOS = [
 { tune: FLY_ME_TO_THE_MOON, maxSolos: 2, description: 'The production chart has two 16-bar sections in concert C.' },
 { tune: ALL_THE_THINGS_YOU_ARE, maxSolos: 1, description: 'Start at the first Fm7 after the unaccompanied intro. The 36-bar chorus fits one solo between the two heads.' }
];
