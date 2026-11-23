import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { type ApiContext, apiRequest } from './transport';
import type { FormatView } from './types';

/** The formats Converter Studio converts from, with what each converts to (`GET /v1/formats`). */
export async function listFormats(
	this: ApiContext,
	from?: string,
	itemIndex?: number,
): Promise<FormatView[]> {
	const response = (await apiRequest.call(this, {
		method: 'GET',
		path: '/formats',
		qs: from ? { from } : undefined,
		idempotent: true,
		itemIndex,
	})) as { formats: FormatView[] };
	return response.formats;
}

/** The format a file name or link ends in, if one of the formats has that extension. */
export function formatOfName(name: string, formats: FormatView[]): FormatView | undefined {
	let path = name.trim().toLowerCase();
	try {
		path = decodeURIComponent(new URL(path).pathname);
	} catch {
		// Not a link: a plain file name.
	}
	const base = path.split('/').pop() ?? '';
	// Longest extensions first, so "tar.gz" wins over "gz".
	const candidates = formats
		.flatMap((format) => format.extensions.map((extension) => ({ format, extension })))
		.sort((a, b) => b.extension.length - a.extension.length);
	return candidates.find(({ extension }) => base.endsWith(`.${extension}`))?.format;
}

const byName = (a: INodePropertyOptions, b: INodePropertyOptions) => a.name.localeCompare(b.name);

/** Every format as a dropdown option. */
export function formatOptions(formats: FormatView[]): INodePropertyOptions[] {
	return formats
		.map((format) => ({
			name: format.name,
			value: format.id,
			description: `${format.category[0].toUpperCase()}${format.category.slice(1)}, converts to ${format.to.length} formats`,
		}))
		.sort(byName);
}

/**
 * The target formats: what `from` converts to, or every target when the source isn't known (each
 * one then says that the pair is checked when the node runs).
 */
export function targetOptions(formats: FormatView[], from?: FormatView): INodePropertyOptions[] {
	const known = new Map(formats.map((format) => [format.id, format]));
	const targets = new Set(from ? from.to : formats.flatMap((format) => format.to));
	return [...targets]
		.map((id) => {
			const format = known.get(id);
			const category = format?.category ?? 'file';
			return {
				name: format?.name ?? id.toUpperCase(),
				value: id,
				description: from
					? `${from.name} to ${format?.name ?? id.toUpperCase()}`
					: `${category[0].toUpperCase()}${category.slice(1)}, checked against the file when the node runs`,
			};
		})
		.sort(byName);
}

/**
 * The source format the editor can see: that of a link in 'File URL' (written out, or an
 * expression the editor resolved). A binary file, an expression the editor can't resolve yet (it
 * arrives as `null`, or unresolved) and a link an AI agent fills in at run time (`$fromAI`) have
 * none.
 */
export function editorSource(
	source: unknown,
	url: unknown,
	formats: FormatView[],
): FormatView | undefined {
	if (source !== 'url' || typeof url !== 'string' || url.startsWith('=')) return undefined;
	return formatOfName(url, formats);
}

export async function getTargetFormats(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const formats = await listFormats.call(this);
	let from: FormatView | undefined;
	try {
		from = editorSource(
			this.getCurrentNodeParameter('source'),
			this.getCurrentNodeParameter('url'),
			formats,
		);
	} catch {
		// The parameters can't be read: every target.
	}
	return targetOptions(formats, from);
}

export async function getSourceFormats(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return formatOptions(await listFormats.call(this));
}
