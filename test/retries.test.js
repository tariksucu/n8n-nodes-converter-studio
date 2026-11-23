'use strict';
/**
 * Retries and callbacks of File > Convert: the Idempotency-Key that makes n8n's "Retry On Fail"
 * get the conversion an earlier try made, and the Callback URL for a second workflow. Running
 * the node again with the same context is what "Retry On Fail" does (same execution, same run).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { BASE, binaryItem, createContext, newExecution, reply, run, view } = require('./helpers');

const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');
const JPG = Buffer.from('ffd8ffe0', 'hex');

/**
 * A small Converter Studio: uploads get new IDs, and a conversion request with an
 * Idempotency-Key it has seen gets that key's conversion back (with another request: 409), as
 * the Converter Studio API does. `status(n)` is what the n-th new conversion's status checks
 * answer.
 */
function api({ status = () => 'done' } = {}) {
	const uploads = [];
	const conversions = [];
	const keys = new Map();
	const conversion = (id) => conversions.find((c) => c.id === id);
	const viewOf = (c) =>
		view({
			id: c.id,
			status: c.status,
			downloadUrl: c.status === 'done' ? `${BASE}/jobs/${c.id}/download?token=t` : null,
		});
	const routes = async (request) => {
		const { method, path } = request;
		if (method === 'POST' && path === '/api/v1/uploads') {
			const id = `upload_${uploads.length + 1}`;
			uploads.push(id);
			return reply(201, {
				id,
				uploadUrl: `${BASE}/v1/uploads/${id}?token=slot`,
				method: 'PUT',
				maxBytes: 1024 ** 3,
				partBytes: 95 * 1024 * 1024,
				expiresAt: '2026-11-22T03:00:00.000Z',
			});
		}
		if (method === 'PUT' && path.startsWith('/api/v1/uploads/')) {
			const id = path.split('/').pop();
			return reply(200, {
				id,
				status: 'ready',
				file: { name: 'photo.png', size: 10, format: 'png' },
			});
		}
		if (method === 'GET' && path === '/api/v1/formats') {
			return reply(200, {
				formats: [{ id: 'png', name: 'PNG', category: 'image', extensions: ['png'], to: ['jpg'] }],
			});
		}
		if (method === 'POST' && path === '/api/v1/conversions') {
			const key = request.headers['Idempotency-Key'];
			const asked = JSON.stringify(request.body);
			if (key && keys.has(key)) {
				const held = keys.get(key);
				if (held.asked !== asked) {
					return reply(409, {
						error: {
							code: 'idempotencyKeyReused',
							message:
								'This Idempotency-Key was already used in the last 24 hours for a different request.',
						},
					});
				}
				return reply(200, viewOf(conversion(held.id)), { 'idempotent-replayed': 'true' });
			}
			const made = {
				id: request.body.uploadId ?? `conv_${conversions.length + 1}xyz`,
				n: conversions.length,
				status: 'queued',
				checks: 0,
			};
			conversions.push(made);
			if (key) keys.set(key, { id: made.id, asked });
			return reply(201, viewOf(made));
		}
		const found = /^\/api\/v1\/conversions\/([\w-]+)$/.exec(path);
		if (method === 'GET' && found && conversion(found[1])) {
			const c = conversion(found[1]);
			c.status = status(c.n, ++c.checks);
			return reply(200, viewOf(c));
		}
		if (method === 'GET' && path.startsWith('/api/jobs/')) {
			return reply(200, JPG, { 'content-type': 'image/jpeg' });
		}
		return undefined;
	};
	return { routes, uploads, conversions };
}

const convertParams = (changes = {}) => ({
	resource: 'file',
	operation: 'convert',
	targetFormat: 'jpg',
	...changes,
});

const posts = (context) =>
	context.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/conversions');
const keyOf = (call) => call.headers['Idempotency-Key'];

test('Retry On Fail gets the conversion of the earlier try: same key, same upload, one conversion', async () => {
	// The first try gives up waiting (Timeout) while the conversion is still processing; the
	// second finds it done. (Counting status checks instead made the first try flaky: a timer may
	// fire a millisecond early, so a second check could still fit before the timeout.)
	let firstTryOver = false;
	const server = api({ status: () => (firstTryOver ? 'done' : 'processing') });
	const context = createContext({
		params: convertParams({ options: { timeout: 0.01, pollInterval: 1 } }),
		items: [binaryItem(PNG, 'photo.png', 'image/png')],
		routes: server.routes,
	});
	await assert.rejects(run(context), /wasn't finished after/);
	firstTryOver = true;
	const [item] = await run(context);

	assert.equal(item.json.status, 'done');
	assert.equal(item.json.id, 'upload_1');
	assert.deepEqual(Buffer.from(item.binary.data.data, 'base64'), JPG);
	assert.equal(server.uploads.length, 1, 'the retry sends no second upload');
	assert.equal(server.conversions.length, 1, 'and makes no second conversion');
	const [first, second] = posts(context);
	assert.match(keyOf(first), /^n8n-[0-9a-f]{64}$/);
	assert.equal(keyOf(second), keyOf(first));
	assert.deepEqual(second.body, first.body);
});

test('a lost answer is sent again with the same key and gives one conversion', async () => {
	const server = api();
	let lost = false;
	const context = createContext({
		params: convertParams({
			source: 'url',
			url: 'https://example.com/a.png',
			downloadResult: false,
		}),
		routes: async (request) => {
			// The request arrives and makes its conversion, but its answer is lost on the way back.
			if (request.method === 'POST' && request.path === '/api/v1/conversions' && !lost) {
				lost = true;
				await server.routes(request);
				return { throw: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) };
			}
			return await server.routes(request);
		},
	});
	const [item] = await run(context);
	assert.equal(item.json.status, 'done');
	assert.equal(server.conversions.length, 1);
	const [first, second] = posts(context);
	assert.equal(keyOf(second), keyOf(first));
});

