# Glue

Glue is an approach to working with project artifacts, embodied as a set of plugins: it makes a project's knowledge, rules, decisions, constraints, and skills addressable, linked, observable, and traceable. Glue doesn't manage your code, replace development or planning tools, or orchestrate agents — it ties together what lives around the work.

It ships as three self-contained plugins, installable in any combination as a project grows:

- **P1 "Rules & Knowledge"** — structure and visibility for rules and knowledge (no code judge).
- **P2 "Decisions & Constraints"** — recording decisions and hard enforcement of constraints (code judge + provenance).
- **P3 "Support"** — the same pattern for infrastructure (backlog).

Full concept (in Russian): see [`IDEA.md`](IDEA.md).

## Repository

A standalone git repository with its own `.git`, which isolates Claude Code's memory: launched from this folder, Claude sees `glue` itself as the repo root rather than the parent vault, and keeps its own memory folder. The folder is ignored by the parent vault (`1.Projects/RnD/real-tools/*`) — this is a standalone repository, not a vault submodule. Same setup as the neighboring `invoker`.
