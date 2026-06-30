# Glue

Glue installs modular project rules and delivers them as native instruction files for Claude Code, Codex, and Gemini. You pick which rule modules and which engines; Glue writes the files and tracks them with a manifest.

It ships as a single `glue` plugin: the mechanism and the rule content are embedded in the plugin. This is an early, experimental foundation — today it delivers rules. Other artifact kinds (knowledge, decisions, constraints) are planned, not yet built.

## Quick start

```text
/plugin marketplace add Kir-STR/glue
/plugin install glue@glue
/glue:init
/glue:status
```

- `/glue:list` — shows the available rule modules (id, group, defaults, dependencies).
- `/glue:init` — installs the selected modules for the chosen engines. It writes the rule bodies to `.claude/rules/*.md`, native entry files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`), and a delivery manifest at `.glue/manifest.json`. Re-running with the same selection is a no-op.
- `/glue:status` — reports whether installed files still match what Glue wrote: `missing`, `changed` (edited by hand), or in `drift`.

## Available today

- A library of modular rule modules, grouped (base discipline, git/PR workflow, subagent workflow, project governance).
- Native delivery: rule bodies in `.claude/rules/*.md`, with `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` as engine entry points that reference them.
- A delivery manifest with content hashes, so `/glue:status` can detect missing or hand-edited files.
- A `SessionStart` hook that injects baseline guardrails into the agent's context until you run `/glue:init`.

## Planned

Not yet implemented — this is the direction, not current behavior:

- Project knowledge, decisions, and constraints as first-class artifact kinds.
- Skills and environments.
- Deterministic checks and semantic review.
- Provenance (tracing a constraint back to the decision that justifies it).
- A visual map of how artifacts link together.

The intended future model: a decision justifies a constraint, a constraint applies within a skill and environment, and a check produces a policy decision that the host can act on. Glue is meant to resolve *which* constraints apply to an agent action and explain the resulting decision — the host stays responsible for execution and enforcement.

## What Glue is not

- It does not write application code.
- It is not a task tracker, project planner, or multi-agent orchestrator.
- It does not manage queues, retries, or sandboxes.
- It is not a code-graph analysis system.
- It does not execute project actions by itself.

## License

[Apache License 2.0](LICENSE).
