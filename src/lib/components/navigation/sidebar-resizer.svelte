<script lang="ts">
	import {
		MAX_SIDEBAR_WIDTH,
		MIN_SIDEBAR_WIDTH,
		type SidebarWidth
	} from './sidebar-width.svelte.ts';

	let { width }: { width: SidebarWidth } = $props();

	let dragging = $state(false);

	function start(event: PointerEvent) {
		dragging = true;
		document.documentElement.dataset.resizing = '';
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function move(event: PointerEvent) {
		if (dragging) width.set(event.clientX);
	}

	function stop(event: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		delete document.documentElement.dataset.resizing;
		(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
		width.save();
	}

	function key(event: KeyboardEvent) {
		const step = event.shiftKey ? 48 : 16;
		if (event.key === 'ArrowLeft') width.set(width.value - step);
		else if (event.key === 'ArrowRight') width.set(width.value + step);
		else return;
		event.preventDefault();
		width.save();
	}
</script>

<!-- A focusable separator is the WAI-ARIA "window splitter" pattern. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	role="separator"
	aria-orientation="vertical"
	aria-label="Resize navigation"
	aria-valuenow={width.value}
	aria-valuemin={MIN_SIDEBAR_WIDTH}
	aria-valuemax={MAX_SIDEBAR_WIDTH}
	tabindex="0"
	class="absolute inset-y-0 end-0 z-20 w-1.5 cursor-col-resize touch-none outline-hidden transition-colors hover:bg-sidebar-border focus-visible:bg-sidebar-ring data-[dragging=true]:bg-sidebar-ring"
	data-dragging={dragging}
	onpointerdown={start}
	onpointermove={move}
	onpointerup={stop}
	onpointercancel={stop}
	onkeydown={key}
></div>
