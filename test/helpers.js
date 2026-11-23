'use strict';
/**
 * A stand-in for n8n's execution context (`IExecuteFunctions`) with a scripted HTTP server, so
 * the node's real code runs without n8n and without the network. Tests run against `dist/`.
 */
const { Readable } = require('node:stream');
const { NodeOperationError } = require('n8n-workflow');

const NODE = {
	id: 'test-node',
	name: 'Converter Studio',
	type: 'n8n-nodes-converter-studio.converterStudio',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

const BASE = 'https://converter.studio/api';

/** What a parameter is when a test does not set it: the node's own defaults for these. */
const DEFAULTS = {
	simplify: true,
	waitForCompletion: true,
	downloadResult: true,
	outputBinaryPropertyName: 'data',
	binaryPropertyName: 'data',
	source: 'binary',
	maxCredits: 20,
	aboveMaxCredits: 'fail',
	options: {},
	conversionOptions: {},
	filters: {},
	returnAll: false,
	limit: 50,
};

async function toBuffer(body) {
	if (Buffer.isBuffer(body)) return body;
	const chunks = [];
	for await (const chunk of body) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

/** A response of the scripted server. */
const reply = (statusCode, body, headers = {}) => ({ statusCode, body, headers });

/**
 * The execution a context runs in: n8n's execution ID, the node's run index and the node's
 * context (kept for the whole execution). `null` stands for none (an MCP Trigger's tool call).
 */
function newExecution(changes = {}) {
	return {
		id: '101',
		workflowId: 'wf_test',
		instanceId: 'instance_test',
		runIndex: 0,
		nodeContext: {},
		...changes,
	};
}

/**
 * A context for `execute`. `routes` answers each request: `(request) => response`, where
 * request = { method, url, path, query, headers, body, auth }. Every request is kept in `calls`.
 * Running the node again with the same context is what n8n's "Retry On Fail" does.
 */
function createContext({
	params = {},
	items = [{ json: {} }],
	routes,
	credentials = { apiKey: 'cvs_live_test', baseUrl: BASE },
	continueOnFail = false,
	binaryStore = new Map(),
	execution = newExecution(),
}) {
	const calls = [];
	const param = (name, i, fallback) => {
		const value = typeof params === 'function' ? params(name, i) : params[name];
		if (value !== undefined) return value;
		if (name in DEFAULTS) return DEFAULTS[name];
		if (fallback !== undefined) return fallback;
		throw new Error(`The test did not set the parameter '${name}'`);
	};

	async function send(options, auth) {
		const url = new URL(options.url);
		if (options.qs)
			for (const [k, v] of Object.entries(options.qs)) url.searchParams.set(k, String(v));
		const request = {
			method: options.method ?? 'GET',
			url: url.toString(),
			path: url.pathname,
			query: Object.fromEntries(url.searchParams),
			headers: options.headers ?? {},
			body: options.body,
			auth,
			options,
		};
		calls.push(request);
		const response = await routes(request);
		if (!response) throw new Error(`No route for ${request.method} ${request.url}`);
		if (response.throw) throw response.throw;
		let body = response.body;
		if (options.encoding === 'stream' && Buffer.isBuffer(body)) body = Readable.from([body]);
		if (!options.ignoreHttpStatusErrors && response.statusCode >= 400) {
			throw new Error(`HTTP ${response.statusCode}`);
		}
		return options.returnFullResponse
			? { statusCode: response.statusCode, headers: response.headers ?? {}, body }
			: body;
	}

	const noExecution = () => {
		throw new Error('`executionData` is not initialized');
	};
	const context = {
		calls,
		execution,
		getNode: () => NODE,
		getInputData: () => items,
		getNodeParameter: (name, i, fallback) => param(name, i, fallback),
		getCredentials: async () => credentials,
		continueOnFail: () => continueOnFail,
		getExecutionCancelSignal: () => undefined,
		// n8n's own placeholder when there is no execution yet.
		getExecutionId: () => (execution ? execution.id : '__UNKNOWN__'),
		getInstanceId: () => (execution ? execution.instanceId : 'instance_test'),
		getWorkflow: () => ({ id: execution?.workflowId, name: 'Test', active: false }),
		getWorkflowDataProxy: () => (execution ? { $runIndex: execution.runIndex } : noExecution()),
		getContext: (type) => (execution && type === 'node' ? execution.nodeContext : noExecution()),
		logger: { debug() {}, info() {}, warn() {}, error() {} },
		helpers: {
			async httpRequestWithAuthentication(type, options) {
				if (type !== 'converterStudioApi') throw new Error(`Unknown credential ${type}`);
				return await send(options, `Bearer ${credentials.apiKey}`);
			},
			async httpRequest(options) {
				return await send(options, undefined);
			},
			assertBinaryData(i, field) {
				const binary = items[i].binary?.[field];
				if (!binary) throw new NodeOperationError(NODE, `No binary data in '${field}'`);
				return binary;
			},
			async getBinaryDataBuffer(i, field) {
				const binary = items[i].binary[field];
				if (binary.id) return Buffer.concat(binaryStore.get(binary.id).chunks);
				return Buffer.from(binary.data, 'base64');
			},
			async getBinaryMetadata(id) {
				const stored = binaryStore.get(id);
				return { fileName: stored.fileName, mimeType: stored.mimeType, fileSize: stored.size };
			},
			async getBinaryStream(id) {
				return Readable.from(binaryStore.get(id).chunks);
			},
			binaryToBuffer: toBuffer,
			async binaryToString(body) {
				return (await toBuffer(body)).toString('utf8');
			},
			async prepareBinaryData(body, fileName, mimeType) {
				const data = await toBuffer(body);
				return {
					data: data.toString('base64'),
					fileName,
					mimeType: mimeType ?? 'application/octet-stream',
					fileSize: `${data.length} B`,
				};
			},
		},
	};
	return context;
}

/** A binary item as n8n keeps small files: base64 in memory. */
function binaryItem(bytes, fileName, mimeType = 'application/octet-stream') {
	return {
		json: {},
		binary: {
			data: { data: Buffer.from(bytes).toString('base64'), fileName, mimeType },
		},
	};
}

/** A conversion view as the API sends it. */
function view(overrides = {}) {
	const id = overrides.id ?? 'conv_12345678';
	return {
		id,
		status: 'done',
		from: 'png',
		to: 'jpg',
		inputName: 'photo.png',
		inputSize: 10,
		credits: 1,
		maxCredits: 20,
		progress: 1,
		outputName: 'photo.jpg',
		outputSize: 4,
		downloadUrl: `${BASE}/jobs/${id}/download?token=t`,
		expiresAt: '2026-11-22T08:00:00.000Z',
		error: null,
		next: 'Done.',
		...overrides,
	};
}

async function run(context) {
	const { ConverterStudio } = require('../dist/nodes/ConverterStudio/ConverterStudio.node.js');
	const node = new ConverterStudio();
	const [output] = await node.execute.call(context);
	return output;
}

module.exports = { BASE, NODE, binaryItem, createContext, newExecution, reply, run, view };
