import type { DriveStep } from 'driver.js';
import { welcomeTour } from './welcome';
import { earTrainingTour } from './ear-training';
import { lickPracticeTour } from './lick-practice';
import { licksTour } from './licks';

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
	{ id: 'licks', title: 'Library', startsAt: '/licks', steps: licksTour }
];

export function getTour(tourId: string): TourDefinition | undefined {
	return TOURS.find((t) => t.id === tourId);
}

export { welcomeTour, earTrainingTour, lickPracticeTour, licksTour };
