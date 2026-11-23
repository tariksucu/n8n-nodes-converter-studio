import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { version } from '../../../package.json';

export const CREDENTIAL_TYPE = 'converterStudioApi';
export const DEFAULT_BASE_URL = 'https://converter.studio/api';
/** Names this node, with the package's version, on its API calls (Converter Studio's statistics). */
export const CLIENT_HEADER = { 'X-Converter-Studio-Client': `n8n/${version}` };

/** How many times a request is sent again after a rate limit, a busy server or a lost connection. */
export const MAX_RETRIES = 3;
/** The longest pause before sending a request again. */
const MAX_RETRY_WAIT_MS = 60_000;

export type ApiContext = IExecuteFunctions | ILoadOptionsFunctions;

export type FullResponse = {
	statusCode: number;
	headers: IDataObject;
	body: unknown;
};

export type ApiRequest = {
	method: IHttpRequestMethods;
	/** The path after `/v1`, e.g. `/account`. */
	path: string;
	body?: IDataObject;
	qs?: IDataObject;
	/** More request headers (the Idempotency-Key). */
	headers?: Record<string, string>;
	/** Milliseconds; long polls ask for more. */
	timeout?: number;
	/** Whether the request may be sent again after a lost connection (it changes nothing twice). */
	idempotent?: boolean;
	itemIndex?: number;
};

/** What the next step is, for the API's error codes (shown under the message in n8n). */
const HINTS: Record<string, string> = {
	invalidApiKey:
		'Check the API key of the Converter Studio API credential. Keys are made on https://converter.studio/account#api-keys and start with cvs_live_.',
	notEnoughCredits:
		'Buy credits or choose a plan on https://converter.studio/pricing. Free accounts get new credits every day.',
	dailyLimit:
		'Free accounts get new credits every day; plans on https://converter.studio/pricing have more.',
	monthlyLimit: 'Buy a credit pack or choose a larger plan on https://converter.studio/pricing.',
	fileTooLarge:
		'Send a smaller file, or choose a plan with a larger file limit on https://converter.studio/pricing.',
	durationTooLong:
		'Send a shorter file, or choose a plan with a longer limit on https://converter.studio/pricing.',
	unsupportedConversion:
		"Choose another 'Target Format'. The 'Get Many' operation of the 'Format' resource lists what each format converts to.",
	tooManyRequests:
		'Converter Studio takes up to 60 requests a minute for each API key. Send fewer items at a time, for example with the Loop Over Items node.',
	serverBusy: 'Try again in a few minutes.',
	notFound:
		"Check the 'Conversion ID'. Conversions are kept for 6 hours, and only the account that started one can see it.",
	fileExpired: 'Results are kept for 6 hours. Convert the file again.',
	invalidUrl: "Use the full link to a single file, starting with https://, in 'File URL'.",
	remoteUnsupported: "Use a link to a single file in 'File URL', not to a folder or an album.",
	remoteNotFound:
		"Make sure that anyone with the link in 'File URL' can download the file, and that it still exists.",
	remoteFailed: 'Try again, or download the file in n8n first and send it as a binary file.',
	invalidRequest:
		"Check the conversion options. 'Other Options (JSON)' may hold a setting name or value that Converter Studio doesn't know.",
	uploadFailed: 'Try again.',
	passwordNeeded: "Set 'Archive Password' in 'Conversion Options'.",
	wrongPassword: "Check 'Archive Password' in 'Conversion Options'.",
	noPages: "Check 'Page Range' in 'Conversion Options'.",
	noText: "For a scanned PDF, turn on 'Recognize Text (OCR)' in 'Conversion Options'.",
	sizeTooSmall: "Raise 'Max File Size (MB)' in 'Conversion Options', or send a shorter video.",
	tooManyPending: 'Wait until the waiting uploads are converted, then try again.',
	tooManyUnconverted: 'Try again later.',
	archivePlanRequired: 'Converting what is inside an archive needs a Pro or Premium plan.',
	invalidCallbackUrl:
		"Use an https:// address that can be reached from the internet in 'Callback URL', such as the Production URL of a Webhook node. Converter Studio doesn't call local or private addresses.",
	idempotencyKeyReused:
		'The settings of this item changed between two tries of the node. The next try starts a new conversion.',
};

export function hintFor(code: string | undefined): string | undefined {
	return code ? HINTS[code] : undefined;
}