test('without an execution ID there is no key, and a lost answer is not sent again', async () => {
	const context = createContext({
		params: convertParams({
			source: 'url',
			url: 'https://example.com/a.png',
			downloadResult: false,
		}),
		execution: null,
		routes: async (request) =>
			request.method === 'POST'
				? { throw: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) }
				: undefined,
	});
	await assert.rejects(run(context));
	const [only, ...more] = posts(context);
	assert.equal(keyOf(only), undefined);
	assert.equal(more.length, 0);
});

test('each item, each run of the node and each execution gets its own key', async () => {
	const keys = async (execution, items = 2) => {
		const context = createContext({
			params: (name, i) =>
				convertParams({
					source: 'url',
					url: `https://example.com/${i}.png`,
					downloadResult: false,
				})[name],
			items: Array.from({ length: items }, () => ({ json: {} })),
			routes: api().routes,
			execution,
		});
		await run(context);
		return posts(context).map(keyOf);
	};
	const [a0, a1] = await keys(newExecution());
	const [b0] = await keys(newExecution({ runIndex: 1 }));
	const [c0] = await keys(newExecution({ id: '102' }));
	const [d0] = await keys(newExecution({ instanceId: 'another_instance' }));
	const [e0] = await keys(newExecution());
	assert.equal(new Set([a0, a1, b0, c0, d0]).size, 5);
	assert.equal(e0, a0, 'the same execution, run and item give the same key');
});

test('a retry after a failed conversion starts a new one, with a new upload', async () => {
	const server = api({ status: (n) => (n === 0 ? 'failed' : 'done') });
	const context = createContext({
		params: convertParams(),
		items: [binaryItem(PNG, 'photo.png', 'image/png')],
		routes: server.routes,
	});
	await assert.rejects(run(context), /did not succeed/);
	const [item] = await run(context);
	assert.equal(item.json.status, 'done');
	assert.equal(server.uploads.length, 2);
	assert.equal(server.conversions.length, 2);
	const [first, second] = posts(context);
	assert.notEqual(keyOf(second), keyOf(first));
	assert.equal(second.body.uploadId, 'upload_2');
});

test('settings that change between two tries: the key is refused, the next try starts anew', async () => {
	// The first conversion never finishes, so the first try always ends at its timeout.
	const server = api({ status: (n) => (n === 0 ? 'processing' : 'done') });
	let maxCredits = 20;
	const context = createContext({
		params: (name) =>
			convertParams({
				source: 'url',
				url: 'https://example.com/a.png',
				maxCredits,
				options: { timeout: 0.01, pollInterval: 1 },
			})[name],
		routes: server.routes,
	});
	await assert.rejects(run(context), /wasn't finished after/);
	maxCredits = 5;
	await assert.rejects(run(context), (error) => {
		assert.match(error.description, /settings of this item changed between two tries/);
		return true;
	});
	const [item] = await run(context);
	assert.equal(item.json.status, 'done');
	const [first, refused, third] = posts(context);
	assert.equal(keyOf(refused), keyOf(first));
	assert.notEqual(keyOf(third), keyOf(first));
	assert.equal(server.conversions.length, 2);
});

test('a Callback URL goes with a conversion that is not waited for', async () => {
	const server = api({ status: () => 'processing' });
	const params = convertParams({
		source: 'url',
		url: 'https://example.com/a.png',
		waitForCompletion: false,
		options: { callbackUrl: ' https://n8n.example.com/webhook/converter-studio ' },
	});
	const context = createContext({ params, routes: server.routes });
	const [item] = await run(context);
	assert.equal(item.json.status, 'queued');
	assert.equal(item.binary, undefined);
	assert.equal(
		posts(context)[0].body.callbackUrl,
		'https://n8n.example.com/webhook/converter-studio',
	);
	assert.equal(context.calls.length, 1, 'no status checks');

	// A node that waits gets the result itself: a Callback URL left in its options is not sent.
	const waiting = createContext({
		params: { ...params, waitForCompletion: true },
		routes: api().routes,
	});
	await run(waiting);
	assert.equal(posts(waiting)[0].body.callbackUrl, undefined);
});

test('a Callback URL that is no web address stops the item before anything is sent', async () => {
	const context = createContext({
		params: convertParams({
			waitForCompletion: false,
			options: { callbackUrl: 'n8n.example.com/webhook/converter-studio' },
		}),
		items: [binaryItem(PNG, 'photo.png', 'image/png')],
		routes: () => assert.fail('no request'),
	});
	await assert.rejects(run(context), (error) => {
		assert.match(error.message, /'Callback URL' isn't a web address/);
		return true;
	});
});

test("the API's refusal of a Callback URL says what to use", async () => {
	const context = createContext({
		params: convertParams({
			source: 'url',
			url: 'https://example.com/a.png',
			waitForCompletion: false,
			options: { callbackUrl: 'https://localhost/webhook/x' },
		}),
		routes: async () =>
			reply(400, {
				error: {
					code: 'invalidCallbackUrl',
					message: 'The callbackUrl must be a full https:// address on the public internet.',
				},
			}),
	});
	await assert.rejects(run(context), (error) => {
		assert.match(error.message, /public internet/);
		assert.match(error.description, /Production URL of a Webhook node/);
		return true;
	});
});
