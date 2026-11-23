import type { INodeProperties } from 'n8n-workflow';
import { conversionOptionsCollection } from './conversionOptions';

const show = (resource: string, operation: string[]) => ({
	show: { resource: [resource], operation },
});

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Account', value: 'account' },
		{ name: 'Conversion', value: 'conversion' },
		{ name: 'File', value: 'file' },
		{ name: 'Format', value: 'format' },
	],
	default: 'file',
};

export const operationProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['file'] } },
		options: [
			{
				name: 'Convert',
				value: 'convert',
				description: 'Convert a file to another format and get the result',
				action: 'Convert a file',
			},
		],
		default: 'convert',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['conversion'] } },
		options: [
			{
				name: 'Confirm',
				value: 'confirm',
				description: 'Start a quoted conversion that costs more than its max credits',
				action: 'Confirm a conversion',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve a conversion with its status and result',
				action: 'Get a conversion',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['account'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve the plan and the credits left of the account',
				action: 'Get the account',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['format'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of formats and what each converts to',
				action: 'Get many formats',
			},
		],
		default: 'getAll',
	},
];

const WAIT_DESCRIPTION =
	"Whether to wait until the conversion is finished. Otherwise the node outputs the conversion as it is now; get it later with the 'Get' operation of the 'Conversion' resource. Turn it off for conversions that take longer than n8n lets an execution run (on n8n Cloud, 5 minutes on the Starter plan).";
const CONVERT_WAIT_DESCRIPTION = `${WAIT_DESCRIPTION} Then 'Callback URL' in 'Options' can start another workflow when it is finished.`;
const DOWNLOAD_DESCRIPTION =
	'Whether to download the converted file into the binary data of the output item once the conversion is done';

/** Where the downloaded file goes, and 'Simplify', for an operation that starts or reads a conversion. */
function outputProperties(
	resource: string,
	operation: string,
	afterWait: boolean,
): INodeProperties[] {
	return [
		{
			displayName: 'Put Output File in Field',
			name: 'outputBinaryPropertyName',
			type: 'string',
			default: 'data',
			required: true,
			displayOptions: {
				show: {
					resource: [resource],
					operation: [operation],
					downloadResult: [true],
					// Where 'Download Result' shows only while waiting, so does this.
					...(afterWait ? { waitForCompletion: [true] } : {}),
				},
			},
			hint: 'The name of the output binary field to put the file in',
		},
		{
			displayName: 'Simplify',
			name: 'simplify',
			type: 'boolean',
			default: true,
			displayOptions: show(resource, [operation]),
			description: 'Whether to return a simplified version of the response instead of the raw data',
		},
	];
}

/** Waiting for the result and downloading it: on by default where a conversion starts. */
function startedResultProperties(
	resource: string,
	operation: string,
	waitDescription = WAIT_DESCRIPTION,
): INodeProperties[] {
	return [
		{
			displayName: 'Wait for Completion',
			name: 'waitForCompletion',
			type: 'boolean',
			default: true,
			displayOptions: show(resource, [operation]),
			description: waitDescription,
		},
		{
			displayName: 'Download Result',
			name: 'downloadResult',
			type: 'boolean',
			default: true,
			displayOptions: {
				show: { resource: [resource], operation: [operation], waitForCompletion: [true] },
			},
			description: DOWNLOAD_DESCRIPTION,
		},
		...outputProperties(resource, operation, true),
	];
}

const waitOptions: INodeProperties[] = [
	{
		displayName: 'Polling Interval (Seconds)',
		name: 'pollInterval',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 60 },
		default: 2,
		description:
			'The shortest time between two status checks. Each check waits on Converter Studio until something changes, so a finished conversion is seen at once.',
	},
	{
		displayName: 'Timeout (Seconds)',
		name: 'timeout',
		type: 'number',
		typeOptions: { minValue: 10, maxValue: 86400 },
		default: 600,
		description:
			"How long to wait for the conversion at most. After that the node stops with a message, and the conversion goes on at Converter Studio; get it later with the 'Get' operation. An execution time limit of n8n (n8n Cloud has one) ends the wait sooner.",
	},
];

