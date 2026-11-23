'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BASE, binaryItem, createContext, reply, run, view } = require('./helpers');

const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');
const JPG = Buffer.from('ffd8ffe0', 'hex');
const UPLOAD_URL = `${BASE}/v1/uploads/conv_12345678?token=slot`;

const formats = (from, to) =>
	reply(200, {
		formats: [{ id: from, name: from.toUpperCase(), category: 'image', extensions: [from], to }],
	});

/** The API for one upload of `size` bytes converted to JPG. */
function uploadRoutes({
	partBytes = 95 * 1024 * 1024,
	onPut,
	conversion = view(),
	polls = [],
} = {}) {
	const statuses = [...polls];
	return async (request) => {
		const { method, path } = request;
		if (method === 'POST' && path === '/api/v1/uploads') {
			return reply(201, {
				id: 'conv_12345678',
				uploadUrl: UPLOAD_URL,
				method: 'PUT',
				maxBytes: 1024 ** 3,
				partBytes,
				expiresAt: '2026-11-22T03:00:00.000Z',
			});
		}
		if (method === 'PUT' && request.url === UPLOAD_URL) return onPut(request);
		if (method === 'GET' && path === '/api/v1/formats')
			return formats(request.query.from, ['jpg', 'webp']);
		if (method === 'POST' && path === '/api/v1/conversions')
			return reply(201, statuses.length ? statuses.shift() : conversion);
		if (method === 'GET' && path === '/api/v1/conversions/conv_12345678')
			return reply(200, statuses.length ? statuses.shift() : conversion);
		if (method === 'GET' && path === '/api/jobs/conv_12345678/download')
			return reply(200, JPG, { 'content-type': 'image/jpeg' });
		return undefined;
	};
}

const readyPut = (size) => () =>
	reply(200, {
		id: 'conv_12345678',
		status: 'ready',
		file: { name: 'photo.png', size, format: 'png' },
	});

test('converts a binary file: upload, check, convert, wait, download', async () => {
	const context = createContext({
		params: {
			resource: 'file',
			operation: 'convert',
			targetFormat: 'jpg',
			conversionOptions: { quality: 'high' },
		},
		items: [binaryItem(PNG, 'photo.png', 'image/png')],
		routes: uploadRoutes({
			onPut: readyPut(PNG.length),
			polls: [view({ status: 'processing', downloadUrl: null, outputName: null })],
		}),
	});
	const [item, ...rest] = await run(context);
	assert.equal(rest.length, 0);
	assert.deepEqual(item.pairedItem, { item: 0 });
	assert.equal(item.json.status, 'done');
	assert.equal(item.json.id, 'conv_12345678');
	assert.equal(Object.keys(item.json).length, 10, 'Simplify keeps ten fields');
	assert.equal(item.binary.data.fileName, 'photo.jpg');
	assert.equal(item.binary.data.mimeType, 'image/jpeg');
	assert.deepEqual(Buffer.from(item.binary.data.data, 'base64'), JPG);

	const [slot, put, check, convert, poll, download] = context.calls;
	assert.deepEqual(slot.body, { fileName: 'photo.png', size: PNG.length });
	assert.equal(slot.auth, 'Bearer cvs_live_test');
	assert.equal(put.auth, undefined, 'the upload URL carries its own token');
	assert.equal(put.headers['Upload-Offset'], undefined);
	assert.deepEqual(put.body, PNG);
	assert.equal(check.query.from, 'png');
	assert.deepEqual(convert.body, {
		to: 'jpg',
		maxCredits: 20,
		uploadId: 'conv_12345678',
		options: { quality: 'high' },
	});
	assert.ok(Number(poll.query.wait) > 0, 'status checks wait on the server');
	assert.equal(download.auth, undefined, 'the download link carries its own token');
	assert.equal(download.options.encoding, 'stream');
});

