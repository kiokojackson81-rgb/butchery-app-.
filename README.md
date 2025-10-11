## BarakaOps WhatsApp GPT assistant

This repository contains the GPT-orchestrated WhatsApp assistant for BarakaOps. The core behavior is defined by the prompts in
`src/ai/prompts`, which implement the "BarakaOps WhatsApp Bot: End-to-End Flow Blueprint" covering login, role-specific menus,
and the multi-step flows for attendants, suppliers, and supervisors.

### Local development

Run the development server to exercise the web dashboard or any local webhook adapters:

```bash
npm run dev
```

### Validating the WhatsApp flow

Before cutting a branch or opening a PR, run the deterministic dry-run tests that mirror the WhatsApp menu logic:

```bash
npx vitest tests/gpt_dry.spec.ts
```

The tests confirm that quick actions (like numeric menu selections, deposit parsing, and shortcut phrases) produce the correct
OOC payload and intent hints expected by the webhook router. Keeping these passing ensures the GPT prompt and backend contract
stay aligned.

### Deployments

The project deploys to Vercel via the standard Next.js workflow. Consult `vercel.json` for environment-specific overrides and
ensure that WhatsApp Graph credentials (app secret, verify token, etc.) are configured in the target environment before
triggering a production release.
