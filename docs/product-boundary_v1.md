# Glue — target architecture boundary

> **Target model — not current behavior.** This document describes the intended architecture boundary of Glue. Today Glue delivers rule modules only; constraints, environments, checks, and provenance are planned (see README § Planned). Statements marked `[target]` become present-tense as they are implemented, starting with the enforcement tracer.

## Boundary statements

```text
Glue controls applicability and provenance, not execution.   [target]
Glue references artifacts; it need not own all of them.
Glue binds constraints to skills and environments.           [target]
Glue delegates deterministic checks to judge providers;
veto lives at the host boundary.                             [target]
```

## Role of the host

The host (agent harness, CI, or pipeline) is responsible for gating, veto, and execution. Glue is intended to resolve *which* constraints apply to an agent action (skill × environment), collect evidence and verdicts from judge providers, and return a policy decision with full provenance (decision → constraint → check). Acting on that decision — blocking, warning, or proceeding — always happens on the host side.

## External providers

Glue references artifacts; it does not need to own them:

- **Decisions** may live in an external system (e.g., Archcore) behind a DecisionProvider.
- **Deterministic checks** may be delegated to an external engine (e.g., OpenLore) behind a JudgeProvider.

In the target model, backends are replaceable; the applicability + provenance chain remains Glue's own layer. [target]

## What Glue never does

- **No ExecutionAdapter.** No grant/deny control plane, no execution of project actions — an attribute of the rejected branch A (the control-plane design); Glue follows branch B (provenance substrate).
- Per README § "What Glue is not": no application code writing, no task tracking or orchestration, no queue/retry/sandbox management, no code-graph analysis.