test('sends a large file in parts with Upload-Offset', async () => {
	const bytes = Buffer.from('0123456789');
	const received = [];
	const context = createContext({
		params: { resource: 'file', operation: 'convert', targetFormat: 'jpg' },
		items: [binaryItem(bytes, 'big.png')],
		routes: uploadRoutes({
			partBytes: 4,
			onPut: (request) => {
				const offset = Number(request.headers['Upload-Offset']);
				received.push([offset, request.body.toString()]);
				const total = offset + request.body.length;
				return total < bytes.length
					? reply(200, { id: 'conv_12345678', status: 'partial', received: total })
					: readyPut(bytes.length)();
			},
		}),
	});
	await run(context);
	assert.deepEqual(received, [
		[0, '0123'],
		[4, '4567'],
		[8, '89'],
	]);
});

test('streams a file from the binary data store in parts', async () => {
	const binaryStore = new Map([
		[
			'filesystem-v2:abc',
			{ size: 10, chunks: [Buffer.from('012'), Buffer.from('3456789')], fileName: 'big.png' },
		],
	]);
	const parts = [];
	const context = createContext({
		params: { resource: 'file', operation: 'convert', targetFormat: 'jpg' },
		items: [
			{
				json: {},
				binary: {
					data: {
						id: 'filesystem-v2:abc',
						data: 'filesystem-v2',
						fileName: 'big.png',
						mimeType: 'image/png',
					},
				},
			},
		],
		binaryStore,
		routes: uploadRoutes({
			partBytes: 4,
			onPut: (request) => {
				const offset = Number(request.headers['Upload-Offset']);
				parts.push(request.body.toString());
				const total = offset + request.body.length;
				return total < 10
					? reply(200, { id: 'conv_12345678', status: 'partial', received: total })
					: readyPut(10)();
			},
		}),
	});
	await run(context);
	assert.deepEqual(parts, ['0123', '4567', '89']);
	assert.equal(context.calls[0].body.size, 10, 'the size comes from the binary data store');
});

test('resends from where the API stopped after a gap', async () => {
	const bytes = Buffer.from('0123456789');
	const offsets = [];
	let gapSent = false;
	const context = createContext({
		params: { resource: 'file', operation: 'convert', targetFormat: 'jpg' },
		items: [binaryItem(bytes, 'big.png')],
		routes: uploadRoutes({
			partBytes: 4,
			onPut: (request) => {
				const offset = Number(request.headers['Upload-Offset']);
				offsets.push(offset);
				if (offset === 8 && !gapSent) {
					gapSent = true;
					return reply(409, {
						error: { code: 'invalidRequest', message: 'x', params: { received: 6 } },
					});
				}
				const total = offset + request.body.length;
				return total < 10
					? reply(200, { id: 'conv_12345678', status: 'partial', received: total })
					: readyPut(10)();
			},
		}),
	});
	await run(context);
	assert.deepEqual(offsets, [0, 4, 8, 6]);
});

test('converts from a URL and waits while Converter Studio fetches it', async () => {
	const context = createContext({
		params: {
			resource: 'file',
			operation: 'convert',
			source: 'url',
			url: 'https://example.com/a.png',
			targetFormat: 'jpg',
			downloadResult: false,
		},
		routes: uploadRoutes({
			polls: [
				view({ status: 'fetching', from: null, downloadUrl: null }),
				view({ status: 'queued', downloadUrl: null }),
			],
			onPut: () => assert.fail('no upload for a link'),
		}),
	});
	const [item] = await run(context);
	assert.equal(item.json.status, 'done');
	assert.equal(item.binary, undefined, "no file without 'Download Result'");
	assert.deepEqual(context.calls[0].body, {
		to: 'jpg',
		maxCredits: 20,
		url: 'https://example.com/a.png',
	});
	assert.equal(context.calls.filter((c) => c.path.endsWith('/conv_12345678')).length, 2);
});

