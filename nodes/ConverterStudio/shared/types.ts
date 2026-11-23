/** What the Converter Studio API sends back, as described on https://converter.studio/developers. */

export type ConversionStatus =
	| 'fetching'
	| 'waiting_for_upload'
	| 'measuring'
	| 'quoted'
	| 'queued'
	| 'processing'
	| 'done'
	| 'failed'
	| 'expired'
	| 'canceled';

export type ApiErrorBody = {
	code: string;
	message: string;
	params?: Record<string, string | number>;
};

/** A conversion as `GET /v1/conversions/:id` describes it. Its id is also its upload's id. */
export type ConversionView = {
	id: string;
	status: ConversionStatus;
	from: string | null;
	to: string | null;
	inputName: string | null;
	inputSize: number | null;
	/** The price in credits, once known. */
	credits: number | null;
	/** Goes ahead on its own up to this price; `null` waits for a confirmation. */
	maxCredits: number | null;
	progress: number | null;
	outputName: string | null;
	outputSize: number | null;
	/** Anyone with this link can download the result until `expiresAt`. */
	downloadUrl: string | null;
	expiresAt: string | null;
	error: ApiErrorBody | null;
	/** What to do next, in a sentence. */
	next: string;
};

/** An upload slot from `POST /v1/uploads`. */
export type UploadSlot = {
	id: string;
	uploadUrl: string;
	method: 'PUT';
	maxBytes: number;
	/** One request carries at most this many bytes; larger files go in parts. */
	partBytes: number;
	expiresAt: string;
};

/** The answer to one `PUT` of an upload. */
export type UploadReceipt =
	| { id: string; status: 'partial'; received: number }
	| { id: string; status: 'ready'; file: { name: string; size: number; format: string | null } };

export type FormatView = {
	id: string;
	name: string;
	category: string;
	extensions: string[];
	/** What it converts to on the server right now. */
	to: string[];
};

export type AccountView = {
	email: string;
	plan: string;
	allApps: boolean;
	credits: number;
	allowance: { used: number; limit: number; per: string } | null;
	packs: number;
	renewsAt: string | null;
	maxFileBytes: number;
	maxMediaSeconds: number;
	wallet: { balanceMicros: number; pays: boolean } | null;
};
