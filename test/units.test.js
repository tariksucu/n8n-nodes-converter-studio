'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const transport = require('../dist/nodes/ConverterStudio/shared/transport.js');
const upload = require('../dist/nodes/ConverterStudio/shared/upload.js');
const formats = require('../dist/nodes/ConverterStudio/shared/formats.js');
const conversion = require('../dist/nodes/ConverterStudio/shared/conversion.js');
const options = require('../dist/nodes/ConverterStudio/descriptions/conversionOptions.js');
const { ConverterStudioApi } = require('../dist/credentials/ConverterStudioApi.credentials.js');
const { ConverterStudio } = require('../dist/nodes/ConverterStudio/ConverterStudio.node.js');
const packageJson = require('../package.json');

test('the base URL loses its trailing slash and /v1, and must be a web address', () => {
	assert.equal(
		transport.normalizeBaseUrl('https://converter.studio/api/'),
		'https://converter.studio/api',
	);
	assert.equal(
		transport.normalizeBaseUrl('https://converter.studio/api/v1'),
		'https://converter.studio/api',
	);
	assert.equal(
		transport.normalizeBaseUrl(' http://localhost:8080/api '),
		'http://localhost:8080/api',
	);
	assert.equal(transport.normalizeBaseUrl(''), 'https://converter.studio/api');
	assert.equal(transport.normalizeBaseUrl('converter.studio'), undefined);
});

test('error bodies of both shapes give their code', () => {
	assert.deepEqual(
		transport.errorOf({ error: { code: 'notFound', message: 'm', params: { a: 1 } } }),
		{
			code: 'notFound',
			message: 'm',
			params: { a: 1 },
		},
	);
	assert.deepEqual(transport.errorOf('{"error":"fileExpired"}'), { code: 'fileExpired' });
	assert.deepEqual(transport.errorOf('<html>'), {});
});

test('the pause before a retry follows Retry-After, then the rate-limit reset, within a minute', () => {
	assert.equal(transport.retryDelay({ statusCode: 429, headers: { 'retry-after': '3' } }, 0), 3000);
	assert.equal(
		transport.retryDelay({ statusCode: 429, headers: { 'x-ratelimit-reset': '7' } }, 0),
		7000,
	);
	assert.equal(
		transport.retryDelay({ statusCode: 429, headers: { 'retry-after': '600' } }, 0),
		60000,
	);
	assert.equal(transport.retryDelay({ statusCode: 503, headers: {} }, 2), 8000);
	assert.equal(transport.retryDelay(undefined, 0), 2000);
});

test('a stream is cut into parts of exactly partBytes', async () => {
	const stream = Readable.from([Buffer.from('ab'), Buffer.from('cdefg'), 'hij']);
	const parts = [];
	for await (const part of upload.partsOf(stream, 4)) parts.push(part.toString());
	assert.deepEqual(parts, ['abcd', 'efgh', 'ij']);
});

test('long file names are shortened and keep their extension', () => {
	const name = upload.uploadName(`${'a'.repeat(300)}.docx`);
	assert.equal(name.length, 255);
	assert.ok(name.endsWith('.docx'));
	assert.equal(upload.uploadName('  '), 'file');
});

test('a link or a name gives its format by extension, the longest first', () => {
	const list = [
		{ id: 'gz', name: 'GZ', category: 'archive', extensions: ['gz'], to: [] },
		{ id: 'tgz', name: 'TAR.GZ', category: 'archive', extensions: ['tar.gz', 'tgz'], to: [] },
		{ id: 'heic', name: 'HEIC', category: 'image', extensions: ['heic', 'heif'], to: ['jpg'] },
	];
	assert.equal(formats.formatOfName('https://example.com/a/Photo.HEIC?x=1', list)?.id, 'heic');
	assert.equal(formats.formatOfName('backup.tar.gz', list)?.id, 'tgz');
	assert.equal(formats.formatOfName('https://drive.google.com/file/d/abc/view', list), undefined);
});

