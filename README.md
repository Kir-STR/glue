# Glue

Glue is an approach to working with project artifacts, embodied as a set of plugins: it makes a project's knowledge, rules, decisions, constraints, and skills addressable, linked, observable, and traceable. Glue doesn't manage your code, replace development or planning tools, or orchestrate agents — it ties together what lives around the work.

It ships through the `glue` marketplace: the `glue-core` plugin (command, map, judges, adapters) plus content packs you install as a project grows. Each pack depends on `glue-core@glue`, so the core is delivered automatically — you just pick the packs you need:

- **`glue-rules` (P1 "Rules & Knowledge")** — structure and visibility for rules and knowledge (soft control only — brings no constraints to enforce).
- **`glue-decisions` (P2 "Decisions & Constraints")** — recording decisions and hard enforcement of constraints (code judge + provenance).
- **`glue-support` (P3 "Support")** — the same pattern for infrastructure (backlog).

Full concept (in Russian): see [`docs/superpowers/specs/2026-06-23-glue-concept-design_v2.md`](docs/superpowers/specs/2026-06-23-glue-concept-design_v2.md).

## Repository

A standalone git repository with its own `.git`, which isolates Claude Code's memory: launched from this folder, Claude sees `glue` itself as the repo root rather than the parent vault, and keeps its own memory folder. The folder is ignored by the parent vault (`1.Projects/RnD/real-tools/*`) — this is a standalone repository, not a vault submodule. Same setup as the neighboring `invoker`.