const fileConvert: INodeProperties[] = [
	{
		displayName: 'Source',
		name: 'source',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Binary File',
				value: 'binary',
				description: 'A file in the binary data of the input item',
			},
			{
				name: 'URL',
				value: 'url',
				description: 'A link to the file, which Converter Studio downloads itself',
			},
		],
		default: 'binary',
		displayOptions: show('file', ['convert']),
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { resource: ['file'], operation: ['convert'], source: ['binary'] } },
		hint: 'The name of the input binary field containing the file to be converted',
	},
	{
		displayName: 'File URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. https://example.com/photo.heic',
		displayOptions: { show: { resource: ['file'], operation: ['convert'], source: ['url'] } },
		description:
			'A direct link to the file, or a share link of Google Drive, Dropbox or OneDrive that anyone with the link can open',
	},
	{
		displayName: 'Target Format Name or ID',
		name: 'targetFormat',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getTargetFormats',
			loadOptionsDependsOn: ['source', 'url'],
		},
		default: '',
		required: true,
		displayOptions: show('file', ['convert']),
		description:
			'The format to convert the file to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Max Credits',
		name: 'maxCredits',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 100000 },
		default: 20,
		displayOptions: show('file', ['convert']),
		description:
			'The most the conversion may cost to start on its own. Most files cost 1 credit. Audio and video are priced once Converter Studio has measured them: by length, and video also by frame size and the format made (WebM costs several times as much as MP4). 0 only gets the price.',
	},
	{
		displayName: 'Above Max Credits',
		name: 'aboveMaxCredits',
		type: 'options',
		options: [
			{
				name: 'Fail the Item',
				value: 'fail',
				description: 'Stop the item with a message that says the price',
			},
			{
				name: 'Return Quote',
				value: 'quote',
				description:
					"Output the priced conversion with status 'quoted', to start it later with the 'Confirm' operation",
			},
		],
		default: 'fail',
		displayOptions: show('file', ['convert']),
		description: "What to do when the conversion costs more than 'Max Credits'",
	},
	...startedResultProperties('file', 'convert', CONVERT_WAIT_DESCRIPTION),
	{ ...conversionOptionsCollection, displayOptions: show('file', ['convert']) },
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show('file', ['convert']),
		options: [
			{
				displayName: 'Callback URL',
				name: 'callbackUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://n8n.example.com/webhook/converter-studio',
				displayOptions: { show: { '/waitForCompletion': [false] } },
				description:
					"An address Converter Studio sends a POST request to when the conversion ends (done, failed or canceled), and before that if it waits as quoted: for example the Production URL of a Webhook node in another workflow, which then gets the result with 'Conversion > Get'. The request isn't signed, so take it as a hint and get the conversion before acting on it. Use https:// and an address that can be reached from the internet.",
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'e.g. report.docx',
				displayOptions: { show: { '/source': ['binary'] } },
				description:
					'The name of the input file, with its extension, as Converter Studio gets it. By default the name of the binary file.',
			},
			...waitOptions,
		],
	},
];

const conversionIdProperty = (operation: string): INodeProperties => ({
	displayName: 'Conversion ID',
	name: 'conversionId',
	type: 'string',
	default: '',
	required: true,
	placeholder: 'e.g. MnweVUQHL9P2X_J1',
	displayOptions: show('conversion', [operation]),
	description: 'The ID of the conversion, as the Convert operation outputs it',
});

const conversionWaitOptions = (operation: string): INodeProperties => ({
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	displayOptions: show('conversion', [operation]),
	options: waitOptions,
});

const conversionGet: INodeProperties[] = [
	conversionIdProperty('get'),
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: false,
		displayOptions: show('conversion', ['get']),
		description: WAIT_DESCRIPTION,
	},
	{
		displayName: 'Download Result',
		name: 'downloadResult',
		type: 'boolean',
		default: false,
		displayOptions: show('conversion', ['get']),
		description: DOWNLOAD_DESCRIPTION,
	},
	...outputProperties('conversion', 'get', false),
	conversionWaitOptions('get'),
];

const conversionConfirm: INodeProperties[] = [
	conversionIdProperty('confirm'),
	...startedResultProperties('conversion', 'confirm'),
	conversionWaitOptions('confirm'),
];

const formatGetAll: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: show('format', ['getAll']),
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { resource: ['format'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('format', ['getAll']),
		options: [
			{
				displayName: 'Source Format Name or ID',
				name: 'from',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSourceFormats' },
				default: '',
				description:
					'Only this format, with what it converts to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
];

export const nodeProperties: INodeProperties[] = [
	resourceProperty,
	...operationProperties,
	...fileConvert,
	...conversionGet,
	...conversionConfirm,
	...formatGetAll,
];
