'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createContext, reply, run } = require('./helpers');
const { version } = require('../package.json');

test("names itself on API calls with the package's version (X-Converter-Studio-Client)", async () => {
	const context = createContext({
		params: { resource: 'account', operation: 'get' },
		routes: (request) =>
			request.path === '/api/v1/account' ? reply(200, { plan: 'free', credits: 13 }) : undefined,
	});
	await run(context);
	assert.equal(context.calls.length, 1);
	assert.equal(context.calls[0].headers['X-Converter-Studio-Client'], `n8n/${version}`);
	assert.match(version, /^\d+\.\d+\.\d+$/);
});
