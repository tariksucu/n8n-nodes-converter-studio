import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { apiError, apiRequest, type FullResponse, hintFor, parseBody } from './transport';
import type { ConversionStatus, ConversionView } from './types';

/** What n8n's HTTP helper gives for `encoding: 'stream'`: a readable stream (or bytes). */
type BinaryBody = Parameters<IExecuteFunctions['helpers']['prepareBinaryData']>[0];

/** Statuses a conversion stays in until someone acts (or never leaves). */
export const SETTLED: ReadonlySet<ConversionStatus> = new Set([
	'done',
	'failed',
	'expired',
	'canceled',
	'quoted',
]);

/** The longest a single status request waits on the server (the API allows 60 seconds). */
const LONG_POLL_SECONDS = 50;

/** Conversion ids are also upload ids: 8 to 64 letters, digits, `-` and `_`. */
const CONVERSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function conversionId(this: IExecuteFunctions, value: unknown, itemIndex: number): string {
	const id = typeof value === 'string' ? value.trim() : '';
	if (!CONVERSION_ID.test(id)) {
		throw new NodeOperationError(
			this.getNode(),
			"The 'Conversion ID' isn't a Converter Studio conversion ID",
			{
				description:
					"Use the 'id' field that the 'Convert' operation returned, for example {{ $json.id }}.",
				itemIndex,
			},
		);
	}
	return id;
}

export async function getConversion(
	this: IExecuteFunctions,
	id: string,
	itemIndex: number,
	waitSeconds = 0,
): Promise<ConversionView> {
	return (await apiRequest.call(this, {
		method: 'GET',
		path: `/conversions/${encodeURIComponent(id)}`,
		qs: waitSeconds > 0 ? { wait: waitSeconds } : undefined,
		timeout: (waitSeconds + 30) * 1000,
		idempotent: true,
		itemIndex,
	})) as ConversionView;
}

export type WaitOptions = {
	/** Give up waiting after this many milliseconds (the conversion goes on). */
	timeoutMs: number;
	/** At least this long between two status requests. */
	intervalMs: number;
};

/**
 * Waits until a conversion is done, failed, expired, canceled or quoted. Each status request
 * waits on the server until something changes (up to 50 seconds), so a finished conversion is
 * seen at once; `intervalMs` only spaces out the requests.
 */
export async function waitForConversion(
	this: IExecuteFunctions,
	start: ConversionView,
	options: WaitOptions,
	itemIndex: number,
): Promise<ConversionView> {
	const deadline = Date.now() + options.timeoutMs;
	const signal = this.getExecutionCancelSignal?.();
	let view = start;
	while (!SETTLED.has(view.status)) {
		if (signal?.aborted) throw stoppedWhileWaiting.call(this, view, itemIndex);
		const left = deadline - Date.now();
		if (left <= 0) {
			const error = new NodeOperationError(
				this.getNode(),
				`The conversion wasn't finished after ${Math.round(options.timeoutMs / 1000)} seconds`,
				{
					description: `It goes on at Converter Studio (status '${view.status}'). Get it later with the 'Get' operation of the 'Conversion' resource and the ID ${view.id}, or raise 'Timeout (Seconds)'.`,
					itemIndex,
				},
			);
			error.context.converterStudioCode = 'timeout';
			error.context.conversionId = view.id;
			throw error;
		}
		const asked = Date.now();
		try {
			view = await getConversion.call(
				this,
				view.id,
				itemIndex,
				Math.max(1, Math.min(LONG_POLL_SECONDS, Math.floor(left / 1000))),
			);
		} catch (error) {
			// n8n stopped the execution (by hand, or at its time limit) during a status check.
			if (signal?.aborted) throw stoppedWhileWaiting.call(this, view, itemIndex);
			// n8n's error classes hand back an error of their own class unchanged.
			if (error instanceof NodeOperationError) {
				throw new NodeOperationError(this.getNode(), error, { itemIndex });
			}
			throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
		}
		if (SETTLED.has(view.status)) break;
		const pause = Math.min(options.intervalMs - (Date.now() - asked), deadline - Date.now());
		if (pause > 0) await sleep(pause);
	}
	return view;
}

/**
 * An n8n error for an execution that n8n stopped while the node waited: the conversion goes on,
 * and its ID is the only way to get the result (n8n Cloud stops executions after a few minutes).
 */
