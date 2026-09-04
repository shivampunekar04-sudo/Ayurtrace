// Cross-platform launcher for the live product demo (durable file-backed ledger,
// real wall-clock). Sets the backend env then boots the compiled gateway.
// Usage: npm run build && npm run start:live   → http://localhost:3001
process.env.LEDGER_BACKEND = process.env.LEDGER_BACKEND || 'live';
await import('./dist/main.js');
