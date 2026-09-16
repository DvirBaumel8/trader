# Trader frontend

The frontend is the mobile-first display and entry surface for Trader. It
renders server-provided facts, collects drafts, and keeps no authoritative
portfolio or money-calculation logic.

Read the [project guide](../AGENTS.md) before changing this package. It covers
phone-width verification, shared UI patterns, and the API-client boundary.

## Normal development

From the repository root:

```bash
npm run dev --prefix frontend
```

Vite serves port 5173 and proxies `/api` to the local backend. Run frontend
tests with `npm run test --prefix frontend`.

See [the HTTP API](../docs/api.md) for the server contract and
[deployment](../docs/DEPLOYMENT.md) for build and hosting operations.