test('a conversion above Max Credits fails the item, or is returned as a quote', async () => {
	const quoted = view({ status: 'quoted', credits: 45, maxCredits: 20, downloadUrl: null });
	const params = {
		resource: 'file',
		operation: 'convert',
		source: 'url',
		url: 'https://example.com/a.mp4',
		targetFormat: 'mp4',
	};
	const routes = uploadRoutes({ conversion: quoted, onPut: () => assert.fail() });

	await assert.rejects(run(createContext({ params, routes })), (error) => {
		assert.match(error.message, /costs 45 credits, more than 'Max Credits' \(20\)/);
		assert.match(error.description, /Confirm/);
		return true;
	});

	const [item] = await run(
		createContext({ params: { ...params, aboveMaxCredits: 'quote' }, routes }),
	);
	assert.equal(item.json.status, 'quoted');
	assert.equal(item.json.credits, 45);
	assert.equal(item.binary, undefined);
});

test('a failed conversion fails the item with the API message, or outputs it with continueOnFail', async () => {
	const failed = view({
		status: 'failed',
		downloadUrl: null,
		error: { code: 'noPages', message: 'None of the pages you picked are in this PDF.' },
	});
	const params = {
		resource: 'file',
		operation: 'convert',
		source: 'url',
		url: 'https://example.com/a.pdf',
		targetFormat: 'jpg',
	};
	const routes = uploadRoutes({ conversion: failed, onPut: () => assert.fail() });

	await assert.rejects(run(createContext({ params, routes })), (error) => {
		assert.equal(error.message, 'None of the pages you picked are in this PDF.');
		assert.match(error.description, /Page Range/);
		return true;
	});

	const [item] = await run(createContext({ params, routes, continueOnFail: true }));
	assert.deepEqual(item.json, {
		error: 'None of the pages you picked are in this PDF.',
		details: { code: 'noPages', conversionId: 'conv_12345678' },
	});
	// n8n cuts the JSON of an item that carries an error down to its message.
	assert.equal(item.error, undefined);
});

/** n8n 2.48's test for an item of the error output ('Continue (using error output)'). */
const goesToErrorOutput = (item) =>
	Boolean(
		item.error ||
		(item.json.error &&
			Object.keys(item.json).every((key) => ['error', 'message', 'details'].includes(key))),
	);

