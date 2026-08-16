n8n-nodes-apiosk

Use any x402 API from one n8n node.

Describe what you want in plain language. Apiosk finds the best available x402 endpoint for the job, fills in the required parameters, pays the provider from your connected wallet, and returns the result.

Your job → Apiosk → Result

No provider selection. No separate integrations. No API key setup for every service.

How it works

Give Apiosk a job such as:

Find the latest news about Nvidia

or:

Get the current ETH price in USD

or pass input from another n8n node:

{{ $json.chatInput }}

Apiosk searches the live x402 marketplace at runtime and selects an endpoint that can handle that specific request.

New x402 APIs can become available to your workflow without changing the workflow itself.

Setup

1. Sign in at Apiosk.
2. Connect a wallet and fund it with USDC on Base.
3. Set your per-transaction and daily spending limits.
4. Copy your Apiosk connect token.
5. In n8n, create an Apiosk API credential and paste the token.

Done.

Run a job

When the node runs, Apiosk:

1. understands your job
2. finds matching x402 APIs
3. selects the best option
4. fills in the parameters
5. pays the provider
6. calls the API
7. returns the result

Payment comes from the wallet connected to your Apiosk account.

Outputs

✅ Done
The request succeeded.

The provider response is available at:

json.execution.body

The result also includes:
* selected API
* selection reason
* request parameters
* price
* transaction hash
* wallet used

🚫 Blocked
The request could not be completed.

For example:
* no suitable API was found
* required information was missing
* your spending limit was reached
* the provider returned an error

The response explains what happened so you can route it to a fallback, retry flow, alert, or AI agent.

More providers means more API supply.
The more x402 APIs available, the more jobs the network can serve.

Want to become a managed Apiosk API provider?
Go to dashboard.apiosk.com and start adding your APIs.

Safety

💳 Spending limits
Your limits are enforced by the Apiosk gateway, not by the n8n node.

The node cannot spend more than the limits you configure.

🔁 Retry protection
Apiosk uses an idempotency key so n8n retries do not accidentally pay twice for the same request.

🎯 No guessed required parameters
If an API requires information that is missing from your job, Apiosk blocks the request before payment instead of inventing a value.

Install

In n8n:
Settings → Community nodes → Install

Enter:
n8n-nodes-apiosk

After installation, search for Apiosk in the node picker.

Development

npm install --ignore-scripts
npm run build
npm run lint
npm run verify

Publish

npm version patch
npm publish --access public

⸻

One node. One credential. Any x402 API Apiosk can discover.