<script lang="ts">
	import Star from '@lucide/svelte/icons/star';
	import { getQuickAccess } from '#lib/components/navigation/quick-access.svelte.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { cn } from '#lib/utils.ts';

	interface Props {
		db: string;
		table: string;
		class?: string;
	}

	let { db, table, class: className }: Props = $props();

	const quick = getQuickAccess();
	const favorite = $derived(quick.isFavorite(db, table));
	const label = $derived(favorite ? `Remove ${table} from favorites` : `Add ${table} to favorites`);
</script>

<Button
	variant="ghost"
	size="icon-sm"
	class={cn('shrink-0', className)}
	aria-label={label}
	aria-pressed={favorite}
	title={favorite ? 'Remove from favorites' : 'Add to favorites'}
	data-testid="favorite-{table}"
	onclick={() => void quick.toggleFavorite(db, table)}
>
	<Star class={cn('size-4', favorite && 'fill-warning text-warning')} />
</Button>
