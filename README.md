# three-cad

**Text-first mechanical assembly workbench** — not a traditional CAD GUI.

Describe assemblies in plain language (and structured intent). Inspect assemblies in a 3D viewport (selection and measure are planned, not shipping yet). Solids are **SDF / implicit fields** with real millimeter dimensions; the viewport **sphere-traces fields on WebGPU**; triangle meshes are **export derivatives only**. Built for fast assembly visualization and **first-class geometric validity** (solid integrity, interference, minimum thickness, surface hygiene). Components are isolatable and exportable (STL / mesh) as reference for humans or AI using other tools.

The interface is **meant to evolve**: language is interpreted into durable document operations, and the system may open new UI affordances when a spatial edit needs them.

## Status

**Phase 1 in progress** — viewport scaffold + **SDF kernel** demo solid (cube ∪ sphere) with **WebGPU sphere-trace** display. Geometry selection/measure deferred. Architecture docs describe field-first solids.

**Live demo:** [mikeornstein.github.io/three-cad](https://mikeornstein.github.io/three-cad/) — published from `main` via GitHub Pages.

### Run locally

```bash
npm install
npm run dev
```

Open the printed local URL (app base is `/three-cad/`, same as production). Orbit / pan / zoom the demo solid (100 mm cube ∪ 100 mm-diameter sphere). Units are **mm**; world is **Z-up**.

**Requires WebGPU** (Chrome, Edge, Firefox, or Safari 26+). There is no WebGL display fallback.

```bash
npm run build      # typecheck + production bundle
npm run typecheck  # tsc only
npm run preview    # serve dist/ locally
```

## Docs

| Document | Contents |
|----------|----------|
| [docs/architecture.md](./docs/architecture.md) | Product thesis, layers, principles, non-goals |
| [docs/document-model.md](./docs/document-model.md) | Assembly / part / instance / asset model, idempotency |
| [docs/interface-evolution.md](./docs/interface-evolution.md) | Plain language, interpreter, UIRequest capabilities |
| [docs/geometry-and-validity.md](./docs/geometry-and-validity.md) | SDF kernel, part kinds, checks, export |
| [docs/roadmap.md](./docs/roadmap.md) | Phased milestones and open questions |

## Product snapshot

```
plain language → interpreter → document ops (+ optional UI)
                    ↓
              field evaluation + validity
                    ↓
         derived mesh / viewport inspect (measure / select later)
```

**Part kinds** (architected early, implemented progressively): machined, formed sheet metal, injection molded, topology-optimized / AM, and imported vendor geometry—not only primitives.

**Near-term non-goals:** full CAD sketcher, B-rep/STEP kernel as authority, dual mesh solid kernel, process simulation (FEA/CAM/mold flow).

## Contributing

Work is **ticket-driven**: Issues → feature branches → PRs into `main`. Never push product work directly to `main`.

- **Humans:** [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Agents:** [AGENTS.md](./AGENTS.md) (full playbook: git hygiene, CI, verification)

`main` is branch-protected (PRs required, force-push/delete blocked, CI status `check` required). Re-apply with `./scripts/setup-branch-protection.sh` if settings drift.

## License

TBD.
