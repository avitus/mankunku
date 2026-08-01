import type { DriveStep } from 'driver.js';
import { welcomeTour } from './welcome';
import { earTrainingTour } from './ear-training';
import { lickPracticeTour } from './lick-practice';
import { licksTour } from './licks';
import { tunesTour } from './tunes';
import { tunePracticeTour } from './tune-practice';

export interface TourDefinition {
	id: string;
	title: string;
	/** Path the tour assumes the user is on. UI may navigate first. */
	startsAt: string;
	steps: DriveStep[];
}

export const TOURS: TourDefinition[] = [
	{ id: 'welcome', title: 'Welcome to Mankunku', startsAt: '/', steps: welcomeTour },
	{ id: 'ear-training', title: 'Ear Training', startsAt: '/ear-training', steps: earTrainingTour },
	{ id: 'lick-practice', title: 'Lick Practice', startsAt: '/lick-practice', steps: lickPracticeTour },
	{ id: 'licks', title: 'Your Licks', startsAt: '/licks', steps: licksTour },
	{ id: 'tunes', title: 'Your Tunes', startsAt: '/tunes', steps: tunesTour },
	// The scored session lives at /tunes/<id>/practice — no static path to
	// navigate to, so this tour starts where you reach it from and its steps
	// are element-free (see tune-practice.ts).
	{ id: 'tune-practice', title: 'Playing Over Tunes', startsAt: '/tunes', steps: tunePracticeTour }
];

export function getTour(tourId: string): TourDefinition | undefined {
	return TOURS.find((t: TourDefinition) => t.id === tourId);
}

export {
	welcomeTour,
	earTrainingTour,
	lickPracticeTour,
	licksTour,
	tunesTour,
	tunePracticeTour
};
