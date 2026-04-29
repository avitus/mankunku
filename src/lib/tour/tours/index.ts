import type { DriveStep } from 'driver.js';
import { welcomeTour } from './welcome';
import { earTrainingTour } from './ear-training';
import { lickPracticeTour } from './lick-practice';
import { libraryTour } from './library';

export interface TourDefinition {
	id: string;
	title: string;
	/** Path the tour assumes the user is on. UI may navigate first. */
	startsAt: string;
	steps: DriveStep[];
}

export const TOURS: TourDefinition[] = [
	{ id: 'welcome', title: 'Welcome to Mankunku', startsAt: '/', steps: welcomeTour },
	{ id: 'ear-training', title: 'Ear Training', startsAt: '/practice', steps: earTrainingTour },
	{ id: 'lick-practice', title: 'Lick Practice', startsAt: '/lick-practice', steps: lickPracticeTour },
	{ id: 'library', title: 'Library', startsAt: '/library', steps: libraryTour }
];

export function getTour(tourId: string): TourDefinition | undefined {
	return TOURS.find((t) => t.id === tourId);
}

export { welcomeTour, earTrainingTour, lickPracticeTour, libraryTour };
