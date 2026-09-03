# Mock Gateway

A standalone stand-in for the AyurTrace §6.4 REST API so **Complete-B develops without
Complete-A**. Node built-ins only — no install.

```
node mock-gateway.mjs        # serves http://localhost:3001  (PORT env to change)
```

Returns contract-shaped responses (real captured data). See `INTEGRATION_CONTRACT.md` for the
route behaviours. Point your Complete-B components' API base URL here during development; swap to
a real gateway URL for final integration with no code change.
