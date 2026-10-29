/** Client-safe model of the transformation fields of the column editor. */
import {
	inputChoices,
	inputKey,
	mimeTypes,
	mimeValue,
	outputChoices,
	outputKey,
	resolveInput,
	resolveOutput,
	type TransformationChoice
} from './registry.ts';

export interface ColumnTransformSettings {
	mimetype: string;
	transformation: string;
	transformation_options: string;
	input_transformation: string;
	input_transformation_options: string;
}

export interface TransformChoices {
	mimeTypes: { value: string; label: string }[];
	outputs: TransformationChoice[];
	inputs: TransformationChoice[];
}

export const emptySettings = (): ColumnTransformSettings => ({
	mimetype: '',
	transformation: '',
	transformation_options: '',
	input_transformation: '',
	input_transformation_options: ''
});

export function transformChoices(): TransformChoices {
	return {
		mimeTypes: mimeTypes().map((m) => ({ value: mimeValue(m), label: m.toLowerCase() })),
		outputs: outputChoices(),
		inputs: inputChoices()
	};
}

/** Stored values in the canonical spelling the selects use. */
export function canonicalSettings(row: ColumnTransformSettings): ColumnTransformSettings {
	const out = resolveOutput(row.transformation);
	const inp = resolveInput(row.input_transformation);
	return {
		...row,
		mimetype: row.mimetype ? mimeValue(row.mimetype) : '',
		transformation: out ? outputKey(out) : '',
		input_transformation: inp ? inputKey(inp) : ''
	};
}
