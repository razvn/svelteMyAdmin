/**
 * OASIS OpenDocument container, mirroring libraries/classes/OpenDocument.php (`OpenDocument::create`).
 * Shared by the `ods` and `odt` export plugins.
 */
import { zipSync, strToU8 } from 'fflate';
import type { ExportCell, ExportField } from '#lib/server/export/types.ts';

/** Namespaces (OpenDocument::NS). `svg` is added: styles.xml uses `svg:font-family`, PHP never declares it. */
export const NS = [
	'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
	'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
	'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
	'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
	'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"',
	'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
	'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"'
].join('\n');

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

/** PHP `htmlspecialchars` (ENT_QUOTES) plus removal of characters illegal in XML 1.0. */
export function escapeXml(value: string): string {
	return (
		value
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;')
	);
}

export function stringCell(text: string): string {
	return `<table:table-cell office:value-type="string"><text:p>${escapeXml(text)}</text:p></table:table-cell>`;
}

export function floatCell(raw: string): string {
	return `<table:table-cell office:value-type="float" office:value="${escapeXml(raw)}" ><text:p>${escapeXml(raw)}</text:p></table:table-cell>`;
}

export function isBlobField(field: ExportField): boolean {
	return field.isBinary && /blob/.test(field.type);
}

/**
 * Text of a data cell: NULL replacement, GIS and other binary values as `0x` hex,
 * BLOB as empty (PHP "ignore BLOB").
 */
export function cellText(field: ExportField, cell: ExportCell, nullText: string): string {
	if (cell === null) return nullText;
	if (isBlobField(field)) return '';
	if (Buffer.isBuffer(cell)) return '0x' + cell.toString('hex');
	return cell;
}

/** Wrap content.xml into a complete ODF package; mimetype first and stored (level 0). */
export function createOpenDocument(
	mime: string,
	content: string,
	appVersion: string,
	now: Date
): Uint8Array {
	const created = now.toISOString().replace(/\.\d+Z$/, '+00:00');
	const meta =
		XML_DECL +
		'<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
		'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.0">' +
		'<office:meta>' +
		`<meta:generator>svelteMyAdmin ${escapeXml(appVersion)}</meta:generator>` +
		`<meta:initial-creator>svelteMyAdmin ${escapeXml(appVersion)}</meta:initial-creator>` +
		`<meta:creation-date>${created}</meta:creation-date>` +
		'</office:meta></office:document-meta>';
	const manifest =
		XML_DECL +
		'<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">' +
		`<manifest:file-entry manifest:media-type="${mime}" manifest:full-path="/"/>` +
		'<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/>' +
		'<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="meta.xml"/>' +
		'<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="styles.xml"/>' +
		'</manifest:manifest>';
	const stored = { level: 0 as const };
	return zipSync({
		mimetype: [strToU8(mime), stored],
		'content.xml': strToU8(content),
		'meta.xml': strToU8(meta),
		'styles.xml': strToU8(STYLES),
		'META-INF/manifest.xml': strToU8(manifest)
	});
}

const STYLES =
	XML_DECL +
	`<office:document-styles ${NS} office:version="1.0">` +
	'<office:font-face-decls>' +
	`<style:font-face style:name="Arial Unicode MS" svg:font-family="'Arial Unicode MS'" style:font-pitch="variable"/>` +
	`<style:font-face style:name="DejaVu Sans1" svg:font-family="'DejaVu Sans'" style:font-pitch="variable"/>` +
	`<style:font-face style:name="HG Mincho Light J" svg:font-family="'HG Mincho Light J'" style:font-pitch="variable"/>` +
	`<style:font-face style:name="DejaVu Serif" svg:font-family="'DejaVu Serif'" style:font-family-generic="roman" style:font-pitch="variable"/>` +
	'<style:font-face style:name="Thorndale" svg:font-family="Thorndale" style:font-family-generic="roman" style:font-pitch="variable"/>' +
	`<style:font-face style:name="DejaVu Sans" svg:font-family="'DejaVu Sans'" style:font-family-generic="swiss" style:font-pitch="variable"/>` +
	'</office:font-face-decls>' +
	'<office:styles>' +
	'<style:default-style style:family="paragraph">' +
	'<style:paragraph-properties fo:hyphenation-ladder-count="no-limit" style:text-autospace="ideograph-alpha" style:punctuation-wrap="hanging" style:line-break="strict" style:tab-stop-distance="0.4925in" style:writing-mode="page"/>' +
	'<style:text-properties style:use-window-font-color="true" style:font-name="DejaVu Serif" fo:font-size="12pt" fo:language="en" fo:country="US" style:font-name-asian="DejaVu Sans1" style:font-size-asian="12pt" style:language-asian="none" style:country-asian="none" style:font-name-complex="DejaVu Sans1" style:font-size-complex="12pt" style:language-complex="none" style:country-complex="none" fo:hyphenate="false" fo:hyphenation-remain-char-count="2" fo:hyphenation-push-char-count="2"/>' +
	'</style:default-style>' +
	'<style:style style:name="Standard" style:family="paragraph" style:class="text"/>' +
	'<style:style style:name="Text_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard" style:class="text">' +
	'<style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0.0835in"/>' +
	'</style:style>' +
	'<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Text_body" style:class="text">' +
	'<style:paragraph-properties fo:margin-top="0.1665in" fo:margin-bottom="0.0835in" fo:keep-with-next="always"/>' +
	'<style:text-properties style:font-name="DejaVu Sans" fo:font-size="14pt" style:font-name-asian="DejaVu Sans1" style:font-size-asian="14pt" style:font-name-complex="DejaVu Sans1" style:font-size-complex="14pt"/>' +
	'</style:style>' +
	'<style:style style:name="Heading_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_body" style:class="text" style:default-outline-level="1">' +
	'<style:text-properties style:font-name="Thorndale" fo:font-size="24pt" fo:font-weight="bold" style:font-name-asian="HG Mincho Light J" style:font-size-asian="24pt" style:font-weight-asian="bold" style:font-name-complex="Arial Unicode MS" style:font-size-complex="24pt" style:font-weight-complex="bold"/>' +
	'</style:style>' +
	'<style:style style:name="Heading_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_body" style:class="text" style:default-outline-level="2">' +
	'<style:text-properties style:font-name="DejaVu Serif" fo:font-size="18pt" fo:font-weight="bold" style:font-name-asian="DejaVu Sans1" style:font-size-asian="18pt" style:font-weight-asian="bold" style:font-name-complex="DejaVu Sans1" style:font-size-complex="18pt" style:font-weight-complex="bold"/>' +
	'</style:style>' +
	'</office:styles>' +
	'<office:automatic-styles>' +
	'<style:page-layout style:name="pm1">' +
	'<style:page-layout-properties fo:page-width="8.2673in" fo:page-height="11.6925in" style:num-format="1" style:print-orientation="portrait" fo:margin-top="1in" fo:margin-bottom="1in" fo:margin-left="1.25in" fo:margin-right="1.25in" style:writing-mode="lr-tb" style:footnote-max-height="0in">' +
	'<style:footnote-sep style:width="0.0071in" style:distance-before-sep="0.0398in" style:distance-after-sep="0.0398in" style:adjustment="left" style:rel-width="25%" style:color="#000000"/>' +
	'</style:page-layout-properties>' +
	'<style:header-style/><style:footer-style/>' +
	'</style:page-layout>' +
	'</office:automatic-styles>' +
	'<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>' +
	'</office:document-styles>';
