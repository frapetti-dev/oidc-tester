<script lang="ts">
	interface Props {
		/** Width in px; the height is 3/4 of it. */
		size?: number;
		/** Draws the three bars in from the left once, staggered. Off under reduced motion. */
		animate?: boolean;
	}

	let { size = 16, animate = false }: Props = $props();
</script>

<svg
	width={size}
	height={size * 0.75}
	viewBox="0 0 16 12"
	aria-hidden="true"
	class="shrink-0"
	class:animate
>
	<rect x="5" y="0" width="6" height="3" rx="1.5" class="mark-bar fill-jwt-header" style="--i: 0" />
	<rect
		x="0"
		y="4.5"
		width="16"
		height="3"
		rx="1.5"
		class="mark-bar fill-jwt-payload"
		style="--i: 1"
	/>
	<rect
		x="5"
		y="9"
		width="6"
		height="3"
		rx="1.5"
		class="mark-bar fill-jwt-signature"
		style="--i: 2"
	/>
</svg>

<style>
	@media (prefers-reduced-motion: no-preference) {
		.animate .mark-bar {
			transform-box: fill-box;
			transform-origin: left center;
			animation: mark-draw 240ms ease-out both;
			animation-delay: calc(var(--i) * 80ms);
		}
	}

	@keyframes mark-draw {
		from {
			transform: scaleX(0);
		}
		to {
			transform: scaleX(1);
		}
	}
</style>
