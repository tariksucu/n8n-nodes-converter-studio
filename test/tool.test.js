'use strict';
/**
 * The Target Format list where the editor can't know the file (a binary file, an expression, a
 * link an AI agent fills in), and the node as an AI agent's tool.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { NODE, binaryItem, createContext, reply, run, view } = require('./helpers');
const formats = require('../dist/nodes/ConverterStudio/shared/formats.js');
const { ConverterStudio } = require('../dist/nodes/ConverterStudio/ConverterStudio.node.js');

const FORMATS = [
	{ id: 'docx', name: 'DOCX', category: 'document', extensions: ['docx'], to: ['pdf', 'txt'] },
	{ id: 'png', name: 'PNG', category: 'image', extensions: ['png'], to: ['jpg', 'webp'] },
];

/** The API's format list: all of it, or `?from=` one format. */
const formatRoute = (request) =>
	reply(200, {
		formats: request.query.from
			? FORMATS.filter((format) => format.id === request.query.from)
			: FORMATS,
	});

/** A context for a `loadOptions` method: what the editor sends as the node's current parameters. */
function loadOptionsContext(current) {
	const context = createContext({
		routes: (request) => (request.path === '/api/v1/formats' ? formatRoute(request) : undefined),
	});
	context.getCurrentNodeParameter = (name) => current[name];
	return context;
}

const targetsFor = async (current) =>
	await new ConverterStudio().methods.loadOptions.getTargetFormats.call(
		loadOptionsContext(current),
	);

test('a link with a known extension lists only what its format converts to', async () => {
	const options = await targetsFor({ source: 'url', url: 'https://example.com/report.docx' });
	assert.deepEqual(
		options.map((option) => [option.value, option.description]),
		[
			['pdf', 'DOCX to PDF'],
			['txt', 'DOCX to TXT'],
		],
	);
});

test('without a source the editor can see, the list has every target and says it is checked later', async () => {
	const fromAgent =
		"={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('File_URL', ``, 'string') }}";
	for (const current of [
		// What n8n's editor sends for a link it can't resolve: the AI agent's ($fromAI), or an
		// expression without data.
		{ source: 'url', url: null },
		{ source: 'url', url: fromAgent },
		{ source: 'url', url: '' },
		{ source: 'url', url: 'https://drive.google.com/file/d/abc/view' },
		{ source: 'binary' },
		{},
	]) {
		const options = await targetsFor(current);
		assert.deepEqual(
			options.map((option) => option.value),
			['jpg', 'pdf', 'txt', 'webp'],
			JSON.stringify(current),
		);
		for (const option of options) {
			assert.match(option.description, /checked against the file when the node runs/);
		}
	}
});

test("the list reloads with 'File URL' without the editor having to resolve it first", () => {
	const target = new ConverterStudio().description.properties.find(
		(property) => property.name === 'targetFormat',
	);
	// n8n's editor resolves a parameter named plainly in loadOptionsDependsOn before it asks for
	// the list, and fails ("Error fetching options") when it can't, as with $fromAI. '&url' names
	// the same parameter without that.
	assert.deepEqual(target.typeOptions.loadOptionsDependsOn, ['source', '&url']);
});

/** A context for the node as n8n's tool version of it runs (an AI agent's tool). */
function toolContext(options) {
	const context = createContext(options);
	context.getNode = () => ({ ...NODE, type: `${NODE.type}Tool` });
	return context;
}

const impossibleLink = {
	resource: 'file',
	operation: 'convert',
	source: 'url',
	url: 'http://files.example/sample.docx',
	targetFormat: 'mp3',
	downloadResult: false,
};

/** The API: the link's conversion fails as the server fails it, once it knows the file is a DOCX. */
function impossibleRoutes(request) {
	if (request.path === '/api/v1/formats') return formatRoute(request);
	const failed = view({
		status: 'failed',
		from: 'docx',
		to: 'mp3',
		downloadUrl: null,
		error: {
			code: 'unsupportedConversion',
			message: "We can't convert docx to mp3 yet.",
			params: { from: 'docx', to: 'mp3' },
		},
	});
	if (request.method === 'POST' && request.path === '/api/v1/conversions')
		return reply(201, view({ status: 'fetching', from: null, downloadUrl: null }));
	if (request.path === '/api/v1/conversions/conv_12345678') return reply(200, failed);
	return undefined;
}

test("as a tool, an impossible pair fails with the API's message and what the file converts to", async () => {
	const context = toolContext({ params: impossibleLink, routes: impossibleRoutes });
	await assert.rejects(run(context), (error) => {
		// n8n's AI Agent hands the model only the message.
		assert.equal(
			error.message,
			"We can't convert docx to mp3 yet.\n\nDetails: DOCX converts to: pdf, txt.",
		);
		return true;
	});
	assert.equal(context.calls.filter((call) => call.query.from === 'docx').length, 1);

	const [item] = await run(
		toolContext({ params: impossibleLink, routes: impossibleRoutes, continueOnFail: true }),
	);
	assert.match(item.json.error, /DOCX converts to: pdf, txt/);
	assert.equal(item.json.details.code, 'unsupportedConversion');
});

test('outside a tool, the same failure is as before: the message, and the hint under it', async () => {
	const context = createContext({ params: impossibleLink, routes: impossibleRoutes });
	await assert.rejects(run(context), (error) => {
		assert.equal(error.message, "We can't convert docx to mp3 yet.");
		assert.match(error.description, /Choose another 'Target Format'/);
		return true;
	});
	assert.equal(context.calls.filter((call) => call.path === '/api/v1/formats').length, 0);
});

test("as a tool, the node's own check of a binary file says what it converts to in the message", async () => {
	const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');
	const routes = (request) => {
		if (request.method === 'POST' && request.path === '/api/v1/uploads') {
			return reply(201, {
				id: 'conv_12345678',
				uploadUrl: 'https://converter.studio/api/v1/uploads/conv_12345678?token=slot',
				method: 'PUT',
				maxBytes: 1024 ** 3,
				partBytes: 95 * 1024 * 1024,
				expiresAt: '2026-11-22T03:00:00.000Z',
			});
		}
		if (request.method === 'PUT') {
			return reply(200, {
				id: 'conv_12345678',
				status: 'ready',
				file: { name: 'photo.png', size: PNG.length, format: 'png' },
			});
		}
		if (request.path === '/api/v1/formats') return formatRoute(request);
		return undefined;
	};
	const context = toolContext({
		params: { resource: 'file', operation: 'convert', targetFormat: 'mp3' },
		items: [binaryItem(PNG, 'photo.png')],
		routes,
	});
	await assert.rejects(run(context), (error) => {
		assert.match(
			error.message,
			/^Converter Studio can't convert PNG to MP3\n\nDetails: PNG converts to: jpg, webp\./,
		);
		return true;
	});
	assert.ok(!context.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/conversions'));
});