/** The API's base address from the credential: no trailing slash and no `/v1`. */
export function normalizeBaseUrl(value: unknown): string | undefined {
	const raw = typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_BASE_URL;
	const base = raw.replace(/\/+$/, '').replace(/\/v1$/i, '');
	return /^https?:\/\/[^/\s?#]+/i.test(base) ? base : undefined;
}

const isObject = (value: unknown): value is IDataObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Turns a JSON body that came back as text or bytes into an object (anything else stays). */
export function parseBody(body: unknown): unknown {
	if (typeof body === 'string' || body instanceof Uint8Array) {
		const text = typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
		try {
			return JSON.parse(text) as unknown;
		} catch {
			return text;
		}
	}
	return body;
}

/** The API's error code and parameters from an error body (`{ error: { code, message } }` or `{ error: "code" }`). */
export function errorOf(body: unknown): { code?: string; message?: string; params?: IDataObject } {
	const parsed = parseBody(body);
	if (!isObject(parsed)) return {};
	const error = parsed.error;
	if (typeof error === 'string') return { code: error };
	if (!isObject(error)) return {};
	return {
		code: typeof error.code === 'string' ? error.code : undefined,
		message: typeof error.message === 'string' ? error.message : undefined,
		params: isObject(error.params) ? error.params : undefined,
	};
}

/** Messages for the codes the website's own routes send without one (the download link). */
const FALLBACK_MESSAGES: Record<string, string> = {
	fileExpired: 'The converted file has already been deleted',
	notFound: "Converter Studio couldn't find that conversion",
	tooManyRequests: 'Converter Studio received too many requests at once',
	serverBusy: 'Converter Studio is busy right now',
	invalidRequest: "Converter Studio didn't accept the request",
	fileTooLarge: 'The file is larger than the limit of the plan',
};

/** An n8n error for an answer of the API that is not a success. */
export function apiError(node: INode, response: FullResponse, itemIndex?: number): NodeApiError {
	const { code, message, params } = errorOf(response.body);
	const parsed = parseBody(response.body);
	const text =
		message ??
		(code ? FALLBACK_MESSAGES[code] : undefined) ??
		`Converter Studio answered with HTTP status ${response.statusCode}`;
	const error = new NodeApiError(
		node,
		(isObject(parsed) ? parsed : { body: String(parsed ?? '') }) as JsonObject,
		{
			message: text,
			description: hintFor(code),
			httpCode: String(response.statusCode),
			itemIndex,
		},
	);
	error.context.converterStudioCode = code;
	if (params) error.context.converterStudioParams = params;
	return error;
}

/** The API's code behind an error this node made, for `continueOnFail` output. */
export function codeOf(error: unknown): string | undefined {
	if (!isObject(error) || !isObject(error.context)) return undefined;
	const code = error.context.converterStudioCode;
	return typeof code === 'string' ? code : undefined;
}

const headerValue = (headers: IDataObject, name: string): string | undefined => {
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
	return value === undefined || value === null ? undefined : String(value);
};

/** How long to pause before sending a request again: `Retry-After`, the rate limit's reset, or a back-off. */
export function retryDelay(response: FullResponse | undefined, attempt: number): number {
	const backoff = Math.min(MAX_RETRY_WAIT_MS, 2000 * 2 ** attempt);
	if (!response) return backoff;
	const retryAfter = headerValue(response.headers, 'retry-after');
	const reset = headerValue(response.headers, 'x-ratelimit-reset');
	let ms: number | undefined;
	if (retryAfter !== undefined) {
		const seconds = Number(retryAfter);
		ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
	} else if (reset !== undefined && Number.isFinite(Number(reset))) {
		ms = Number(reset) * 1000;
	}
	if (ms === undefined || !Number.isFinite(ms)) return backoff;
	return Math.min(MAX_RETRY_WAIT_MS, Math.max(1000, ms));
}

/** Statuses after which a request is sent again: the rate limit and a busy server always. */
const RETRY_ALWAYS = new Set([429, 503]);
/** Statuses after which only a request that changes nothing twice is sent again. */
const RETRY_IDEMPOTENT = new Set([500, 502, 504]);

/** The API's base address, from the credential. */
export async function apiBaseUrl(this: ApiContext, itemIndex?: number): Promise<string> {
	const credentials = await this.getCredentials(CREDENTIAL_TYPE);
	const base = normalizeBaseUrl(credentials.baseUrl);
	if (!base) {
		throw new NodeOperationError(
			this.getNode(),
			"The 'Base URL' of the Converter Studio API credential isn't a web address",
			{ description: `Use ${DEFAULT_BASE_URL}, or leave it empty.`, itemIndex },
		);
	}
	return base;
}

/**
 * One call of the REST API with the credential's API key. Rate limits (429) and a busy server
 * (503) are waited out; anything else that is not a success becomes a NodeApiError with the
 * API's own message and what to do about it.
 */
export async function apiRequest<T>(this: ApiContext, request: ApiRequest): Promise<T> {
	const base = await apiBaseUrl.call(this, request.itemIndex);
	const options: IHttpRequestOptions = {
		method: request.method,
		url: `${base}/v1${request.path}`,
		headers: { ...CLIENT_HEADER, ...request.headers },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout: request.timeout ?? 60_000,
	};
	if (request.body) options.body = request.body;
	if (request.qs) options.qs = request.qs;
	const signal = 'getExecutionCancelSignal' in this ? this.getExecutionCancelSignal?.() : undefined;
	if (signal) options.abortSignal = signal;

	for (let attempt = 0; ; attempt++) {
		let response: FullResponse;
		try {
			response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				CREDENTIAL_TYPE,
				options,
			)) as FullResponse;
		} catch (error) {
			if (request.idempotent && attempt < MAX_RETRIES && !signal?.aborted) {
				await sleep(retryDelay(undefined, attempt));
				continue;
			}
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				itemIndex: request.itemIndex,
			});
		}
		const status = response.statusCode;
		if (status >= 200 && status < 300) return parseBody(response.body) as T;
		const again =
			RETRY_ALWAYS.has(status) || (request.idempotent === true && RETRY_IDEMPOTENT.has(status));
		if (again && attempt < MAX_RETRIES && !signal?.aborted) {
			await sleep(retryDelay(response, attempt));
			continue;
		}
		throw apiError(this.getNode(), response, request.itemIndex);
	}
}
