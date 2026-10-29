<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve, svelte/prefer-writable-derived -- same-page query strings; state is deeply mutated and reset when the server data changes */
	import { goto, refreshAll } from '$app/navigation';
	import { page } from '$app/state';
	import FileDown from '@lucide/svelte/icons/file-down';
	import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import Magnet from '@lucide/svelte/icons/magnet';
	import Maximize from '@lucide/svelte/icons/maximize';
	import Minimize from '@lucide/svelte/icons/minimize';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Route from '@lucide/svelte/icons/route';
	import Save from '@lucide/svelte/icons/save';
	import Spline from '@lucide/svelte/icons/spline';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TextCursorInput from '@lucide/svelte/icons/text-cursor-input';
	import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
	import Workflow from '@lucide/svelte/icons/workflow';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import ListTree from '@lucide/svelte/icons/list-tree';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/app-shell/page-header.svelte';
	import DesignerCanvas, { type ColumnRef } from '#lib/components/designer/designer-canvas.svelte';
	import * as Alert from '#lib/components/ui/alert/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as NativeSelect from '#lib/components/ui/native-select/index.ts';
	import { callAction } from '#lib/forms/call-action.ts';
	import { autoLayout } from '#lib/designer/auto.ts';
	import { cardRect } from '#lib/designer/geometry.ts';
	import { gridLayout, nextFreePosition } from '#lib/designer/layout.ts';
	import { tableHeight, tableWidth } from '#lib/designer/geometry.ts';
	import { settingValue, type DesignerKey, type DesignerView } from '#lib/designer/settings.ts';
	import type { DesignerRelation, Positions } from '#lib/designer/types.ts';
	import { FK_ACTIONS } from '#lib/sql/foreign-key.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let positions = $state<Positions>({});
	let view = $state<DesignerView>({
		angular: false,
		snapToGrid: false,
		relationLines: true,
		fullScreen: false,
		small: false,
		sideMenu: false,
		pinText: false
	});
	let keysOnly = $state(false);
	let collapsed = $state<Record<string, boolean>>({});
	let displayMode = $state(false);
	let selectedRelation = $state<DesignerRelation | null>(null);
	let root: HTMLDivElement | undefined = $state();

	// server data (re)loaded: reset the editable copies (deeply mutated, so not a writable $derived)
	$effect.pre(() => {
		positions = structuredClone($state.snapshot(data.positions));
	});
	$effect.pre(() => {
		view = { ...data.settings };
	});

	const storageReady = $derived(data.pages !== null);
	const shown = $derived(data.tables.filter((t) => positions[t.name]));
	const pathname = $derived(page.url.pathname);

	async function persistSetting(key: DesignerKey) {
		if (!data.settingsAvailable) return;
		await callAction(pathname, 'saveSetting', { key, value: settingValue(key, view) });
	}

	function toggle(key: DesignerKey, field: keyof DesignerView) {
		view[field] = !view[field];
		void persistSetting(key);
	}

	async function toggleFullScreen() {
		view.fullScreen = !view.fullScreen;
		void persistSetting('full_screen');
		try {
			if (view.fullScreen) await root?.requestFullscreen();
			else if (document.fullscreenElement) await document.exitFullscreen();
		} catch {
			// full screen refused: the setting still applies to the layout
		}
	}

	let saving = $state(false);
	async function savePositions(quiet = true) {
		if (!data.persisted || data.pageId === null) return;
		saving = true;
		const res = await callAction(pathname, 'savePositions', {
			page: String(data.pageId),
			positions: JSON.stringify($state.snapshot(positions))
		});
		saving = false;
		if (!res.ok) toast.error(res.message ?? 'The positions could not be saved.');
		else if (!quiet) toast.success('Positions saved.');
	}

	function relayout(kind: 'force' | 'grid') {
		const list = shown;
		if (kind === 'force') {
			positions = autoLayout(list, data.relations);
		} else {
			positions = gridLayout(
				list.map((t) => ({
					name: t.name,
					w: tableWidth(t),
					h: tableHeight(t, { collapsed: false, keysOnly: false })
				}))
			);
		}
		void savePositions();
	}

	function setOnPage(name: string, on: boolean) {
		if (on && !positions[name]) {
			const table = data.tables.find((t) => t.name === name);
			if (!table) return;
			const v = { collapsed: false, keysOnly };
			const rects = shown.map((t) => cardRect(t, positions[t.name], v));
			const size = cardRect(table, { x: 0, y: 0 }, v);
			positions[name] = nextFreePosition(rects, size);
		} else if (!on) {
			delete positions[name];
		}
		void savePositions();
	}

	function setAll(on: boolean) {
		if (on) {
			const missing = data.tables.filter((t) => !positions[t.name]);
			const auto = autoLayout(data.tables, data.relations);
			for (const t of missing) positions[t.name] = auto[t.name];
		} else {
			positions = {};
		}
		void savePositions();
	}

	// --- pages ---
	let pageDialog = $state<'create' | 'rename' | 'delete' | null>(null);
	let pageName = $state('');
	let pageError = $state('');
	const currentPage = $derived(data.pages?.find((p) => p.id === data.pageId) ?? null);

	function openPageDialog(kind: 'create' | 'rename' | 'delete') {
		pageName = kind === 'rename' ? (currentPage?.name ?? '') : '';
		pageError = '';
		pageDialog = kind;
	}

	async function submitPage(e: SubmitEvent) {
		e.preventDefault();
		const kind = pageDialog;
		if (!kind) return;
		const fields: Record<string, string> = {};
		if (kind !== 'create') fields.page = String(data.pageId);
		if (kind !== 'delete') fields.name = pageName;
		const res = await callAction<{ pageId?: number }>(
			pathname,
			kind === 'create' ? 'createPage' : kind === 'rename' ? 'renamePage' : 'deletePage',
			fields
		);
		if (!res.ok) {
			pageError = res.message ?? 'Failed.';
			return;
		}
		pageDialog = null;
		const target = kind === 'delete' ? '' : `?page=${res.data?.pageId ?? data.pageId}`;
		toast.success(
			kind === 'create' ? 'Page created.' : kind === 'rename' ? 'Page renamed.' : 'Page deleted.'
		);
		await goto(`${pathname}${target}`, { invalidateAll: true });
	}

	function choosePage(value: string) {
		void goto(`${pathname}?page=${value}`);
	}

	// --- relations ---
	let connect = $state<{ from: ColumnRef; to: ColumnRef } | null>(null);
	let relKind = $state<'fk' | 'internal'>('fk');
	let relDelete = $state('');
	let relUpdate = $state('');
	let relName = $state('');
	let relError = $state('');
	let relBusy = $state(false);

	const engineOf = (name: string) => data.tables.find((t) => t.name === name)?.engine ?? null;
	const innodb = (e: string | null) => e !== null && /^(innodb|xtradb|pbxt)$/i.test(e);

	function onConnect(from: ColumnRef, to: ColumnRef) {
		relError = '';
		relName = '';
		relDelete = '';
		relUpdate = '';
		const fkOk = innodb(engineOf(from.table)) && innodb(engineOf(to.table));
		relKind = fkOk || !data.storage.relation ? 'fk' : 'internal';
		connect = { from, to };
	}

	async function submitRelation(e: SubmitEvent) {
		e.preventDefault();
		if (!connect) return;
		relBusy = true;
		const payload = {
			kind: relKind,
			fromTable: connect.from.table,
			fromColumn: connect.from.column,
			toTable: connect.to.table,
			toColumn: connect.to.column,
			onDelete: relDelete,
			onUpdate: relUpdate,
			name: relName
		};
		const res = await callAction(pathname, 'createRelation', { payload: JSON.stringify(payload) });
		relBusy = false;
		if (!res.ok) {
			relError = res.message ?? 'Failed.';
			return;
		}
		connect = null;
		toast.success('Relation created.');
		await refreshAll();
	}

	async function removeRelation() {
		const r = selectedRelation;
		if (!r) return;
		relBusy = true;
		const res = await callAction(pathname, 'deleteRelation', {
			payload: JSON.stringify({
				kind: r.kind,
				table: r.fromTable,
				column: r.fromColumn,
				constraint: r.constraint ?? ''
			})
		});
		relBusy = false;
		if (!res.ok) {
			toast.error(res.message ?? 'Failed.');
			return;
		}
		selectedRelation = null;
		toast.success('Relation deleted.');
		await refreshAll();
	}

	async function onColumnClick(ref: ColumnRef) {
		if (!displayMode) return;
		const table = data.tables.find((t) => t.name === ref.table);
		const column = table?.displayField === ref.column ? '' : ref.column;
		const res = await callAction(pathname, 'setDisplay', {
			payload: JSON.stringify({ table: ref.table, column })
		});
		if (!res.ok) toast.error(res.message ?? 'Failed.');
		else
			toast.success(
				column ? `Display column of ${ref.table}: ${column}.` : 'Display column removed.'
			);
		await refreshAll();
	}

	function toggleCollapsed(name: string) {
		collapsed[name] = !collapsed[name];
	}

	// --- export / help ---
	let exportOpen = $state(false);
	let exportFormat = $state<'pdf' | 'svg'>('pdf');
	let helpOpen = $state(false);
	let orientation = $state('L');
	let paper = $state('A4');
	let tableOrder = $state('');

	const toolbar = 'flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1.5 shadow-card';
