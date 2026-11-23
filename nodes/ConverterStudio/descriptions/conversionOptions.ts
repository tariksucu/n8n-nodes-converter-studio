import type { IDataObject, INodeProperties } from 'n8n-workflow';

/**
 * Settings of a conversion, as the API's `options` object takes them. Each applies only to some
 * conversions (its description says which); Converter Studio leaves out the ones that don't
 * apply. 'Other Options (JSON)' takes the API's remaining settings by their API names.
 */
export const conversionOptionsCollection: INodeProperties = {
	displayName: 'Conversion Options',
	name: 'conversionOptions',
	type: 'collection',
	placeholder: 'Add Conversion Option',
	default: {},
	description:
		'Settings of the conversion. Each applies only to the formats its description names; Converter Studio skips the others.',
	options: [
		{
			displayName: 'Archive Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Password of a locked ZIP, 7Z or RAR archive. Used for this conversion only and never stored.',
		},
		{
			displayName: 'Audio Bitrate',
			name: 'bitrate',
			type: 'options',
			options: [
				{ name: '64 Kbps', value: '64' },
				{ name: '96 Kbps', value: '96' },
				{ name: '128 Kbps', value: '128' },
				{ name: '192 Kbps', value: '192' },
				{ name: '256 Kbps', value: '256' },
				{ name: '320 Kbps', value: '320' },
			],
			default: '192',
			description:
				'Bitrate of lossy audio (MP3, AAC, M4A, OGG, Opus, WMA) and of the sound taken from a video. Opus goes up to 256 kbps.',
		},
		{
			displayName: 'Audio Channels',
			name: 'channels',
			type: 'options',
			options: [
				{ name: 'Mono', value: 'mono' },
				{ name: 'Stereo', value: 'stereo' },
			],
			default: 'stereo',
			description: 'Sound: stereo or mono. Kept as it is when not set.',
		},
		{
			displayName: 'Background Color',
			name: 'background',
			type: 'color',
			default: '#ffffff',
			description: 'JPG and BMP: the color behind what was transparent in the picture',
		},
		{
			displayName: 'Book Author',
			name: 'bookAuthor',
			type: 'string',
			default: '',
			description: "E-books: the author the book shows. By default the book's own.",
		},
		{
			displayName: 'Book Title',
			name: 'bookTitle',
			type: 'string',
			default: '',
			description:
				"E-books: the title the book shows. By default the book's own, or the file name.",
		},
		{
			displayName: 'CSV Delimiter',
			name: 'csvDelimiter',
			type: 'options',
			options: [
				{ name: 'Comma', value: 'comma' },
				{ name: 'Semicolon', value: 'semicolon' },
				{ name: 'Tab', value: 'tab' },
			],
			default: 'comma',
			description:
				'CSV: the separator of the columns. When reading CSV it is guessed if not set; when writing it is a comma.',
		},
		{
			displayName: 'CSV Encoding',
			name: 'csvEncoding',
			type: 'options',
			options: [
				{ name: 'UTF-8', value: 'utf8' },
				{ name: 'UTF-8 With BOM (Excel)', value: 'utf8bom' },
				{ name: 'Windows-1254 (Turkish)', value: 'windows1254' },
			],
			default: 'utf8',
			description: 'CSV written from a spreadsheet or data: the text encoding',
		},
		{
			displayName: 'Fade In and Out',
			name: 'fade',
			type: 'boolean',
			default: false,
			description: 'Whether to fade the sound in and out over two seconds',
		},
		{
			displayName: 'GIF Frames per Second',
			name: 'fps',
			type: 'options',
			options: [
				{ name: '10', value: '10' },
				{ name: '12', value: '12' },
				{ name: '15', value: '15' },
			],
			default: '12',
			description: 'GIF from a video: frames per second',
		},
		{
			displayName: 'GIF Start (Seconds)',
			name: 'start',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 14400 },
			default: 0,
			description: 'GIF from a video: where in the video the GIF starts',
		},
		{
			displayName: 'GIF Width',
			name: 'gifWidth',
			type: 'options',
			options: [
				{ name: '320 Px', value: '320' },
				{ name: '480 Px', value: '480' },
				{ name: '640 Px', value: '640' },
			],
			default: '480',
			description: 'GIF from a video: the width of the GIF',
		},
		{
			displayName: 'Image DPI',
			name: 'dpi',
			type: 'options',
			options: [
				{ name: '72 DPI', value: '72' },
				{ name: '150 DPI', value: '150' },
				{ name: '300 DPI', value: '300' },
			],
			default: '150',
			description: 'PDF to images: the resolution of the pages',
		},
		{
			displayName: 'Keep Metadata',
			name: 'keepMetadata',
			type: 'boolean',
			default: false,
			description:
				"Whether to keep a photo's details (EXIF: date, camera), which are removed by default for privacy. The GPS location stays removed unless 'keepLocation' is set in 'Other Options (JSON)'.",
		},
		{
			displayName: 'Lossless',
			name: 'lossless',
			type: 'boolean',
			default: false,
			description: 'Whether to make a lossless WebP or AVIF (logos, screenshots)',
		},
		{
			displayName: 'Max File Size (KB)',
			name: 'maxKb',
			type: 'number',
			typeOptions: { minValue: 5, maxValue: 100000 },
			default: 500,
			description:
				'JPG, WebP and AVIF: the file is at most this many kilobytes (1 KB = 1000 bytes)',
		},
		{
			displayName: 'Max File Size (MB)',
			name: 'maxSize',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 4096 },
			default: 25,
			description:
				'MP4: the video is at most this many megabytes (1 MB = 1,000,000 bytes); its frame shrinks to fit',
		},
		{
			displayName: 'Max Frame Rate',
			name: 'frameRate',
			type: 'options',
			options: [
				{ name: '24 Fps', value: '24' },
				{ name: '30 Fps', value: '30' },
				{ name: '60 Fps', value: '60' },
			],
			default: '30',
			description: 'Video: frames per second at most. A video with fewer keeps its own.',
		},
		{
			displayName: 'Max Video Height',
			name: 'height',
			type: 'options',
			options: [
				{ name: '1080p', value: '1080' },
				{ name: '720p', value: '720' },
				{ name: '480p', value: '480' },
				{ name: '360p', value: '360' },
			],
			default: '1080',
			description: 'Video: the height of the frame at most. Never made larger.',
		},
		{
			displayName: 'Mute',
			name: 'mute',
			type: 'boolean',
			default: false,
			description: 'Whether to drop the sound of a video',
		},
		{
			displayName: 'Normalize Loudness',
			name: 'normalize',
			type: 'boolean',
			default: false,
			description:
				'Whether to even out the loudness of the sound (EBU R128 at -16 LUFS, as podcasts and streaming use)',
		},
		{
			displayName: 'OCR Language',
			name: 'ocrLanguage',
			type: 'options',
			options: [
				{ name: 'Arabic', value: 'ar' },
				{ name: 'Chinese', value: 'zh' },
				{ name: 'Czech', value: 'cs' },
				{ name: 'Detect Automatically', value: 'auto' },
				{ name: 'Dutch', value: 'nl' },
				{ name: 'English', value: 'en' },
				{ name: 'French', value: 'fr' },
				{ name: 'German', value: 'de' },
				{ name: 'Greek', value: 'el' },
				{ name: 'Hebrew', value: 'he' },
				{ name: 'Hindi', value: 'hi' },
				{ name: 'Italian', value: 'it' },
				{ name: 'Japanese', value: 'ja' },
				{ name: 'Korean', value: 'ko' },
				{ name: 'Polish', value: 'pl' },
				{ name: 'Portuguese', value: 'pt' },
				{ name: 'Russian', value: 'ru' },
				{ name: 'Spanish', value: 'es' },
				{ name: 'Turkish', value: 'tr' },
				{ name: 'Vietnamese', value: 'vi' },
			],
			default: 'auto',
			description: 'Text recognition (scanned PDFs and pictures to text): the language of the text',
		},
		{
			displayName: 'Other Options (JSON)',
			name: 'otherOptions',
			type: 'json',
			default: '{}',
			description:
				'More settings of the Converter Studio API by their API names, as a JSON object, for example {"vbr": "high"} or {"slideLayout": "handout"}. The README of this node lists them.',
		},
		{
			displayName: 'Page Range',
			name: 'pageRange',
			type: 'string',
			default: '',
			placeholder: 'e.g. 1-3, 5',
			description:
				'Documents to PDF, and PDF to pictures or text: only these pages, as numbers and ranges separated by commas',
		},
		{
			displayName: 'PDF Compression',
			name: 'compression',
			type: 'options',
			options: [
				{ name: 'Balanced', value: 'balanced' },
				{ name: 'Light', value: 'light' },
				{ name: 'Strong', value: 'strong' },
			],
			default: 'balanced',
			description: 'PDF to a smaller PDF: how hard to compress',
		},
		{
			displayName: 'PDF/A',
			name: 'pdfA',
			type: 'boolean',
			default: false,
			description: 'Whether to make an archival PDF/A when converting documents to PDF',
		},
		{
			displayName: 'Quality',
			name: 'quality',
			type: 'options',
			options: [
				{ name: 'Balanced', value: 'balanced' },
				{ name: 'High', value: 'high' },
				{ name: 'Small', value: 'small' },
			],
			default: 'balanced',
			description: 'Video, JPG, WebP and AVIF: how much quality to trade for a smaller file',
		},
		{
			displayName: 'Recognize Text (OCR)',
			name: 'ocr',
			type: 'boolean',
			default: false,
			description:
				'Whether to recognize the text of scanned pages when converting PDF to Word or text',
		},
		{
			displayName: 'Resize Fit',
			name: 'fit',
			type: 'options',
			options: [
				{ name: 'Fill and Crop', value: 'cover' },
				{ name: 'Fit Inside', value: 'inside' },
			],
			default: 'inside',
			description:
				"Images with both 'Resize Width' and 'Resize Height': fit inside them, or fill them and crop",
		},
		{
			displayName: 'Resize Height (Pixels)',
			name: 'resizeHeight',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 10000 },
			default: 1080,
			description: 'Images: the height in pixels. Alone, it keeps the proportions.',
		},
		{
			displayName: 'Resize Width (Pixels)',
			name: 'resizeWidth',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 10000 },
			default: 1920,
			description: 'Images: the width in pixels. Alone, it keeps the proportions.',
		},
		{
			displayName: 'Rotate Clockwise',
			name: 'rotate',
			type: 'options',
			options: [
				{ name: '90 Degrees', value: '90' },
				{ name: '180 Degrees', value: '180' },
				{ name: '270 Degrees', value: '270' },
			],
			default: '90',
			description: 'Images: turn the picture clockwise',
		},
		{
			displayName: 'Sample Rate',
			name: 'sampleRate',
			type: 'options',
			options: [
				{ name: '22.05 kHz', value: '22050' },
				{ name: '44.1 kHz', value: '44100' },
				{ name: '48 kHz', value: '48000' },
			],
			default: '44100',
			description: 'Sound: samples per second. Kept as it is when not set.',
		},
		{
			displayName: 'Sheet Number',
			name: 'sheet',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 255 },
			default: 1,
			description: 'Spreadsheet to CSV: which sheet to convert, counting from 1',
		},
		{
			displayName: 'Trim Start (Seconds)',
			name: 'trimStart',
			type: 'number',
			typeOptions: { minValue: 0, maxValue: 86400 },
			default: 0,
			description: 'Sound: start the result this many seconds into the original',
		},
	],
};

