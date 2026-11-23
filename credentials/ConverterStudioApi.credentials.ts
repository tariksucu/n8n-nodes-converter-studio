import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ConverterStudioApi implements ICredentialType {
	name = 'converterStudioApi';

	displayName = 'Converter Studio API';

	icon: Icon = {
		light: 'file:../icons/converterStudio.svg',
		dark: 'file:../icons/converterStudio.dark.svg',
	};

	documentationUrl = 'https://converter.studio/developers';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Create a key on your account page at https://converter.studio/account#api-keys. Keys start with cvs_live_.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://converter.studio/api',
			description:
				'Address of the Converter Studio API, without /v1. Keep the default unless you test against another Converter Studio server.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/account',
			method: 'GET',
		},
		// Without these, a failed test only says "Unauthorized" or "Not Found".
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						"Converter Studio doesn't accept this API key. Create one on https://converter.studio/account#api-keys; keys start with cvs_live_.",
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 404,
					message:
						"There's no Converter Studio API at this Base URL. Use https://converter.studio/api, without /v1.",
				},
			},
		],
	};
}
