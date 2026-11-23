import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import {
	apiError,
	apiRequest,
	errorOf,
	type FullResponse,
	MAX_RETRIES,
	parseBody,
	retryDelay,
} from './transport';
import type { UploadReceipt, UploadSlot } from './types';

/** One request carries at most this much when the API does not say (the CDN stops at 100 MB). */
export const DEFAULT_PART_BYTES = 95 * 1024 * 1024;
/** The longest file name the API takes. */
const MAX_NAME_LENGTH = 255;

type Chunk = Buffer | Uint8Array | string;

/** A stream of a file's bytes, as n8n's binary data store gives it. */
export type ByteStream = AsyncIterable<Chunk> & { destroy?: () => void };

/** A file to upload: its bytes in memory, or a stream of them from n8n's binary data store. */
export type UploadSource =
	| { fileName: string; size: number; buffer: Buffer }
	| { fileName: string; size: number; stream: () => Promise<ByteStream> };

export type UploadedFile = {
	id: string;
	name: string;
	size: number;
	/** The format Converter Studio found in the bytes, or `null` when it found none. */
	format: string | null;
};

/** A file name the API takes: at most 255 characters, keeping its extension. */
export function uploadName(name: string): string {
	const trimmed = name.trim() || 'file';
	if (trimmed.length <= MAX_NAME_LENGTH) return trimmed;
	const dot = trimmed.lastIndexOf('.');
	const extension = dot > 0 && trimmed.length - dot <= 16 ? trimmed.slice(dot) : '';
	return trimmed.slice(0, MAX_NAME_LENGTH - extension.length) + extension;
}

const toBuffer = (chunk: Chunk): Buffer =>
	typeof chunk === 'string'
		? Buffer.from(chunk)
		: Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);

/** Cuts a stream into parts of `partBytes` (the last one may be shorter). */
export async function* partsOf(
	stream: AsyncIterable<Chunk>,
	partBytes: number,
): AsyncGenerator<Buffer> {
	let chunks: Buffer[] = [];
	let length = 0;
	for await (const chunk of stream) {
		let data = toBuffer(chunk);
		while (data.length > 0) {
			const take = Math.min(partBytes - length, data.length);
			chunks.push(data.subarray(0, take));
			length += take;
			data = data.subarray(take);
			if (length === partBytes) {
				yield Buffer.concat(chunks, length);
				chunks = [];
				length = 0;
			}
		}
	}
	if (length > 0) yield Buffer.concat(chunks, length);
}

/** How long one request of an upload may take: two minutes, plus two seconds a megabyte. */
const partTimeout = (bytes: number) => 120_000 + Math.ceil(bytes / 1_000_000) * 2000;

type PartResult = UploadReceipt | { status: 'gap'; received: number };

/**
 * Sends one request of an upload to its upload URL, which carries its own one-time token, so no
 * API key goes with it. A part is sent again after a lost connection, a rate limit or a busy
 * server: the API overwrites what arrived of it before.
 */
async function sendPart(
	this: IExecuteFunctions,
	uploadUrl: string,
	bytes: Buffer,
	offset: number | null,
	itemIndex: number,
): Promise<PartResult> {
	const headers: IDataObject = { 'Content-Type': 'application/octet-stream' };
	if (offset !== null) headers['Upload-Offset'] = String(offset);
	const options: IHttpRequestOptions = {
		method: 'PUT',
		url: uploadUrl,
		headers,
		body: bytes,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout: partTimeout(bytes.length),
	};
	for (let attempt = 0; ; attempt++) {
		let response: FullResponse;
		try {
			response = (await this.helpers.httpRequest(options)) as FullResponse;
		} catch (error) {
			if (attempt < MAX_RETRIES) {
				await sleep(retryDelay(undefined, attempt));
				continue;
			}
			throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
		}
		const status = response.statusCode;
		if (status >= 200 && status < 300) return parseBody(response.body) as UploadReceipt;
		if (status === 409 && offset !== null) {
			const received = Number(errorOf(response.body).params?.received);
			if (Number.isSafeInteger(received) && received >= 0) return { status: 'gap', received };
		}
		if ((status === 429 || status >= 500) && attempt < MAX_RETRIES) {
			await sleep(retryDelay(response, attempt));
			continue;
		}
		throw apiError(this.getNode(), response, itemIndex);
	}
}

async function collect(stream: ByteStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(toBuffer(chunk));
	return Buffer.concat(chunks);
}

/**
 * Uploads a file: an upload slot (`POST /v1/uploads`, which checks the plan's size limit before
 * anything is sent), then the bytes in one request, or in parts of the slot's `partBytes` with
 * `Upload-Offset` for a file larger than that.
 */
export async function uploadFile(
	this: IExecuteFunctions,
	source: UploadSource,
	itemIndex: number,
): Promise<UploadedFile> {
	if (source.size <= 0) {
		throw new NodeOperationError(this.getNode(), 'The input file is empty', {
			description: "Check the 'Input Binary Field'.",
			itemIndex,
		});
	}
	const slot = (await apiRequest.call(this, {
		method: 'POST',
		path: '/uploads',
		body: { fileName: uploadName(source.fileName), size: source.size },
		itemIndex,
	})) as UploadSlot;
	const partBytes = slot.partBytes > 0 ? slot.partBytes : DEFAULT_PART_BYTES;
	const incomplete = () =>
		new NodeOperationError(this.getNode(), 'The upload of the file did not finish', {
			description:
				'Converter Studio received a different number of bytes than the file has. Try again.',
			itemIndex,
		});
	const ready = (receipt: PartResult): UploadedFile => {
		if (receipt.status !== 'ready') throw incomplete();
		const { name, size, format } = receipt.file;
		return { id: slot.id, name, size, format };
	};

	if (source.size <= partBytes) {
		const bytes = 'buffer' in source ? source.buffer : await collect(await source.stream());
		return ready(await sendPart.call(this, slot.uploadUrl, bytes, null, itemIndex));
	}

	// In parts. From memory, a part can be sent again from where the API says it stopped.
	if ('buffer' in source) {
		const buffer = source.buffer;
		let offset = 0;
		let resumes = 0;
		while (offset < buffer.length) {
			const part = buffer.subarray(offset, Math.min(buffer.length, offset + partBytes));
			const receipt = await sendPart.call(this, slot.uploadUrl, part, offset, itemIndex);
			if (receipt.status === 'ready') return ready(receipt);
			if (receipt.status === 'gap') {
				// The API has less than was sent: go on from there, a few times at most.
				if (++resumes > MAX_RETRIES || receipt.received >= offset) throw incomplete();
			} else if (receipt.received !== offset + part.length) {
				throw incomplete();
			}
			offset = receipt.received;
		}
		throw incomplete();
	}

	const stream = await source.stream();
	let offset = 0;
	try {
		for await (const part of partsOf(stream, partBytes)) {
			const receipt = await sendPart.call(this, slot.uploadUrl, part, offset, itemIndex);
			if (receipt.status === 'ready') return ready(receipt);
			offset += part.length;
			if (receipt.status === 'gap' || receipt.received !== offset) throw incomplete();
		}
	} finally {
		stream.destroy?.();
	}
	throw incomplete();
}