/** The option names of the collection that go to the API as they are. */
const TYPED_OPTIONS = new Set(
	(conversionOptionsCollection.options as INodeProperties[])
		.map((option) => option.name)
		.filter((name) => name !== 'otherOptions'),
);

/** A color as the API takes it (`#rrggbb`), from what n8n's color picker gives. */
export function hexColor(value: string): string {
	const color = value.trim().toLowerCase();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(color);
	if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
	// With transparency (#rrggbbaa): the API takes the color alone.
	if (/^#[0-9a-f]{8}$/.test(color)) return color.slice(0, 7);
	return color;
}

export type ConversionOptionsResult =
	{ ok: true; options: IDataObject | undefined } | { ok: false; reason: string };

/**
 * The API's `options` object from the collection: the typed settings as they are, then the
 * JSON ones. Empty strings are left out, and a typed setting wins over the same JSON one.
 */
export function buildConversionOptions(values: IDataObject): ConversionOptionsResult {
	let other: IDataObject = {};
	const raw = values.otherOptions;
	if (typeof raw === 'string' && raw.trim() !== '') {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
				return { ok: false, reason: "'Other Options (JSON)' must be a JSON object" };
			other = parsed as IDataObject;
		} catch {
			return { ok: false, reason: "'Other Options (JSON)' isn't valid JSON" };
		}
	} else if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
		other = raw as IDataObject;
	}
	const options: IDataObject = { ...other };
	for (const [name, value] of Object.entries(values)) {
		if (!TYPED_OPTIONS.has(name)) continue;
		if (value === '' || value === undefined || value === null) continue;
		options[name] = name === 'background' && typeof value === 'string' ? hexColor(value) : value;
	}
	return { ok: true, options: Object.keys(options).length ? options : undefined };
}
