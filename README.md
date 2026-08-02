# three-cad

**Text-first mechanical assembly workbench** — not a traditional CAD GUI.

Describe assemblies in plain language (and structured intent). Inspect, measure, and call out features in a 3D viewport. Geometry is **mesh-first** with real millimeter dimensions, built for fast assembly visualization and **first-class geometric validity** (watertightness, interference, minimum thickness, surface hygiene). Components are isolatable and exportable (STL / mesh) as reference for humans or AI using other tools.

The interface is **meant to evolve**: language is interpreted into durable document operations, and the system may open new UI affordances when a spatial edit needs them.

## Status

**Phase 0 — architecture and roadmap only.** No application runtime yet.

## Docs

| Document | Contents |
|----------|----------|
| [docs/architecture.md](./docs/architecture.md) | Product thesis, layers, principles, non-goals |
| [docs/document-model.md](./docs/document-model.md) | Assembly / part / instance / asset model, idempotency |
| [docs/interface-evolution.md](./docs/interface-evolution.md) | Plain language, interpreter, UIRequest capabilities |
| [docs/geometry-and-validity.md](./docs/geometry-and-validity.md) | Mesh strategy, part kinds, checks, export |
| [docs/roadmap.md](./docs/roadmap.md) | Phased milestones and open questions |

## Product snapshot

```
plain language → interpreter → document ops (+ optional UI)
                    ↓
              mesh evaluation + validity
                    ↓
         viewport inspect / measure / select
```

**Part kinds** (architected early, implemented progressively): machined, formed sheet metal, injection molded, topology-optimized / AM, and imported vendor geometry—not only primitives.

**Near-term non-goals:** full CAD sketcher, B-rep/STEP kernel as authority, process simulation (FEA/CAM/mold flow).

## Contributing

Work is **ticket-driven**: Issues → feature branches → PRs into `main`. Never push product work directly to `main`.

- **Humans:** [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Agents:** [AGENTS.md](./AGENTS.md) (full playbook: git hygiene, CI, verification)

`main` is branch-protected (PRs required, force-push/delete blocked, CI status `check` required). Re-apply with `./scripts/setup-branch-protection.sh` if settings drift.

## License

TBD.
