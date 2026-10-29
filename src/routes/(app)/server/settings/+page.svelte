<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, tick } from 'svelte';
	import Download from '@lucide/svelte/icons/download';
	import HardDriveDownload from '@lucide/svelte/icons/hard-drive-download';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Upload from '@lucide/svelte/icons/upload';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import { hydration } from '#lib/hooks/hydration.svelte.ts';
	import { N_, useI18n } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	const { t, tn } = useI18n();
	let { data, form }: PageProps = $props();

	const BROWSER_KEY = 'sma.userprefs';

	let resetOpen = $state(false);
	let resetForm = $state<HTMLFormElement>();
	let importForm = $state<HTMLFormElement>();
	let jsonText = $state('');
	let importMode = $state<'file' | 'browser'>('file');
	let browserSaved = $state<string | null>(null);
	let browserMsg = $state('');

	onMount(() => {
		try {
			browserSaved = localStorage.getItem(BROWSER_KEY) ? 'yes' : null;
		} catch {
			browserSaved = null;
		}
	});

	function saveToBrowser() {
		try {
			localStorage.setItem(BROWSER_KEY, data.json);
			browserSaved = 'yes';
			browserMsg = t('Configuration saved to the browser storage.');
		} catch {
			browserMsg = t('The browser storage is not available.');
		}
	}

	function readBrowser(): string | null {
		try {
			return localStorage.getItem(BROWSER_KEY);
		} catch {
			return null;
		}
	}

	async function loadFromBrowser() {
		const raw = readBrowser();
		if (!raw) {
			browserMsg = t('Nothing is saved in the browser storage.');
			return;
		}
		jsonText = raw;
		importMode = 'browser';
		// let the textarea reflect the state before the form is serialized
		await tick();
		importForm?.requestSubmit();
	}

	const err = $derived(form && 'error' in form ? (form.error as string) : null);
	const messages: Record<string, string> = {
		import: N_('Configuration has been imported.'),
		reset: N_('All your settings were reset to the defaults.')
	};
</script>

<svelte:head>
	<title>{t('Manage your settings')} - {t('Settings')} - svelteMyAdmin</title>
</svelte:head>

<div class="flex flex-col gap-6">
	{#if data.saved && messages[data.saved]}
		<Alert variant="success" role="status" data-testid="settings-saved">
			<AlertDescription>{t(messages[data.saved])}</AlertDescription>
		</Alert>
	{/if}
	{#if data.dropped}
		<Alert variant="warning" role="status" data-testid="settings-dropped">
			<AlertDescription
				>{t('Ignored (not allowed or invalid): {names}', { names: data.dropped })}</AlertDescription
			>
		</Alert>
	{/if}
	{#if err}
		<Alert variant="destructive" role="alert" data-testid="settings-error">
			<AlertDescription>{err}</AlertDescription>
		</Alert>
	{/if}
	{#if data.storage.unavailable}
		<Alert variant="warning" role="status">
			<AlertTitle>{t('Configuration storage unavailable')}</AlertTitle>
			<AlertDescription>
				{t('The user preferences table could not be read; settings are kept in a browser cookie.')}
			</AlertDescription>
		</Alert>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>{t('Where your settings are stored')}</Card.Title>
			<Card.Description>
				{#if data.storage.type === 'db'}
					{t('In the phpMyAdmin configuration storage (pma__userconfig), shared with phpMyAdmin.')}
				{:else}
					{t(
						'In a browser cookie, because no configuration storage is available for user preferences.'
					)}
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex items-center gap-2 text-sm">
			<Badge variant={data.count > 0 ? 'primary' : 'muted'} data-testid="settings-count">
				{tn('{n} customised setting', '{n} customised settings', data.count)}
			</Badge>
			<Badge variant="muted">{data.storage.type === 'db' ? t('Database') : t('Cookie')}</Badge>
		</Card.Content>
	</Card.Root>

	<div class="grid gap-6 lg:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Import')}</Card.Title>
				<Card.Description>
					{t('Load settings from a JSON file exported by this application or phpMyAdmin.')}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form
					bind:this={importForm}
					method="POST"
					action="?/import"
					enctype="multipart/form-data"
					use:enhance
					class="flex flex-col gap-4"
					data-testid="import-form"
				>
					{#if importMode === 'browser'}
						<Textarea name="json" bind:value={jsonText} rows={6} aria-label={t('Settings JSON')} />
					{:else}
						<label class="flex flex-col gap-1.5 text-sm font-medium">
							{t('Settings file')}
							<Input type="file" name="import_file" accept=".json,application/json" required />
						</label>
					{/if}
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" name="import_merge" value="1" data-testid="import-merge" />
						{t('Merge with current configuration')}
					</label>
					<div>
						<Button type="submit" disabled={!hydration.ready} data-testid="import-submit">
							<Upload />
							{t('Import')}
						</Button>
					</div>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>{t('Export')}</Card.Title>
				<Card.Description>{t('Save your settings to a JSON file.')}</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<div>
					<Button
						href="/server/settings/file"
						data-sveltekit-reload
						download
						data-testid="export-json"
					>
						<Download />
						{t('Save as JSON file')}
					</Button>
				</div>
				<div class="flex flex-col gap-2 border-t pt-4">
					<p class="text-sm font-medium">{t('Browser storage')}</p>
					<p class="text-sm text-muted-foreground">
						{t(
							"Keep a copy of your settings in this browser's local storage and load it back later."
						)}
					</p>
					<div class="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="outline"
							onclick={saveToBrowser}
							data-testid="save-browser"
						>
							<HardDriveDownload />
							{t("Save to browser's storage")}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={!browserSaved}
							onclick={loadFromBrowser}
							data-testid="load-browser"
						>
							{t("Load from browser's storage")}
						</Button>
					</div>
					{#if browserMsg}
						<p class="text-sm text-muted-foreground" role="status">{browserMsg}</p>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title>{t('Reset')}</Card.Title>
			<Card.Description>
				{t('Remove all your customisations and go back to the server defaults.')}
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<Button
				type="button"
				variant="destructive"
				onclick={() => (resetOpen = true)}
				data-testid="reset-all"
			>
				<RotateCcw />
				{t('Reset all settings')}
			</Button>
		</Card.Content>
	</Card.Root>
</div>

<AlertDialog.Root bind:open={resetOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{t('Reset all settings')}</AlertDialog.Title>
			<AlertDialog.Description>
				{t('This clears every personal setting and restores the server defaults.')}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<form
			bind:this={resetForm}
			method="POST"
			action="?/reset"
			use:enhance={() => {
				return async ({ update }) => {
					await update();
					resetOpen = false;
				};
			}}
		></form>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{t('Cancel')}</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				data-testid="reset-confirm"
				onclick={(e: MouseEvent) => {
					e.preventDefault();
					resetForm?.requestSubmit();
				}}
			>
				{t('Reset')}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