</script>

<svelte:head><title>Designer - {data.db}</title></svelte:head>

<div class="flex flex-col gap-4" data-testid="designer">
	<PageHeader icon={Workflow} title="Designer" description={data.db}>
		{#snippet actions()}
			{#if storageReady}
				<div class="flex items-center gap-2">
					<Label for="designer-page" class="text-sm text-muted-foreground">Page</Label>
					<NativeSelect.Root
						id="designer-page"
						value={String(data.pageId ?? 0)}
						onchange={(e) => choosePage(e.currentTarget.value)}
						data-testid="designer-page-select"
					>
						<NativeSelect.Option value="0">(automatic layout)</NativeSelect.Option>
						{#each data.pages ?? [] as p (p.id)}
							<NativeSelect.Option value={String(p.id)}>{p.name}</NativeSelect.Option>
						{/each}
					</NativeSelect.Root>
					<Button variant="outline" onclick={() => openPageDialog('create')}>
						<Plus /> New page
					</Button>
					<Button
						variant="outline"
						size="icon"
						aria-label="Rename page"
						disabled={!currentPage}
						onclick={() => openPageDialog('rename')}
					>
						<Pencil />
					</Button>
					<Button
						variant="outline"
						size="icon"
						aria-label="Delete page"
						disabled={!currentPage}
						onclick={() => openPageDialog('delete')}
					>
						<Trash2 />
					</Button>
				</div>
			{/if}
		{/snippet}
	</PageHeader>

	{#if !storageReady}
		<Alert.Root variant="info" data-testid="designer-readonly">
			<Alert.Description>
				The configuration storage tables for pages and table coordinates (pdf_pages, table_coords)
				are not set up. The Designer works read-only with an automatic layout: positions are not
				saved.
			</Alert.Description>
		</Alert.Root>
	{:else if data.pageId === null}
		<Alert.Root variant="info" data-testid="designer-nopage">
			<Alert.Description>
				This is an automatic layout. Create a page to keep table positions.
			</Alert.Description>
		</Alert.Root>
	{/if}
	{#if displayMode}
		<Alert.Root variant="info">
			<Alert.Description>
				Click a column to make it the display column of its table (click again to remove it).
			</Alert.Description>
		</Alert.Root>
	{/if}

	<div bind:this={root} class="flex flex-col gap-3 bg-background" data-testid="designer-root">
		<div class={toolbar} role="toolbar" aria-label="Designer tools">
			{#snippet tool(
				label: string,
				icon: typeof Save,
				active: boolean,
				onclick: () => void,
				disabled = false
			)}
				{@const Icon = icon}
				<Button
					variant={active ? 'secondary' : 'ghost'}
					size={view.pinText ? 'sm' : 'icon-sm'}
					aria-label={label}
					aria-pressed={active}
					title={label}
					{disabled}
					{onclick}
				>
					<Icon />
					{#if view.pinText}{label}{/if}
				</Button>
			{/snippet}
			{@render tool('Save positions', Save, false, () => savePositions(false), !data.persisted)}
			{@render tool('Auto layout', WandSparkles, false, () => relayout('force'))}
			{@render tool('Grid layout', LayoutGrid, false, () => relayout('grid'))}
			<span class="mx-1 h-5 w-px bg-border"></span>
			{@render tool(
				view.relationLines ? 'Hide relation lines' : 'Show relation lines',
				view.relationLines ? Eye : EyeOff,
				!view.relationLines,
				() => toggle('relation_lines', 'relationLines')
			)}
			{@render tool(
				view.angular ? 'Use direct lines' : 'Use angular lines',
				view.angular ? Route : Spline,
				view.angular,
				() => toggle('angular_direct', 'angular')
			)}
			{@render tool('Snap to grid', Magnet, view.snapToGrid, () =>
				toggle('snap_to_grid', 'snapToGrid')
			)}
			{@render tool(
				view.small ? 'Show all columns (big)' : 'Collapse all tables (small)',
				ListTree,
				view.small,
				() => toggle('small_big_all', 'small')
			)}
			{@render tool('Show only keys', Grid3x3, keysOnly, () => (keysOnly = !keysOnly))}
			{@render tool(
				'Choose display column',
				TextCursorInput,
				displayMode,
				() => (displayMode = !displayMode),
				!data.storage.tableInfo
			)}
			{@render tool(
				view.pinText ? 'Hide button labels' : 'Show button labels',
				Pencil,
				view.pinText,
				() => toggle('pin_text', 'pinText')
			)}
			{@render tool(
				view.sideMenu ? 'Table list on the left' : 'Table list on the right',
				LayoutGrid,
				view.sideMenu,
				() => toggle('side_menu', 'sideMenu')
			)}
			{@render tool(
				view.fullScreen ? 'Exit full screen' : 'Full screen',
				view.fullScreen ? Minimize : Maximize,
				view.fullScreen,
				toggleFullScreen
			)}
			<span class="mx-1 h-5 w-px bg-border"></span>
			{@render tool('Export schema', FileDown, false, () => (exportOpen = true))}
			{@render tool('Help', CircleHelp, false, () => (helpOpen = true))}
			{#if saving}<span class="ms-auto px-2 text-xs text-muted-foreground">Saving...</span>{/if}
		</div>

		<div
			class="flex gap-3"
			class:flex-row-reverse={view.sideMenu}
			style:height={view.fullScreen ? 'calc(100vh - 96px)' : 'max(520px, calc(100vh - 360px))'}
		>
			<aside
				class="flex w-60 shrink-0 flex-col rounded-xl border bg-card shadow-card"
				aria-label="Tables"
				data-testid="designer-tables"
			>
				<div class="flex items-center justify-between border-b px-3 py-2">
					<span class="text-sm font-semibold">Tables ({shown.length}/{data.tables.length})</span>
					<div class="flex gap-1">
						<Button variant="ghost" size="xs" onclick={() => setAll(true)}>Add all</Button>
						<Button variant="ghost" size="xs" onclick={() => setAll(false)}>None</Button>
					</div>
				</div>
				<ul class="min-h-0 flex-1 overflow-y-auto p-1">
					{#each data.tables as t (t.name)}
						<li class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
							<Checkbox
								id="designer-tbl-{t.name}"
								checked={!!positions[t.name]}
								onCheckedChange={(v) => setOnPage(t.name, v === true)}
								aria-label="Show table {t.name}"
							/>
							<Label for="designer-tbl-{t.name}" class="min-w-0 flex-1 truncate font-mono text-xs">
								{t.name}
							</Label>
						</li>
					{/each}
					{#if data.tables.length === 0}
						<li class="px-2 py-3 text-sm text-muted-foreground">This database has no tables.</li>
					{/if}
				</ul>
			</aside>
			<div class="min-w-0 flex-1">
				<DesignerCanvas
					tables={data.tables}
					relations={data.relations}
					bind:positions
					{view}
					{keysOnly}
					{collapsed}
					selectedRelation={selectedRelation?.id ?? null}
					onmoveend={() => savePositions()}
					onconnect={onConnect}
					onrelationclick={(r) => (selectedRelation = r)}
					oncolumnclick={onColumnClick}
					ontoggle={toggleCollapsed}
				/>
			</div>
		</div>
	</div>
</div>

<!-- pages -->
<Dialog.Root open={pageDialog !== null} onOpenChange={(o) => !o && (pageDialog = null)}>
	<Dialog.Content>
		<form onsubmit={submitPage} class="flex flex-col gap-4">
			<Dialog.Header>
				<Dialog.Title>
					{pageDialog === 'create'
						? 'New page'
						: pageDialog === 'rename'
							? 'Rename page'
							: 'Delete page'}
				</Dialog.Title>
				<Dialog.Description>
					{#if pageDialog === 'delete'}
						Delete the page "{currentPage?.name}" and the positions of its tables? The tables are
						not affected.
					{:else}
						A new page starts with all tables of the database in an automatic layout.
					{/if}
				</Dialog.Description>
			</Dialog.Header>
			{#if pageDialog !== 'delete'}
				<div class="flex flex-col gap-2">
					<Label for="designer-page-name">Page name</Label>
					<Input
						id="designer-page-name"
						bind:value={pageName}
						maxlength={50}
						placeholder="Page name"
					/>
				</div>
			{/if}
			{#if pageError}<p class="text-sm text-destructive" role="alert">{pageError}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (pageDialog = null)}>Cancel</Button>
				<Button type="submit" variant={pageDialog === 'delete' ? 'destructive' : 'default'}>
					{pageDialog === 'delete' ? 'Delete' : 'Save'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- create relation -->
<Dialog.Root open={connect !== null} onOpenChange={(o) => !o && (connect = null)}>
	<Dialog.Content data-testid="relation-dialog">
		<form onsubmit={submitRelation} class="flex flex-col gap-4">
			<Dialog.Header>
				<Dialog.Title>Create relation</Dialog.Title>
				<Dialog.Description class="font-mono">
					{connect?.from.table}.{connect?.from.column} &rarr; {connect?.to.table}.{connect?.to
						.column}
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-2">
				<Label for="rel-kind">Type</Label>
				<NativeSelect.Root id="rel-kind" bind:value={relKind} class="w-full">
					<NativeSelect.Option value="fk">Foreign key constraint (InnoDB)</NativeSelect.Option>
					{#if data.storage.relation}
						<NativeSelect.Option value="internal">Internal relation</NativeSelect.Option>
					{/if}
				</NativeSelect.Root>
			</div>
			{#if relKind === 'fk'}
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-2">
						<Label for="rel-del">ON DELETE</Label>
						<NativeSelect.Root id="rel-del" bind:value={relDelete} class="w-full">
							{#each FK_ACTIONS as a (a)}
								<NativeSelect.Option value={a}>{a || '(default)'}</NativeSelect.Option>
							{/each}
						</NativeSelect.Root>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="rel-upd">ON UPDATE</Label>
						<NativeSelect.Root id="rel-upd" bind:value={relUpdate} class="w-full">
							{#each FK_ACTIONS as a (a)}
								<NativeSelect.Option value={a}>{a || '(default)'}</NativeSelect.Option>
							{/each}
						</NativeSelect.Root>
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="rel-name">Constraint name</Label>
					<Input
						id="rel-name"
						bind:value={relName}
						maxlength={64}
						placeholder="Constraint name (optional)"
					/>
				</div>
			{/if}
			{#if relError}<p class="text-sm text-destructive" role="alert">{relError}</p>{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (connect = null)}>Cancel</Button>
				<Button type="submit" disabled={relBusy}>Create relation</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- delete relation -->
<Dialog.Root open={selectedRelation !== null} onOpenChange={(o) => !o && (selectedRelation = null)}>
	<Dialog.Content data-testid="relation-delete-dialog">
		<Dialog.Header>
			<Dialog.Title>Delete relation</Dialog.Title>
			<Dialog.Description class="font-mono">
				{selectedRelation?.fromTable}.{selectedRelation?.fromColumn} &rarr; {selectedRelation?.toTable}.{selectedRelation?.toColumn}
			</Dialog.Description>
		</Dialog.Header>
		<p class="text-sm text-muted-foreground">
			{selectedRelation?.kind === 'fk'
				? `The foreign key constraint ${selectedRelation.constraint} will be dropped.`
				: 'The internal relation will be removed from the configuration storage.'}
		</p>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (selectedRelation = null)}>Cancel</Button>
			<Button variant="destructive" disabled={relBusy} onclick={removeRelation}
				>Delete relation</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- export -->
<Dialog.Root bind:open={exportOpen}>
	<Dialog.Content data-testid="export-dialog">
		<form method="GET" action="{pathname}/export" data-sveltekit-reload class="flex flex-col gap-4">
			<Dialog.Header>
				<Dialog.Title>Export schema</Dialog.Title>
				<Dialog.Description>
					Exports {currentPage ? `the page "${currentPage.name}"` : 'the automatic layout'} with the positions
					shown here. Dia and EPS are not offered.
				</Dialog.Description>
			</Dialog.Header>
			<input type="hidden" name="page" value={data.pageId ?? 0} />
			<input type="hidden" name="download" value="1" />
			<div class="flex flex-col gap-2">
				<Label for="export-format">Format</Label>
				<NativeSelect.Root
					id="export-format"
					name="format"
					bind:value={exportFormat}
					class="w-full"
				>
					<NativeSelect.Option value="pdf">PDF</NativeSelect.Option>
					<NativeSelect.Option value="svg">SVG</NativeSelect.Option>
				</NativeSelect.Root>
			</div>
			<div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
				{#snippet opt(name: string, label: string, checked = false)}
					<div class="flex items-center gap-2">
						<Checkbox id="export-{name}" {name} value="1" {checked} />
						<Label for="export-{name}">{label}</Label>
					</div>
				{/snippet}
				{@render opt('show_color', 'Show color', true)}
				{@render opt('show_grid', 'Show grid')}
				{@render opt('show_keys', 'Display only keys')}
				{@render opt('all_tables_same_width', 'Same width for all tables')}
				{@render opt('show_table_dimension', 'Show dimension of tables')}
				{#if exportFormat === 'pdf'}
					{@render opt('with_doc', 'Data dictionary')}
				{/if}
			</div>
			{#if exportFormat === 'pdf'}
				<div class="grid grid-cols-3 gap-3">
					<div class="flex flex-col gap-2">
						<Label for="export-orientation">Orientation</Label>
						<NativeSelect.Root
							id="export-orientation"
							name="orientation"
							bind:value={orientation}
							class="w-full"
						>
							<NativeSelect.Option value="L">Landscape</NativeSelect.Option>
							<NativeSelect.Option value="P">Portrait</NativeSelect.Option>
						</NativeSelect.Root>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="export-paper">Paper size</Label>
						<NativeSelect.Root id="export-paper" name="paper" bind:value={paper} class="w-full">
							{#each ['A3', 'A4', 'A5', 'letter', 'legal'] as p (p)}
								<NativeSelect.Option value={p}>{p}</NativeSelect.Option>
							{/each}
						</NativeSelect.Root>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="export-order">Order of the tables</Label>
						<NativeSelect.Root
							id="export-order"
							name="table_order"
							bind:value={tableOrder}
							class="w-full"
						>
							<NativeSelect.Option value="">None</NativeSelect.Option>
							<NativeSelect.Option value="name_asc">Name (Ascending)</NativeSelect.Option>
							<NativeSelect.Option value="name_desc">Name (Descending)</NativeSelect.Option>
						</NativeSelect.Root>
					</div>
				</div>
			{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (exportOpen = false)}>Cancel</Button>
				<Button type="submit" onclick={() => setTimeout(() => (exportOpen = false), 200)}
					>Export</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- help -->
<Dialog.Root bind:open={helpOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Designer help</Dialog.Title>
		</Dialog.Header>
		<ul class="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
			<li>Drag a table header to move it; drag the background to pan, Ctrl + wheel to zoom.</li>
			<li>Drag from a column onto a column of another table to create a relation.</li>
			<li>
				Click a relation line to delete it. Solid lines are foreign keys, dashed lines internal
				relations.
			</li>
			<li>Choose the display column of a table with the text cursor tool, then click a column.</li>
			<li>
				Positions are saved on the current page. The query builder of phpMyAdmin is not available.
			</li>
		</ul>
	</Dialog.Content>
</Dialog.Root>
