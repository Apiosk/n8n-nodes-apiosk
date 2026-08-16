import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * One click, no copy-paste.
 *
 * The other credential in this package ({@link ApioskApi}) asks for a connect
 * token as text. That works, and it means the buyer has to open the portal, read
 * a live spending credential off the screen, and carry it here by hand — through
 * the clipboard, the scrollback, and usually a screenshot.
 *
 * This one uses the handshake n8n already has a button for. "Connect my account"
 * opens the Apiosk buyer portal, the buyer sets up (or picks) a wallet and its
 * spending limits there, and n8n's server collects the resulting token by code
 * exchange. The token never appears on screen and never passes through the
 * browser.
 *
 * PKCE rather than a client secret, because there is no secret to keep: this
 * package is installed on the buyer's own n8n and anything shipped in it is
 * public. The code is bound to a challenge n8n generates per attempt, so
 * observing the redirect is not enough to redeem it.
 *
 * Nothing about the buyer's spending limits is decided here. The token names
 * which wallet it may spend from and what the caps are; the gateway enforces
 * both on every call. This credential cannot widen either.
 */
export class ApioskOAuth2Api implements ICredentialType {
	name = 'apioskOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Apiosk OAuth2 API';

	documentationUrl = 'https://apiosk.com';

	properties: INodeProperties[] = [
		// PKCE, not the plain authorization-code grant — see the class comment.
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'pkce',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: 'https://buyer.apiosk.com/connect',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://gateway.apiosk.com/v1/connect/oauth/token',
		},
		// Registered client id, not a secret. It tells the portal which callbacks
		// are legitimate and gives the consent screen a name to show the buyer.
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'hidden',
			default: 'n8n',
		},
		// A public client has no secret. n8n always sends the field, and the
		// gateway ignores it — the code plus the PKCE verifier are the proof.
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: 'x402.verify x402.settle',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
		// Self-hosted gateways only. Left visible because someone running their
		// own Apiosk needs to point all three URLs at it, and hiding the field
		// would mean editing JSON to do it.
		{
			displayName: 'Gateway URL',
			name: 'gatewayUrl',
			type: 'string',
			default: 'https://gateway.apiosk.com',
			description: 'Leave as-is unless you run your own Apiosk gateway',
		},
	];

	/**
	 * The token that comes back is an ordinary Apiosk connect token, so it is
	 * presented the same way as a pasted one: a header, on every call.
	 *
	 * Written as a `properties.headers` expression rather than n8n's default
	 * `Authorization: Bearer` because the gateway reads its own header — the same
	 * one the portal's snippets and the MCP server use.
	 */
	authenticate = {
		type: 'generic' as const,
		properties: {
			headers: {
				'x-apiosk-connect-token': '={{$credentials.oauthTokenData.access_token}}',
			},
		},
	};

	// /v1/me answers with the token's wallets, caps and spend-so-far. It proves
	// the connection is live without spending anything, which is exactly what a
	// credential test should cost.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.gatewayUrl}}',
			url: '/v1/me',
		},
	};
}
