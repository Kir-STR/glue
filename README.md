# Glue

Glue installs modular project rules and delivers them as native instruction files for Claude Code, Codex, and Gemini. You pick which rule modules and which engines; Glue writes the files and tracks them with a manifest.

It ships as a single `glue` plugin: the mechanism and the rule content are embedded in the plugin. This is an early, experimental foundation — today it delivers rules. Other artifact kinds (knowledge, decisions, constraints) are planned, not yet built.

## Quick start

Requires Node.js 22 or newer on `PATH`: the commands and the hook run the plugin's CLI with `node`.

```text
/plugin marketplace add Kir-STR/glue
/plugin install glue@glue
/glue:init
/glue:status
```

- `/glue:list` — shows the available rule modules (id, group, defaults, dependencies).
- `/glue:init` — installs the selected modules for the chosen engines. It writes the rule bodies to `.claude/rules/*.md`, native entry files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`), and a delivery manifest at `.glue/manifest.json`. Re-running with the same selection is a no-op. Files edited by hand are not overwritten: `init` reports them as conflicts and suggests `/glue:adopt`. If the project already has code or docs, `init` offers to fill the scaffold modules (safety, architectural invariants) from the code in the same run.
- `/glue:adopt` — connects Glue to a project that already has rules. Existing files are the baseline: the agent maps them to Glue modules, proposes targeted diffs, and you accept or reject each module. Files are written only after your confirmation; the per-module decisions are recorded in the manifest.
- `/glue:status` — reports whether installed files still match what Glue wrote: `missing`, `changed` (edited by hand), or `drift` (the plugin's template has changed since delivery, e.g. after an update).
- `/glue:feedback` — drafts a GitHub issue about a Glue problem and files it after your confirmation.

## Updating to 0.4.6

Content hashes no longer depend on line endings (CRLF/LF). After the update, `/glue:status` may once report `changed` for files written by `/glue:adopt` with CRLF endings. If `git status` shows no changes to such a file, a likely cause is the old hash: refresh the manifest with a regular `/glue:adopt`, reviewing and confirming the changes.

## Available today

- A library of modular rule modules, grouped (base discipline, git/PR workflow, subagent workflow, project governance).
- Native delivery: rule bodies in `.claude/rules/*.md`, with `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` as engine entry points that reference them.
- Adoption of existing rules (`/glue:adopt`) instead of overwriting them.
- A delivery manifest with content hashes and per-module decisions, so `/glue:status` can detect missing, hand-edited, or outdated files.
- A `SessionStart` hook that injects rule bodies into the agent's context while native delivery is not in place: before `/glue:init` (the default modules), or when `CLAUDE.md` or files under `.claude/rules/` go missing (the modules from the manifest). Hand edits do not switch it on.
- A feedback channel (`/glue:feedback`): Glue sends nothing on its own; a problem report becomes a public GitHub issue only after you approve its text.

## Planned

Not yet implemented — this is the direction, not current behavior:

- Project knowledge, decisions, and constraints as first-class artifact kinds.
- Skills and environments.
- Deterministic checks and semantic review.
- Provenance (tracing a constraint back to the decision that justifies it).
- A visual map of how artifacts link together.

The intended future model: a decision justifies a constraint, a constraint applies within a skill and environment, and a check produces a policy decision that the host can act on. Glue is meant to resolve *which* constraints apply to an agent action and explain the resulting decision — the host stays responsible for execution and enforcement.

The target architecture boundary is described in [docs/product-boundary_v1.md](docs/product-boundary_v1.md).

## What Glue is not

- It does not write application code.
- It is not a task tracker, project planner, or multi-agent orchestrator.
- It does not manage queues, retries, or sandboxes.
- It is not a code-graph analysis system.
- It does not execute project actions by itself.

## License

[Apache License 2.0](LICENSE).