test("with Continue On Fail, failed items go to n8n's error output and the others do not", async () => {
	const context = createContext({
		params: (name, i) =>
			({
				resource: 'file',
				operation: 'convert',
				source: 'url',
				url: ['https://example.com/a.png', 'ftp://example.com/b.png'][i],
				targetFormat: 'jpg',
				downloadResult: false,
			})[name],
		items: [{ json: {} }, { json: {} }],
		routes: uploadRoutes({ onPut: () => assert.fail() }),
		continueOnFail: true,
	});
	const [done, failed] = await run(context);
	assert.equal(done.json.status, 'done');
	assert.equal(goesToErrorOutput(done), false);
	assert.match(failed.json.error, /isn't a web link/);
	assert.deepEqual(failed.json.details, { code: null, conversionId: null });
	assert.equal(goesToErrorOutput(failed), true);
});

test('a target the source format cannot reach stops before the conversion is created', async () => {
	const context = createContext({
		params: { resource: 'file', operation: 'convert', targetFormat: 'mp3' },
		items: [binaryItem(PNG, 'photo.png')],
		routes: uploadRoutes({ onPut: readyPut(PNG.length) }),
	});
	await assert.rejects(run(context), /can't convert PNG to MP3/);
	assert.ok(!context.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/conversions'));
});

test('an API error becomes a NodeApiError with the message and a hint', async () => {
	const context = createContext({
		params: { resource: 'account', operation: 'get' },
		routes: () =>
			reply(401, {
				error: {
					code: 'invalidApiKey',
					message:
						'This API key does not work. Create one on your account page at converter.studio.',
				},
			}),
	});
	await assert.rejects(run(context), (error) => {
		assert.equal(error.name, 'NodeApiError');
		assert.equal(error.httpCode, '401');
		assert.equal(
			error.message,
			'This API key does not work. Create one on your account page at converter.studio.',
		);
		assert.match(error.description, /account#api-keys/);
		return true;
	});
});

test('waits out a rate limit (Retry-After) and goes on', async () => {
	let first = true;
	const context = createContext({
		params: { resource: 'account', operation: 'get' },
		routes: () => {
			if (first) {
				first = false;
				return reply(
					429,
					{ error: { code: 'tooManyRequests', message: 'Slow down.' } },
					{ 'retry-after': '1' },
				);
			}
			return reply(200, { email: 'a@example.com', plan: 'free', credits: 13 });
		},
	});
	const started = Date.now();
	const [item] = await run(context);
	assert.equal(item.json.credits, 13);
	assert.equal(context.calls.length, 2);
	assert.ok(Date.now() - started >= 900, 'it paused for Retry-After');
});

test('gets the account', async () => {
	const account = { email: 'a@example.com', plan: 'pro', credits: 1099, maxFileBytes: 1073741824 };
	const context = createContext({
		params: { resource: 'account', operation: 'get' },
		routes: (request) => (request.path === '/api/v1/account' ? reply(200, account) : undefined),
	});
	const [item] = await run(context);
	assert.deepEqual(item.json, account);
	assert.equal(context.calls[0].auth, 'Bearer cvs_live_test');
});

test('lists formats, one item each, with a limit and a source filter', async () => {
	const all = ['png', 'jpg', 'pdf'].map((id) => ({
		id,
		name: id.toUpperCase(),
		category: 'x',
		extensions: [id],
		to: [],
	}));
	const context = createContext({
		params: { resource: 'format', operation: 'getAll', limit: 2, filters: { from: 'png' } },
		routes: (request) =>
			request.path === '/api/v1/formats' ? reply(200, { formats: all }) : undefined,
	});
	const output = await run(context);
	assert.deepEqual(
		output.map((item) => item.json.id),
		['png', 'jpg'],
	);
	assert.equal(context.calls[0].query.from, 'png');
});

test('gets a conversion by ID, and downloads its result when asked', async () => {
	const context = createContext({
		params: {
			resource: 'conversion',
			operation: 'get',
			conversionId: 'conv_12345678',
			waitForCompletion: false,
			downloadResult: true,
			simplify: false,
		},
		routes: uploadRoutes({ onPut: () => assert.fail() }),
	});
	const [item] = await run(context);
	assert.equal(item.json.next, 'Done.', 'the raw view without Simplify');
	assert.equal(context.calls[0].query.wait, undefined);
	assert.equal(item.binary.data.fileName, 'photo.jpg');
});

test('reading a failed conversion reports it without failing', async () => {
	const failed = view({
		status: 'failed',
		downloadUrl: null,
		error: { code: 'conversionFailed', message: 'x' },
	});
	const context = createContext({
		params: {
			resource: 'conversion',
			operation: 'get',
			conversionId: 'conv_12345678',
			waitForCompletion: false,
			downloadResult: true,
		},
		routes: uploadRoutes({ conversion: failed, onPut: () => assert.fail() }),
	});
	const [item] = await run(context);
	assert.equal(item.json.status, 'failed');
	assert.equal(item.binary, undefined);
});

test('rejects a conversion ID that cannot be one, before any request', async () => {
	const context = createContext({
		params: {
			resource: 'conversion',
			operation: 'get',
			conversionId: '../account',
			waitForCompletion: false,
		},
		routes: () => assert.fail('no request'),
	});
	await assert.rejects(run(context), /isn't a Converter Studio conversion ID/);
	assert.equal(context.calls.length, 0);
});

test('confirms a quoted conversion, waits and downloads', async () => {
	const context = createContext({
		params: { resource: 'conversion', operation: 'confirm', conversionId: 'conv_12345678' },
		routes: async (request) => {
			if (request.method === 'POST' && request.path === '/api/v1/conversions/conv_12345678/confirm')
				return reply(200, view({ status: 'queued', downloadUrl: null }));
			return await uploadRoutes({ onPut: () => assert.fail() })(request);
		},
	});
	const [item] = await run(context);
	assert.equal(item.json.status, 'done');
	assert.ok(item.binary.data);
	assert.deepEqual(
		context.calls.map((c) => c.method),
		['POST', 'GET', 'GET'],
	);
});

test('stops waiting after the timeout and names the conversion', async () => {
	const processing = view({ status: 'processing', downloadUrl: null });
	const context = createContext({
		params: {
			resource: 'file',
			operation: 'convert',
			source: 'url',
			url: 'https://example.com/a.mov',
			targetFormat: 'mp4',
			options: { timeout: 1, pollInterval: 1 },
		},
		routes: uploadRoutes({ conversion: processing, onPut: () => assert.fail() }),
		continueOnFail: true,
	});
	const [item] = await run(context);
	assert.match(item.json.error, /wasn't finished after 1 seconds/);
	assert.deepEqual(item.json.details, { code: 'timeout', conversionId: 'conv_12345678' });
});

test('when n8n stops the execution during the wait, the error names the conversion', async () => {
	const processing = view({ status: 'processing', downloadUrl: null });
	const controller = new AbortController();
	const routes = uploadRoutes({ conversion: processing, onPut: () => assert.fail() });
	const context = createContext({
		params: {
			resource: 'file',
			operation: 'convert',
			source: 'url',
			url: 'https://example.com/a.mov',
			targetFormat: 'webm',
		},
		routes: async (request) => {
			// The first status check is cut off by n8n's time limit, as n8n Cloud does.
			if (request.method === 'GET' && request.query.wait) {
				controller.abort();
				return { throw: Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' }) };
			}
			return await routes(request);
		},
	});
	context.getExecutionCancelSignal = () => controller.signal;
	await assert.rejects(run(context), (error) => {
		assert.match(error.message, /n8n stopped the execution while the node waited/);
		assert.match(error.description, /goes on at Converter Studio \(ID conv_12345678\)/);
		assert.match(error.description, /turn off 'Wait for Completion'/);
		return true;
	});
	assert.equal(context.calls.filter((c) => c.query.wait).length, 1);
});

test('a download link that expired says so', async () => {
	const context = createContext({
		params: {
			resource: 'conversion',
			operation: 'get',
			conversionId: 'conv_12345678',
			waitForCompletion: false,
			downloadResult: true,
		},
		routes: async (request) => {
			if (request.path === '/api/jobs/conv_12345678/download')
				return reply(410, Buffer.from('{"error":"fileExpired"}'));
			return await uploadRoutes({ onPut: () => assert.fail() })(request);
		},
	});
	await assert.rejects(run(context), (error) => {
		assert.equal(error.httpCode, '410');
		assert.match(error.message, /already been deleted/);
		return true;
	});
});

test('invalid JSON in Other Options stops the item before any request', async () => {
	const context = createContext({
		params: {
			resource: 'file',
			operation: 'convert',
			source: 'url',
			url: 'https://example.com/a.png',
			targetFormat: 'jpg',
			conversionOptions: { otherOptions: '{nope' },
		},
		routes: () => assert.fail('no request'),
	});
	await assert.rejects(run(context), /isn't valid JSON/);
});

test('processes every item and pairs each output with its input', async () => {
	const context = createContext({
		params: (name, i) =>
			({
				resource: 'file',
				operation: 'convert',
				source: 'url',
				url: `https://example.com/${i}.png`,
				targetFormat: 'jpg',
				downloadResult: false,
			})[name],
		items: [{ json: {} }, { json: {} }],
		routes: uploadRoutes({ onPut: () => assert.fail() }),
	});
	const output = await run(context);
	assert.deepEqual(
		output.map((item) => item.pairedItem),
		[{ item: 0 }, { item: 1 }],
	);
});
