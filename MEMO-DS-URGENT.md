# 🚨 MEMO-DS-URGENT — Adopt the 42Labs Design System

**Status:** this project ships UI that does **not** consume the design system. That
is now a compliance gap, not a preference. Bring it onto the DS.

**Applies to (in this repo):**
- `ff3e-app/web` — React + Tailwind, not on the DS

## Why
One source of truth for colour, spacing, type, and primitives lives in the
design-system repo and at `https://ds.42labs.io`. Every hand-picked hex, arbitrary
Tailwind value, and hand-rolled input is drift the DS exists to delete. Reinventing
tokens or components is exactly the thing we are stopping.

## What "adopted" means (3 things)

**1. Tokens — vendored, never edited.** Pull the current pin and import it; never
hand-tune values.
```bash
curl -fsSL https://ds.42labs.io/tokens.v0.6.0.css -o src/styles/ds-tokens.css
```
Import `ds-tokens.css` in your global stylesheet, then delete every local
colour/spacing/type token definition.

**2. Primitives — from the registry, not hand-written.** Configure the `@42labs`
registry, then add what you need:
```bash
npx shadcn@latest add @42labs/button @42labs/input @42labs/card
```
Available: `alert avatar badge button card collapsible input progress separator
sheet skeleton toggle toggle-group tooltip sidebar` (+ `utils`, `use-mobile`).
Setup: `REGISTRY.md` in the design-system repo. Do not hand-roll a primitive the
registry already ships.

**3. The CI gate — prove it stays adopted.** Add one job that runs on every PR:
```yaml
# .github/workflows/ds-compliance.yml
name: DS compliance
on: { pull_request: { branches: [main] } }
jobs:
  ds:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: 4242labs/design-system/.github/actions/ds-compliance@v0.6.0
        with:
          tokens-pin: "0.6.0"
          tokens-file: "src/styles/ds-tokens.css"
```
It fails the PR on: a stale pin, forked tokens, an edited `@42labs/*` primitive, or
your own code using raw colour / arbitrary values / a bespoke primitive. Full doc:
`CONSUMER-CHECK.md` in the design-system repo.

> Paths above assume the app root. Adjust `src/…` to your app's layout.

## Escape hatch
A genuine, reasoned exception carries an inline `// drift-allow: <reason>` on the
offending line. Every allow states why.

## Definition of done
- [ ] `ds-tokens.css` vendored at pin **0.6.0**, imported, no local token defs left
- [ ] Every primitive comes from `@42labs/*`; no hand-rolled equivalents
- [ ] `ds-compliance` job green on a PR
- [ ] Homegrown design tokens / UI kit removed

---
Design-system repo: `~/42labs/design-system` · Tokens & registry:
`https://ds.42labs.io` · Current pin: **0.6.0**
