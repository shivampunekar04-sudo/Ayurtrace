# AyurTrace — Two-Project Split Guide

You're continuing in two Claude Projects across two Pro accounts. **Both projects must
understand the whole system** (upload the same handoff kit to each), because the frozen
`@ayurtrace/contracts` package is the seam every lane builds against. What you *divide* is the
**work**, not the understanding.

## Upload to BOTH projects
- The four source docs (`International_hackathon_solution_v2.md`, `The_complete_problem_statement.md`,
  `AyurTrace_Execution_Plan_v2_48h.md`, `AyurTrace_Team_Schedule_v2_48h.md`)
- `HANDOFF.md`, `FILE_MANIFEST.md`, this file
- `packages/contracts/src/*.ts` (the frozen contract — paste as project knowledge so Claude
  generates against exact types)

The full source lives in `AyurTrace-Build.zip` on your disk; paste per-lane files as you work.

## Recommended split (maps to the 5 lanes)

**Project 1 — Ledger + Platform (owns the contract).**
Lanes A (chaincode), B (gateway), and E's contracts/seed/infra.
- P0: stand up the real Fabric network and make `LEDGER_BACKEND=fabric` work (the biggest gap).
- Owns any change to `@ayurtrace/contracts`, reject codes, endpoints, seed, endorsement policy.
- Deliverables: live 3-org network, deployed chaincode, gateway on Fabric, IPFS promotion.

**Project 2 — Experience + Narrative.**
Lanes C (collector + consumer PWA), D (regulator), and E's slides/demo script.
- Port the HTML UIs into the planned Next.js/Tailwind/shadcn stack (reuse the exact API calls
  and design tokens); add Dexie (real offline queue) and react-leaflet (regulator map).
- Deliverables: production frontends, demo storyboard, Built-vs-Designed deck, dry runs.

Both consume the same gateway API; Project 2 develops against the demo backend
(`LEDGER_BACKEND=demo`, no Docker) until Project 1's live network is ready, then points at it.

## The one hard coordination rule
**`@ayurtrace/contracts` is frozen. If Project 1 changes it, Project 2 must be told the same day
and re-sync its copy** (and vice-versa). This is the entire reason the contract package exists —
it's the integration safety net from execution-plan §6. A silent contract change is how the two
halves drift and fail to integrate at the end.

Practical mechanism with two separate accounts: whoever edits the contract writes a one-line
"contract change note" (what changed, which endpoints/types/codes) and pastes it into the other
project's next prompt. Bump a version string in `packages/contracts/package.json` so drift is visible.

## What NOT to split
- Do not let both projects edit `@ayurtrace/contracts` independently.
- Do not duplicate enforcement logic into the gateway or UIs — it lives once, in
  `AyurLedgerService`. Project 2 calls the API; it never re-implements a check.
- Keep the BUILT/SIMULATED/DESIGNED tags consistent across both projects' materials.
