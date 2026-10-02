export interface DebouncedSaver<T> {
	/** Replace the pending value and restart the timer. */
	schedule(value: T): void;
	/** Write the pending value now (no-op when nothing is pending). */
	flush(): Promise<void>;
	/** Drop the pending value. */
	cancel(): void;
}

export function createDebouncedSaver<T>(
	save: (value: T) => Promise<void>,
	delayMs: number
): DebouncedSaver<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: { value: T } | null = null;

	const run = async () => {
		timer = undefined;
		const current = pending;
		pending = null;
		if (current) await save(current.value);
	};

	return {
		schedule(value) {
			pending = { value };
			clearTimeout(timer);
			timer = setTimeout(() => void run(), delayMs);
		},
		async flush() {
			clearTimeout(timer);
			await run();
		},
		cancel() {
			clearTimeout(timer);
			timer = undefined;
			pending = null;
		}
	};
}
