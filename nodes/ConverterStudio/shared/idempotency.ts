import { createHash } from 'crypto';
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

/**
 * The `Idempotency-Key` of the conversion an item starts (File > Convert), so that a node that
 * n8n runs again for "Retry On Fail" gets the conversion its earlier try made, instead of making
 * (and paying for) a second one. The API keeps a key for 24 hours, per account.
 *
 * What the key is made of, and why:
 * - the execution's ID: n8n gives every execution its own, manual runs and "Execute step"
 *   included, and a retry of a whole execution from the executions list is a new execution with
 *   a new ID. "Retry On Fail" runs the node again inside the same execution.
 * - the node's ID (its name if it has none), its run index and the item's index: a node that runs
 *   several times in one execution (in a loop, or as an AI agent's tool, once per call) starts a
 *   new run each time, with item indexes from 0 again. A retry keeps the run index.
 * - the instance's and the workflow's IDs, because execution IDs are only numbers counted by each
 *   n8n instance, and two instances can share an API key.
 * - a count of the item's spent conversions: when the conversion of a try ends without a result
 *   (failed, canceled, expired), the next try must start a new one rather than get the old one.
 *
 * The count, and the upload an earlier try made for a binary file (a new upload would be a
 * different request under the same key, which the API refuses), are kept in the node's context,
 * which n8n keeps for the whole execution. There is no key, and no state, when n8n gives no
 * execution ID (an MCP Trigger's tool call) or no context.
 */

/** n8n's execution ID before there is an execution. */
const NO_EXECUTION = '__UNKNOWN__';
/** Where in the node's context the items' conversions are kept. */
const STATE = 'converterStudioConversions';

type ItemState = {
	/** Conversions of the item that ended without a result. */
	spent: number;
	/** The upload of the item's file, for the next try. */
	uploadId?: string;
};

export type ConversionAttempt = {
	/** The `Idempotency-Key` header for this try. */
	readonly key: string;
	/** The upload an earlier try made of the item's file, if any. */
	readonly uploadId: string | undefined;
	/** Keeps the upload of the item's file for a later try. */
	keepUpload(id: string): void;
	/** The conversion will not give a result (or the key was refused): a later try starts anew. */
	spend(): void;
};

const isObject = (value: unknown): value is IDataObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** The run index of the node in this execution (n8n's `$runIndex`). */
function runIndexOf(context: IExecuteFunctions, itemIndex: number): number | undefined {
	const value: unknown = context.getWorkflowDataProxy(itemIndex).$runIndex;
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** The node's state of an item's conversion, kept in the node's context for the execution. */
function itemState(context: IExecuteFunctions, slot: string): ItemState {
	const nodeContext = context.getContext('node');
	if (!isObject(nodeContext[STATE])) nodeContext[STATE] = {};
	const all = nodeContext[STATE] as IDataObject;
	if (!isObject(all[slot])) all[slot] = { spent: 0 };
	return all[slot] as unknown as ItemState;
}

/**
 * This item's conversion attempt, or `undefined` when there is nothing stable to derive a key
 * from (then the request goes without one, as before).
 */
export function conversionAttempt(
	this: IExecuteFunctions,
	itemIndex: number,
): ConversionAttempt | undefined {
	let parts: Array<string | number>;
	let state: ItemState;
	try {
		const executionId = this.getExecutionId();
		if (typeof executionId !== 'string' || !executionId || executionId === NO_EXECUTION) {
			return undefined;
		}
		const runIndex = runIndexOf(this, itemIndex);
		if (runIndex === undefined) return undefined;
		const node = this.getNode();
		const nodeRef = node.id || node.name;
		state = itemState(this, `${nodeRef}:${runIndex}:${itemIndex}`);
		parts = [
			this.getInstanceId() ?? '',
			this.getWorkflow().id ?? '',
			executionId,
			nodeRef,
			runIndex,
			itemIndex,
		];
	} catch (error) {
		// Not inside a regular execution (no execution data, no context): no key.
		this.logger?.debug('Converter Studio: no Idempotency-Key for this item', {
			reason: (error as Error).message,
		});
		return undefined;
	}
	const key = `n8n-${createHash('sha256')
		.update(JSON.stringify([...parts, state.spent]))
		.digest('hex')}`;
	return {
		key,
		uploadId: state.uploadId,
		keepUpload(id: string) {
			state.uploadId = id;
		},
		spend() {
			state.spent += 1;
			delete state.uploadId;
		},
	};
}