function stoppedWhileWaiting(
	this: IExecuteFunctions,
	view: ConversionView,
	itemIndex: number,
): NodeOperationError {
	const error = new NodeOperationError(
		this.getNode(),
		'n8n stopped the execution while the node waited for the conversion',
		{
			description: `The conversion goes on at Converter Studio (ID ${view.id}). Get it later with the 'Get' operation of the 'Conversion' resource. For conversions that take longer than n8n lets an execution run, turn off 'Wait for Completion'.`,
			itemIndex,
		},
	);
	error.context.converterStudioCode = 'stopped';
	error.context.conversionId = view.id;
	return error;
}

/** An n8n error for a conversion that ended without a result. */
export function conversionFailed(
	this: IExecuteFunctions,
	view: ConversionView,
	itemIndex: number,
): NodeOperationError {
	const fallback: Record<string, string> = {
		failed: 'The conversion did not succeed',
		expired: 'The result of the conversion was deleted after its time ran out',
		canceled: 'The conversion was canceled',
	};
	const message = view.error?.message ?? fallback[view.status] ?? view.next;
	const error = new NodeOperationError(this.getNode(), message, {
		description:
			hintFor(view.error?.code) ??
			(view.status === 'failed' ? 'No credits were charged for it.' : undefined),
		itemIndex,
	});
	error.context.converterStudioCode = view.error?.code;
	if (view.error?.params) error.context.converterStudioParams = view.error.params;
	error.context.conversionId = view.id;
	return error;
}

/** An n8n error for a conversion that costs more than it may cost on its own. */
export function conversionQuoted(
	this: IExecuteFunctions,
	view: ConversionView,
	itemIndex: number,
): NodeOperationError {
	const error = new NodeOperationError(
		this.getNode(),
		`The conversion costs ${view.credits === 1 ? '1 credit' : `${view.credits ?? 'more'} credits`}, more than 'Max Credits' (${view.maxCredits ?? 0})`,
		{
			description: `Raise 'Max Credits', or set 'Above Max Credits' to 'Return Quote' and start it with the 'Confirm' operation of the 'Conversion' resource (ID ${view.id}).`,
			itemIndex,
		},
	);
	error.context.converterStudioCode = 'quoted';
	error.context.conversionId = view.id;
	return error;
}

const header = (headers: IDataObject, name: string): string | undefined => {
	const value = headers[name];
	if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
	return typeof value === 'string' ? value : undefined;
};

/** The file name a `Content-Disposition` header gives, if any. */
export function dispositionName(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(value);
	if (encoded) {
		try {
			return decodeURIComponent(encoded[1].trim());
		} catch {
			// Fall back to the plain name.
		}
	}
	const plain = /filename\s*=\s*"?([^";]+)"?/.exec(value);
	return plain ? plain[1].trim() : undefined;
}

/**
 * Downloads a finished conversion's result into n8n's binary data. The link carries its own
 * token, so no API key goes with it; the file streams into n8n's binary data store.
 */
export async function downloadResult(
	this: IExecuteFunctions,
	view: ConversionView,
	itemIndex: number,
): Promise<IBinaryData> {
	if (view.status !== 'done' || !view.downloadUrl) {
		throw new NodeOperationError(this.getNode(), 'The conversion has no result to download yet', {
			description: `Its status is '${view.status}'. Turn on 'Wait for Completion', or get it again later.`,
			itemIndex,
		});
	}
	const options: IHttpRequestOptions = {
		method: 'GET',
		url: view.downloadUrl,
		encoding: 'stream',
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout: 300_000,
	};
	let response: FullResponse;
	try {
		response = (await this.helpers.httpRequest(options)) as FullResponse;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}
	const body = response.body as BinaryBody;
	if (response.statusCode < 200 || response.statusCode >= 300) {
		const text = await this.helpers.binaryToString(body);
		throw apiError(this.getNode(), { ...response, body: parseBody(text) }, itemIndex);
	}
	const mimeType = header(response.headers, 'content-type')?.split(';')[0].trim();
	const fileName =
		view.outputName ??
		dispositionName(header(response.headers, 'content-disposition')) ??
		`converted.${view.to ?? 'bin'}`;
	return await this.helpers.prepareBinaryData(body, fileName, mimeType || undefined);
}

/** The ten fields most workflows need, for 'Simplify'. */
export function simplifyConversion(view: ConversionView): IDataObject {
	return {
		id: view.id,
		status: view.status,
		from: view.from,
		to: view.to,
		credits: view.credits,
		outputName: view.outputName,
		outputSize: view.outputSize,
		downloadUrl: view.downloadUrl,
		expiresAt: view.expiresAt,
		error: view.error,
	};
}
