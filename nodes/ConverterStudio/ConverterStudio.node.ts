import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { nodeProperties } from './descriptions';
import { buildConversionOptions } from './descriptions/conversionOptions';
import {
	conversionFailed,
	conversionId,
	conversionQuoted,
	downloadResult,
	getConversion,
	simplifyConversion,
	waitForConversion,
} from './shared/conversion';
import { getSourceFormats, getTargetFormats, listFormats } from './shared/formats';
import { type ConversionAttempt, conversionAttempt } from './shared/idempotency';
import { apiRequest, codeOf } from './shared/transport';
import { type UploadSource, uploadFile } from './shared/upload';
import type { AccountView, ConversionView, FormatView } from './shared/types';

type Operation =
	'file:convert' | 'conversion:get' | 'conversion:confirm' | 'account:get' | 'format:getAll';

/** Statuses after which a started or confirmed conversion has no result. */
const ENDED_WITHOUT_RESULT = new Set(['failed', 'expired', 'canceled']);

export class ConverterStudio implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Converter Studio',
		name: 'converterStudio',
		icon: {
			light: 'file:../../icons/converterStudio.svg',
			dark: 'file:../../icons/converterStudio.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Convert video, audio, images, PDFs, documents, e-books and more (67 formats) with Converter Studio',
		defaults: {
			name: 'Converter Studio',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'converterStudioApi',
				required: true,
			},
		],
		properties: nodeProperties,
	};

	methods = {
		loadOptions: {
			getSourceFormats,
			getTargetFormats,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		/** What each source format converts to, asked once per run. */
		const targets = new Map<string, Promise<FormatView[]>>();
		/** As an AI agent's tool, n8n runs the node as 'converterStudioTool' (n8n's own '@tool' test). */
		const isTool = this.getNode().type.endsWith('Tool');

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const key = `${resource}:${operation}` as Operation;

				if (key === 'account:get') {
					const account = (await apiRequest.call(this, {
						method: 'GET',
						path: '/account',
						idempotent: true,
						itemIndex: i,
					})) as AccountView;
					returnData.push({ json: account as unknown as IDataObject, pairedItem: { item: i } });
					continue;
				}

				if (key === 'format:getAll') {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const from = typeof filters.from === 'string' && filters.from ? filters.from : undefined;
					let formats = await listFormats.call(this, from, i);
					if (!returnAll) formats = formats.slice(0, this.getNodeParameter('limit', i) as number);
					for (const format of formats) {
						returnData.push({ json: format as unknown as IDataObject, pairedItem: { item: i } });
					}
					continue;
				}

				let view: ConversionView;
				let attempt: ConversionAttempt | undefined;
				if (key === 'file:convert') {
					attempt = conversionAttempt.call(this, i);
					view = await startConversion.call(this, i, targets, attempt);
				} else if (key === 'conversion:get') {
					view = await getConversion.call(
						this,
						conversionId.call(this, this.getNodeParameter('conversionId', i), i),
						i,
					);
				} else if (key === 'conversion:confirm') {
					const id = conversionId.call(this, this.getNodeParameter('conversionId', i), i);
					view = (await apiRequest.call(this, {
						method: 'POST',
						path: `/conversions/${encodeURIComponent(id)}/confirm`,
						idempotent: true,
						itemIndex: i,
					})) as ConversionView;
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation '${operation}' of '${resource}' isn't supported`,
						{ itemIndex: i },
					);
				}

				const wait = this.getNodeParameter('waitForCompletion', i) as boolean;
				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				if (wait) {
					view = await waitForConversion.call(
						this,
						view,
						{
							timeoutMs: Number(options.timeout ?? 600) * 1000,
							intervalMs: Number(options.pollInterval ?? 2) * 1000,
						},
						i,
					);
				}

				// Starting or confirming a conversion that ends without a result fails the item;
				// reading one only reports it.
				if (key !== 'conversion:get') {
					if (ENDED_WITHOUT_RESULT.has(view.status)) {
						// A retry of this node then starts a new conversion instead of getting this one.
						attempt?.spend();
						throw conversionFailed.call(this, view, i);
					}
					if (
						key === 'file:convert' &&
						view.status === 'quoted' &&
						this.getNodeParameter('aboveMaxCredits', i) === 'fail'
					) {
						throw conversionQuoted.call(this, view, i);
					}
				}

				const item: INodeExecutionData = {
					json: this.getNodeParameter('simplify', i)
						? simplifyConversion(view)
						: (view as unknown as IDataObject),
					pairedItem: { item: i },
				};
				const download =
					(wait || key === 'conversion:get') &&
					(this.getNodeParameter('downloadResult', i) as boolean);
				if (download && view.status === 'done') {
					const field = this.getNodeParameter('outputBinaryPropertyName', i) as string;
					item.binary = { [field]: await downloadResult.call(this, view, i) };
				}
				returnData.push(item);
			} catch (error) {
				if (isTool) await explainToAgent.call(this, error, i);
				if (this.continueOnFail()) {
					const context = (error as { context?: IDataObject }).context ?? {};
					// Only 'error', 'message' and 'details' at the top: n8n sends such an item to the
					// error output of 'Continue (using error output)'. (An item that carries the error
					// itself would get there too, but n8n then cuts its JSON down to the message.)
					returnData.push({
						json: {
							error: (error as Error).message,
							details: {
								code: codeOf(error) ?? null,
								conversionId:
									typeof context.conversionId === 'string' ? context.conversionId : null,
							},
						},
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

/**
 * Starts converting the item's file: uploaded from its binary data (checked against what its
 * format converts to before anything is charged), or fetched by Converter Studio from a link.
 * With `attempt`, the request carries its Idempotency-Key and reuses the upload of an earlier try.
 */
async function startConversion(
	this: IExecuteFunctions,
	i: number,
	targets: Map<string, Promise<FormatView[]>>,
	attempt: ConversionAttempt | undefined,
): Promise<ConversionView> {
	const to = String(this.getNodeParameter('targetFormat', i) ?? '')
		.trim()
		.toLowerCase();
	if (!to) {
		throw new NodeOperationError(this.getNode(), "Choose a 'Target Format'", { itemIndex: i });
	}
	const built = buildConversionOptions(
		this.getNodeParameter('conversionOptions', i, {}) as IDataObject,
	);
	if (!built.ok) throw new NodeOperationError(this.getNode(), built.reason, { itemIndex: i });
	const maxCredits = this.getNodeParameter('maxCredits', i) as number;
	const body: IDataObject = { to, maxCredits };
	if (built.options) body.options = built.options;
	const callbackUrl = callbackUrlOf.call(this, i);
	if (callbackUrl) body.callbackUrl = callbackUrl;

	if (this.getNodeParameter('source', i) === 'url') {
		const url = String(this.getNodeParameter('url', i) ?? '').trim();
		if (!/^https?:\/\//i.test(url)) {
			throw new NodeOperationError(this.getNode(), "The 'File URL' isn't a web link", {
				description: 'Use the full link to the file, starting with https://.',
				itemIndex: i,
			});
		}
		body.url = url;
	} else if (attempt?.uploadId) {
		// An earlier try of this node sent (and checked) the file already.
		body.uploadId = attempt.uploadId;
	} else {
		const upload = await uploadFile.call(this, await binarySource.call(this, i), i);
		const from = upload.format;
		if (!from) {
			throw new NodeOperationError(
				this.getNode(),
				`Converter Studio doesn't recognize the format of '${upload.name}'`,
				{
					description: "Check the file, or give its right extension with 'File Name' in 'Options'.",
					itemIndex: i,
				},
			);
		}
		if (!targets.has(from)) targets.set(from, listFormats.call(this, from, i));
		const formats = await targets.get(from)!;
		const format = formats.find((entry) => entry.id === from);
		if (format && !format.to.includes(to)) {
			throw new NodeOperationError(
				this.getNode(),
				`Converter Studio can't convert ${format.name} to ${to.toUpperCase()}`,
				{
					description: `${format.name} converts to: ${format.to.join(', ')}. Choose one of these as 'Target Format'.`,
					itemIndex: i,
				},
			);
		}
		body.uploadId = upload.id;
		attempt?.keepUpload(upload.id);
	}

	try {
		return (await apiRequest.call(this, {
			method: 'POST',
			path: '/conversions',
			body,
			headers: attempt ? { 'Idempotency-Key': attempt.key } : undefined,
			// With a key, sending the request again after a lost answer gets the same conversion.
			idempotent: Boolean(attempt),
			itemIndex: i,
		})) as ConversionView;
	} catch (error) {
		const code = codeOf(error);
		// The key belongs to another request (the node's settings changed between two tries), or
		// the kept upload is gone: the next try starts anew.
		if (code === 'idempotencyKeyReused' || (code === 'notFound' && body.uploadId)) {
			attempt?.spend();
		}
		// n8n's error classes hand back an error of their own class unchanged.
		if (error instanceof NodeOperationError) {
			throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
		}
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
	}
}

/**
 * For an AI agent, whose model gets only an error's message (n8n's AI Agent leaves out the
 * description under it): the message gets that description, and a conversion the file can't make
 * says what the file converts to instead, so the agent can choose again. The message itself stays
 * Converter Studio's (or the node's) own.
 */
async function explainToAgent(this: IExecuteFunctions, error: unknown, i: number): Promise<void> {
	if (!(error instanceof Error)) return;
	const { description, context } = error as Error & {
		description?: string | null;
		context?: IDataObject;
	};
	let details = description ?? undefined;
	const params = context?.converterStudioParams as IDataObject | undefined;
	const from = params?.from;
	if (codeOf(error) === 'unsupportedConversion' && typeof from === 'string' && from !== 'unknown') {
		try {
			const format = (await listFormats.call(this, from, i)).find((entry) => entry.id === from);
			if (format) details = `${format.name} converts to: ${format.to.join(', ')}.`;
		} catch {
			// Without the list the agent still gets the message and its hint.
		}
	}
	if (details && !error.message.includes(details)) {
		error.message = `${error.message}\n\nDetails: ${details}`;
	}
}

/**
 * The 'Callback URL' (only without 'Wait for Completion': a node that waits gets the result
 * itself). Converter Studio checks it; this only catches something that is no web address.
 */
function callbackUrlOf(this: IExecuteFunctions, i: number): string | undefined {
	if (this.getNodeParameter('waitForCompletion', i) as boolean) return undefined;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	const url = typeof options.callbackUrl === 'string' ? options.callbackUrl.trim() : '';
	if (!url) return undefined;
	if (!/^https?:\/\/[^/\s?#]+/i.test(url)) {
		throw new NodeOperationError(this.getNode(), "The 'Callback URL' isn't a web address", {
			description:
				'Use the Production URL of a Webhook node, starting with https://, that can be reached from the internet.',
			itemIndex: i,
		});
	}
	return url;
}

/** The item's binary file as an upload: from memory, or streamed from n8n's binary data store. */
async function binarySource(this: IExecuteFunctions, i: number): Promise<UploadSource> {
	const field = this.getNodeParameter('binaryPropertyName', i) as string;
	const binary = this.helpers.assertBinaryData(i, field);
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	const fileName =
		(typeof options.fileName === 'string' && options.fileName.trim()) ||
		binary.fileName ||
		(binary.fileExtension ? `file.${binary.fileExtension}` : 'file');
	if (binary.id) {
		const id = binary.id;
		const metadata = await this.helpers.getBinaryMetadata(id);
		if (Number.isSafeInteger(metadata.fileSize) && metadata.fileSize > 0) {
			return {
				fileName,
				size: metadata.fileSize,
				stream: async () => await this.helpers.getBinaryStream(id),
			};
		}
	}
	const buffer = await this.helpers.getBinaryDataBuffer(i, field);
	return { fileName, size: buffer.length, buffer };
}
