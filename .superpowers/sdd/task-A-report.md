# Task A Report — engine contract fix

## Status: DONE

## RED → GREEN evidence

**RED:** After adding new tests and before implementing fixes, 3 new tests failed:
- `codex engine materializes AGENTS.md` — `agents` key in ENGINE_INSTRUCTIONS meant `codex` was a no-op lookup
- `unknown engine rejected before planning` — no validation existed
- `manifest.engines lists only delivered` — raw `effectiveEngines` was passed (included undelivered engines)
- planner tests for `KNOWN_ENGINES` and `deliveredEngines` also failed (export didn't exist)

**GREEN:** All 48 tests pass (`ℹ pass 48 ℹ fail 0`).

## Files changed

1. `plugins/glue-core/lib/planner.mjs`
   - Renamed `agents` → `codex` in `ENGINE_INSTRUCTIONS`
   - Added `export const KNOWN_ENGINES = Object.keys(ENGINE_INSTRUCTIONS)`
   - `planTargets` now returns `{ targets, deliveredEngines }` — tracks engines for which `.tmpl` was found and an instruction target was planned; tagged each instruction target with its `engine` field
   - `plan()` returns `{ writes, materialized, deletes, conflicts, deliveredEngines }`

2. `plugins/glue-core/lib/init.mjs`
   - Imported `KNOWN_ENGINES` from `planner.mjs`
   - Added pre-planning validation loop: throws `Unknown engine: <x>. Known: claude, codex, gemini` for any unknown engine (before any disk access)
   - `applyPlan` now receives `engines: planResult.deliveredEngines` instead of `effectiveEngines`

3. `plugins/glue-core/test/fixtures/pack-a/rules/instructions/AGENTS.md.tmpl` — new file, mirrors `CLAUDE.md.tmpl` structure with `alpha`/`beta` module blocks

4. `plugins/glue-core/test/planner.test.mjs`
   - Imported `KNOWN_ENGINES` alongside `plan`
   - Added 3 new test cases: `KNOWN_ENGINES` export, `deliveredEngines` contains codex, gemini absent when template missing

5. `plugins/glue-core/test/init.test.mjs`
   - Added `readdirSync` import
   - Added 3 new test cases: codex materializes AGENTS.md + manifest.engines, unknown engine throws, gemini absent from manifest.engines

## Delivered-engines approach

`planTargets` accumulates a `deliveredEngines` Set as it processes instruction targets. An engine is added to `deliveredEngines` only when its `.tmpl` is found on disk (`existsSync` passes) — same guard that controls whether a target is pushed into `targets`. This is computed in one pass, co-located with the logic it reflects, with zero redundancy.

## Assumptions

- No assumption changes needed. `deliveredEngines` is an array in plan return (converted from Set) for JSON-serialization friendliness.
- The `engine` field added to instruction target entries in `targets` array is benign — writer ignores unknown fields; no downstream code breaks.
- Validation runs against `effectiveEngines` (after claude is auto-added), so claude itself is implicitly validated against KNOWN_ENGINES (it is present, no issue).
