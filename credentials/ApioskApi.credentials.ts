import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * One credential, created once.
 *
 * The connect token comes out of the Apiosk buyer portal: log in, connect a
 * wallet, set your per-transaction and daily spending limits, copy the token.
 * The token *is* the authorization — it names which wallets may be spent from
 * and carries the caps you set, and the gateway enforces those on every call.
 * This node can never spend past the limits configured in the portal.
 */
export class ApioskApi implements ICredentialType {
	name = 'apioskApi';

	displayName = 'Apiosk API';

	// Straight to the page that covers minting and rotating the token this field
	// wants, not the marketing site.
	documentationUrl = 'https://docs.apiosk.com/dashboard/agent-wallets';

	properties: INodeProperties[] = [
		{
			displayName: 'Connect Token',
			name: 'connectToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'From the Apiosk buyer portal: connect a wallet, set your spending limits, and copy the connect token. The token carries those limits — the gateway enforces them on every paid call.',
		},
		{
			displayName: 'Gateway URL',
			name: 'gatewayUrl',
			type: 'string',
			default: 'https://gateway.apiosk.com',
			description: 'Leave as-is unless you run your own gateway',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-apiosk-connect-token': '={{$credentials.connectToken}}',
			},
		},
	};

	// /v1/me answers with the token's wallets, caps, and spend-so-far — the
	// perfect liveness check: it proves the token is active without spending.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.gatewayUrl}}',
			url: '/v1/me',
		},
	};
}
