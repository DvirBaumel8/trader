# Trader backend

The backend owns portfolio derivation, journal-backed writes, authentication,
market-data adapters, and API responses. The frontend displays backend facts;
business meaning and money arithmetic stay here.

Read the [project guide](../AGENTS.md) before changing this package. It covers
database safety, migrations, provider boundaries, and test-environment rules.

## Normal development

From the repository root:

```bash
npm run start:dev --prefix backend
```

Run backend tests with `npm run test --prefix backend`; use `trader_test`, never
the owner's local `trader` database.

See [the HTTP API](../docs/api.md) for routes and authentication, and
[deployment](../docs/DEPLOYMENT.md) for migrations and production operations.
