/** Bounded, serialized editor snapshots; selection and audio never enter history. */
export class EditorHistory {
	private current: string | null = null;
	private past: string[] = [];
	private future: string[] = [];

	get canUndo(): boolean { return this.past.length > 0; }
	get canRedo(): boolean { return this.future.length > 0; }

	/** Record a content change. Restoring the current snapshot is a no-op. */
	record(snapshot: string): boolean {
		if (snapshot === this.current) return false;
		if (this.current !== null) this.past = [...this.past.slice(-49), this.current];
		this.current = snapshot;
		this.future = [];
		return true;
	}

	/** Move backward without retaining mutable references to the live note buffer. */
	undo(): string | null {
		if (!this.past.length || this.current === null) return null;
		this.future.push(this.current);
		this.current = this.past.pop()!;
		return this.current;
	}

	/** Restore the next edit; a new recorded edit discards this branch. */
	redo(): string | null {
		if (!this.future.length || this.current === null) return null;
		this.past.push(this.current);
		this.current = this.future.pop()!;
		return this.current;
	}

	/** New save/edit targets start a fresh history, never another lick's snapshots. */
	reset(): void {
		this.current = null;
		this.past = [];
		this.future = [];
	}
}
