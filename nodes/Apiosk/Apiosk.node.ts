import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { NodeConnectionType } from 'n8n-workflow';

/**
 * The Apiosk node: the whole "which API, which parameters, pay, call" chain
 * as one workflow step.
 *
 * It replaces the Classify → Extract → Route → HTTP → HTTP → HTTP middle of a
 * flow: the incoming item carries a job in words, the node hands it to
 * `POST /v1/do`, and the gateway parses the job, finds candidate APIs, scores
 * them against your constraints, picks one, fills its documented parameters in
 * from your words, pays it from the wallet behind your connect token, and
 * returns the provider's response.
 *
 * Two outputs, because two very different things can come back:
 *   - "Done":    a paid call went out and the provider answered.
 *   - "Blocked": nothing was paid. The item says exactly why — no matching
 *     API, every candidate rejected by your constraints, required parameters
 *     the job didn't state, or the wallet declining at a cap you set.
 * Route "Blocked" to a Slack alert, a fallback branch, or an LLM that
 * rephrases the job and loops back — the point is that a non-answer is
 * routable data, never a silent failure.
 */
export class Apiosk implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Apiosk',
		name: 'apiosk',
		// Filename carries the mark's name rather than the package's: n8n serves
		// community icons from a version-independent URL, so a browser that has
		// cached one apiosk.svg never refetches it across releases. Renaming the
		// file is the only reliable way to push an icon change to existing users.
		icon: 'file:apiosk-node-mark.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] === "plan" ? "plan (free)" : "run job (pays)" }}',
		description:
			'Describe a job in plain words. Apiosk picks the right x402 API, pays it from your wallet, and returns the response.',
		defaults: {
			name: 'Apiosk',
		},
		usableAsTool: true,
		inputs: ['main'] as NodeConnectionType[],
		outputs: ['main', 'main'] as NodeConnectionType[],
		outputNames: ['Done', 'Blocked'],
		// Two ways in, same token underneath. "Connect my account" runs the
		// authorization-code handoff (the buyer never sees the credential); the
		// token field stays for anyone who already has one, or whose n8n cannot
		// reach the portal to do the round trip.
		credentials: [
			{
				name: 'apioskOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['oAuth2'] } },
			},
			{
				name: 'apioskApi',
				required: true,
				displayOptions: { show: { authentication: ['connectToken'] } },
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Connect My Account',
						value: 'oAuth2',
						description:
							'Set the wallet and spending limits in the Apiosk portal; n8n collects the credential itself',
					},
					{
						name: 'Connect Token',
						value: 'connectToken',
						description: 'Paste a connect token you already have',
					},
				],
				default: 'oAuth2',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Run Job',
						value: 'run',
						description:
							'Decide, fill parameters, PAY from the connected wallet, and return the provider response',
						action: 'Run a job and pay the chosen API',
					},
					{
						name: 'Plan Only',
						value: 'plan',
						description:
							'Everything except the payment: see which API would be chosen and the exact request that would be sent. Free.',
						action: 'Plan a job without paying',
					},
				],
				default: 'run',
			},
			{
				displayName: 'Job',
				name: 'job',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				placeholder: 'Get Nvidia earnings news from the last 7 days',
				description:
					'The job in plain words — anything, not a fixed list of supported tasks. Apiosk splits it, searches every live x402 endpoint for one that serves it, and fills that API\'s own parameters in from these words — nothing is ever invented to fill a gap.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Capability',
						name: 'capability',
						type: 'string',
						default: '',
						description:
							'Skip the search and name the Apiosk capability slug outright (e.g. news.search)',
					},
					{
						displayName: 'Max Latency (Ms)',
						name: 'maxLatencyMs',
						type: 'number',
						default: 0,
						description:
							'Reject candidates whose measured p95 latency exceeds this. 0 = no limit.',
					},
					{
						displayName: 'Max Price (USD)',
						name: 'maxPrice',
						type: 'number',
						typeOptions: { numberPrecision: 6 },
						default: 0,
						description:
							'Never choose an API costing more than this per call. 0 = no extra ceiling (your wallet caps from the buyer portal always apply on top).',
					},
					{
						displayName: 'Min Success Rate',
						name: 'minReliability',
						type: 'number',
						typeOptions: { numberPrecision: 2, minValue: 0, maxValue: 1 },
						default: 0,
						description:
							'Reject candidates whose measured success rate is below this (0–1). 0 = no floor.',
					},
					{
						displayName: 'Optimize For',
						name: 'optimizeFor',
						type: 'options',
						options: [
							{ name: 'Price (Default)', value: 'price' },
							{ name: 'Latency', value: 'latency' },
							{ name: 'Reliability', value: 'reliability' },
							{ name: 'Balanced', value: 'balanced' },
						],
						default: 'price',
						description: 'Which dimension carries the most weight when ranking candidates',
					},
					{
						displayName: 'Timeout (Ms)',
						name: 'timeoutMs',
						type: 'number',
						default: 60000,
						description: 'How long to wait for the provider, up to 120000',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const done: INodeExecutionData[] = [];
		const blocked: INodeExecutionData[] = [];

		// Both credential types carry a `gatewayUrl` and both authenticate with the
		// same header, so everything downstream of this pair is identical.
		const credentialType =
			(this.getNodeParameter('authentication', 0, 'oAuth2') as string) === 'connectToken'
				? 'apioskApi'
				: 'apioskOAuth2Api';

		const credentials = await this.getCredentials(credentialType);
		const gatewayUrl = String(credentials.gatewayUrl ?? 'https://gateway.apiosk.com').replace(
			/\/+$/,
			'',
		);

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const job = (this.getNodeParameter('job', i) as string).trim();
				if (!job) {
					throw new NodeOperationError(this.getNode(), 'The Job field is empty.', {
						itemIndex: i,
					});
				}
				const options = this.getNodeParameter('options', i, {}) as IDataObject;

				const body: IDataObject = { job };
				if (options.capability) body.capability = options.capability;
				if (typeof options.maxPrice === 'number' && options.maxPrice > 0) {
					body.max_price = options.maxPrice;
				}
				if (typeof options.maxLatencyMs === 'number' && options.maxLatencyMs > 0) {
					body.max_latency_ms = options.maxLatencyMs;
				}
				if (typeof options.minReliability === 'number' && options.minReliability > 0) {
					body.min_reliability = options.minReliability;
				}
				if (options.optimizeFor && options.optimizeFor !== 'price') {
					body.optimize_for = options.optimizeFor;
				}
				if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) {
					body.timeout_ms = options.timeoutMs;
				}
				if (operation === 'plan') body.dry_run = true;

				// Idempotency key: stable across n8n's retry-on-fail within one
				// execution, so a retried item can never pay twice. The gateway
				// deduplicates on it.
				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: `${gatewayUrl}/v1/do`,
					body,
					json: true,
					// Non-2xx answers (404 no capability, 409 all rejected, 422
					// missing parameters) are routable outcomes, not exceptions.
					ignoreHttpStatusErrors: true,
					headers: {
						'idempotency-key': `n8n-${this.getExecutionId()}-${this.getNode().id}-${i}`,
					},
				};

				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					credentialType,
					requestOptions,
				)) as IDataObject;

				const output: INodeExecutionData = {
					json: response,
					pairedItem: { item: i },
				};

				if (isDone(operation, response)) {
					done.push(output);
				} else {
					blocked.push(output);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					blocked.push({
						json: { did: false, error: 'node_error', message: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [done, blocked];
	}
}

/**
 * Which output an answer belongs on.
 *
 * Run: "Done" means a paid call went out AND the provider answered 2xx. A paid
 * provider error (they answered 4xx/5xx with your money) goes to "Blocked" so
 * a workflow never treats it as data — the full body, including the provider's
 * own error, rides along for whoever handles that branch.
 *
 * Plan: "Done" means the request is ready to send — an API was chosen and
 * every required parameter could be filled from the job's words.
 */
function isDone(operation: string, response: IDataObject): boolean {
	if (operation === 'plan') {
		const request = response.request as IDataObject | undefined;
		return response.dry_run === true && request?.ready === true;
	}
	if (response.did !== true) return false;
	const execution = response.execution as IDataObject | undefined;
	const status = typeof execution?.status === 'number' ? execution.status : 0;
	return status >= 200 && status < 300;
}
