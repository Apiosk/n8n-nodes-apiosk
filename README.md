# n8n-nodes-apiosk

Describe a job in plain words. Apiosk finds the right paid API, fills in its
parameters, **pays it from your connected wallet** (x402/USDC), and returns the
provider's response — as one n8n node.

It replaces the middle of flows like this:

```
Ask → Classify → Extract → Route → [NewsAPI | Alpha Vantage | Tavily] → Normalize → Answer
```

with this:

```
Ask → Apiosk → Answer
```

No accounts with twenty providers, no API keys per service, no hardcoded
routing rules. The provider set grows on the Apiosk marketplace without your
workflow changing.

## Setup — once

1. Log in to the [Apiosk buyer portal](https://apiosk.com).
2. Connect a wallet and fund it with USDC (Base).
3. **Set your spending limits** — per-transaction and per-day caps. These are
   enforced by the gateway on every call; nothing this node does can exceed
   them.
4. Copy the connect token.
5. In n8n: **Credentials → New → Apiosk API**, paste the token. The built-in
   credential test verifies it against the gateway without spending anything.

## The node

**Input**: a job in words — typed, from a chat trigger, or an expression like
`{{ $json.chatInput }}`.

**Two operations:**

| operation | what happens | cost |
|---|---|---|
| **Plan Only** | Parse → find APIs → compare → choose → fill parameters. Returns the chosen API, why it won, and the exact request that *would* be sent. | free |
| **Run Job** | All of the above, then **pays** the chosen API from your wallet and returns the provider's response. | the API's listed price |

Start every new workflow with *Plan Only*. When the plans look right, flip the
operation to *Run Job*.

**Two outputs:**

- **Done** — a paid call went out and the provider answered successfully
  (*Plan*: the request is ready to send). `json.execution.body` holds the
  provider's response, unmodified; `json.decision` says which API won and why;
  `json.execution.tx_hash` / `wallet_used` are the payment receipt.
- **Blocked** — nothing usable came back, and **in most cases nothing was
  paid**: no API serves the job (404), every candidate failed your constraints
  (409), the job didn't state a required parameter (422), or your wallet
  declined at a cap you set (402). One case *is* paid: the provider was paid
  and answered with an error status — that lands on Blocked too, so a paid
  error is never mistaken for data. The item says exactly which case you're
  in — route it to an alert, a fallback, or an LLM that rephrases and retries.

## What the response tells you

Every answer carries the full trail, so "why did it call *that* API with
*those* parameters?" is always answerable:

```jsonc
{
  "did": true,
  "interpretation": { /* how your words were read (and how to override) */ },
  "decision": {
    "selected_api": "alphavantage",
    "reason": "alphavantage scores 87 of 100 optimising for price; ...",
    "rejected": [ /* every loser, with the rule that removed it */ ]
  },
  "request": { /* the exact request that was sent, parameter by parameter */ },
  "execution": {
    "status": 200,
    "body": { /* the provider's response */ },
    "price_usd": 0.01,
    "tx_hash": "0x…",
    "wallet_used": "0x…"
  }
}
```

## Safety model

- **Your caps are the law.** Limits set in the buyer portal are enforced by the
  gateway on the payment path itself — not by this node, so there is nothing
  here to misconfigure.
- **Parameters are never guessed.** The gateway fills an API's parameters only
  from your job's words, against the provider's own documented schema. A
  required parameter your job didn't state blocks the call *before* payment,
  and the response names it.
- **Retries never double-pay.** The node sends an idempotency key that is
  stable across n8n's retry-on-fail, and the gateway deduplicates on it.
- **Normalize is yours.** Providers answer in their own shapes. Put an LLM (or
  a Code node) after the Apiosk node if you need a fixed shape — that's the one
  "middle node" Apiosk deliberately does not replace.

## Install into n8n

**n8n Cloud / self-hosted UI** — Settings → Community nodes → Install, enter
`n8n-nodes-apiosk`.

**Self-hosted, manually:**

```bash
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install n8n-nodes-apiosk
```

Restart n8n; the node appears as **Apiosk**. See the
[community nodes docs](https://docs.n8n.io/integrations/community-nodes/installation/).

## Development

```bash
npm install --ignore-scripts
npm run build     # tsc + copies the icon into dist/
npm run lint      # the ruleset n8n runs against community packages
npm run verify    # loads dist/ the way n8n's community-node loader does
```

`npm run verify` is the guard on the deploy path: it reads the `n8n` manifest
from `package.json`, requires every file it declares, instantiates the classes,
and checks the icon shipped, the credential the node names actually exists, and
that the package pulls **no** runtime dependencies onto the n8n host.

`--ignore-scripts` is deliberate. `n8n-workflow` is a **devDependency only** —
it is what n8n supplies to community nodes at runtime, so this package must
never ship it. It drags in `isolated-vm`, a native module that compiles under
`node-gyp` when no prebuilt binary matches your Node version, which is what
makes a plain `npm install` fail. Nothing here executes it, so the build is
skipped rather than fixed. If you do want it compiled (to run a full n8n
locally), install the toolchain once with `xcode-select --install`.

For the same reason there is no `peerDependencies` block: npm auto-installs
peer dependencies, so declaring `n8n-workflow` there would push the entire
`n8n-workflow` tree — `isolated-vm` included — onto every n8n host that
installs this node. The official `n8n-nodes-starter` omits it too.

### Do not run `npm audit fix --force`

`npm audit` reports devDependencies, and every finding here is inside the
`n8n-workflow` / `@n8n/node-cli` toolchain. None of it ships. The number that
matters is:

```bash
npm audit --omit=dev     # 0 vulnerabilities
```

`--force` has been tried: it bumped `n8n-workflow` a major version (silently
changing which n8n API this node compiles against), downgraded
`@n8n/node-cli` below the 0.23.0 that provenance publishing needs, and left
*more* advisories than it started with. Pin the compile target deliberately
instead: build against the **oldest** `n8n-workflow` you intend to support, so
the node only uses APIs present on every host it runs on.

### Test against a local n8n

```bash
npm run build
npm link
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes && npm link n8n-nodes-apiosk
n8n start
```

### Publish

```bash
npm publish --access public
```

`prepublishOnly` rebuilds from a clean `dist/` and runs the lint first, so a
broken build cannot reach the registry. Bump the version with `npm version
patch|minor|major` beforehand.

> The release command is `npx @n8n/node-cli release` — **not** `npx n8n-node`.
> The bare `n8n-node` name on npm is a dependency-confusion placeholder that
> ships no usable code. Publishing this package needs nothing beyond
> `npm publish`.