test('target options list what the source converts to, or every target', () => {
	const list = [
		{ id: 'png', name: 'PNG', category: 'image', extensions: ['png'], to: ['webp', 'jpg'] },
		{ id: 'jpg', name: 'JPG', category: 'image', extensions: ['jpg'], to: ['png', 'pdf'] },
	];
	assert.deepEqual(
		formats.targetOptions(list, list[0]).map((o) => o.value),
		['jpg', 'webp'],
	);
	assert.deepEqual(
		formats.targetOptions(list).map((o) => o.value),
		['jpg', 'pdf', 'png', 'webp'],
	);
});

test('conversion options: typed values, JSON extras, empty values left out', () => {
	const result = options.buildConversionOptions({
		quality: 'high',
		pageRange: '',
		background: '#ABCDEF80',
		otherOptions: '{"vbr": "high", "quality": "small"}',
	});
	assert.deepEqual(result, {
		ok: true,
		options: { vbr: 'high', quality: 'high', background: '#abcdef' },
	});
	assert.deepEqual(options.buildConversionOptions({}), { ok: true, options: undefined });
	assert.equal(options.buildConversionOptions({ otherOptions: '[1]' }).ok, false);
	assert.equal(options.hexColor('#fa0'), '#ffaa00');
});

test('Content-Disposition names are read, plain and encoded', () => {
	assert.equal(conversion.dispositionName('attachment; filename="a b.pdf"'), 'a b.pdf');
	assert.equal(conversion.dispositionName("attachment; filename*=UTF-8''%C3%A7.pdf"), 'ç.pdf');
	assert.equal(conversion.dispositionName(undefined), undefined);
});

test('the credential sends the key as a bearer token and tests it on /v1/account', () => {
	const credential = new ConverterStudioApi();
	assert.equal(credential.name, 'converterStudioApi');
	assert.equal(
		credential.authenticate.properties.headers.Authorization,
		'=Bearer {{$credentials.apiKey}}',
	);
	assert.deepEqual(credential.test.request, {
		baseURL: '={{$credentials.baseUrl}}',
		url: '/v1/account',
		method: 'GET',
	});
	// n8n shows the message of the rule for the status of a failed test.
	const rule = (status) =>
		credential.test.rules.find((r) => r.type === 'responseCode' && r.properties.value === status)
			?.properties.message;
	assert.match(rule(401), /doesn't accept this API key.*account#api-keys/);
	assert.match(rule(404), /no Converter Studio API at this Base URL/);
	const key = credential.properties.find((p) => p.name === 'apiKey');
	assert.equal(key.typeOptions.password, true);
	assert.equal(
		credential.properties.find((p) => p.name === 'baseUrl').default,
		'https://converter.studio/api',
	);
});

test('the package lists the built node and credential, and no runtime dependencies', () => {
	const fs = require('node:fs');
	const path = require('node:path');
	for (const file of [...packageJson.n8n.nodes, ...packageJson.n8n.credentials]) {
		assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `${file} is built`);
	}
	assert.equal(packageJson.dependencies, undefined);
	assert.deepEqual(packageJson.peerDependencies, { 'n8n-workflow': '*' });
	assert.ok(packageJson.keywords.includes('n8n-community-node-package'));
	assert.equal(packageJson.license, 'MIT');
});

test('every operation has an action, and parameters show only where they belong', () => {
	const { properties } = new ConverterStudio().description;
	const operations = properties.filter((p) => p.name === 'operation');
	for (const operation of operations) {
		for (const option of operation.options)
			assert.ok(option.action, `${option.name} has an action`);
	}
	for (const property of properties) {
		if (property.name === 'resource' || property.name === 'operation') continue;
		assert.ok(property.displayOptions?.show?.resource, `${property.name} is shown for a resource`);
	}
});
