# Roadmap

Phased plan for three-cad. Architecture and product principles live in the other docs; this file sequences delivery and records open questions.

**Kernel plan of record:** SDF / implicit field solids ([issue #14](https://github.com/mikeornstein/three-cad/issues/14)). Meshes are derivatives only.

---

## North star

A **text-first** mechanical assembly workbench: plain language in, **field-evaluated** assemblies out, viewport for inspect/measure/select, first-class validity, isolatable components, shareable idempotent documents—and room to grow part kinds (machined, sheet, molded, AM, imported) and UI affordances without rewriting the core.

---

## Phase 0 — Architecture in-repo ✅

**Goal:** Capture product direction before application code.

| Deliverable | Status |
|-------------|--------|
| [architecture.md](./architecture.md) | Written (updated for SDF) |
| [document-model.md](./document-model.md) | Written |
| [interface-evolution.md](./interface-evolution.md) | Written |
| [geometry-and-validity.md](./geometry-and-validity.md) | Written (SDF plan of record) |
| [roadmap.md](./roadmap.md) | Written |
| Root [README.md](../README.md) | Product summary + links |

**Success:** A new contributor understands what we are (and are not) building without reading chat history.

---

## Phase 1 — Vertical slice (in progress)

**Goal:** Prove the loop end-to-end with field solids and minimal generators.

**Scaffold done:**

- [x] Vite + TypeScript + Three.js host  
- [x] Viewport: orbit / pan / zoom, mm grid, **Z-up**  
- [x] SDF kernel scaffold (`src/sdf/`): primitives, CSG, marching-cubes mesh (export)  
- [x] Demo solid via SDF (cube ∪ sphere in mm — not full evaluator)  
- [x] Manifold dependency removed from product path  
- [x] GPU sphere-trace viewport (`src/render/`) — FieldNode → GLSL; no display meshing  
- [x] Mesh-era selection + measure bar (migration debt; face/solid field pick for ray-march)  

**Still to do (re-aimed for fields):**

- Field evaluator skeleton (worker + cache by definition hash)  
- Minimal assembly document load/save  
- Structured ops for create part / instance / transform  
- Thin plain-language or text-command mapping into those ops  
- **Selection v2** — surface regions to creases (#32); edges/verts (#33); feature handles (#34)  
- **Measure v2** — field distance, bbox, interference-oriented queries  
- Mesh import → approximate field + STL export from field meshing  
- Core checks on fields: solid/export policy, interference, min thickness  

**Success criteria:**

- [ ] Describe a small assembly via text; see **field-evaluated** geometry in mm in the viewport  
- [ ] Import a vendor mesh → field; place it; detect interference  
- [ ] Export isolatable part STL from field meshing  
- [ ] Reload document → same geometry (idempotent rebuild)  
- [ ] Validity report surfaces a failure clearly  

---

## Phase 2 — Assembly speed + selection-driven edits

**Goal:** Make multi-part work fast and make “that edge/face” addressable **on fields**.

- Instance tree, hide, isolate, explode  
- Field-native selection context fed into interpreter  
- First UIRequest capabilities: `pick.part`, `pick.face` / region, maybe `pick.edge`  
- Content-hash field + mesh caches  
- Shareable package layout (document + assets by hash)  
- Measure distance in viewport + text (field queries)  

**Success criteria:**

- [ ] Isolate any instance in one command or click+command  
- [ ] Complete at least one edit that required a picker (e.g. feature on selected face/region)  
- [ ] Unchanged parts do not rebuild on unrelated ops  

---

## Phase 3 — Part-class depth

**Goal:** Move beyond generic boxes toward process-shaped field generators.

- Machined feature depth: holes, pockets, patterns, fillet/chamfer as document features with field ops  
- Sheet kind: gauge + simple bent solid via offset (visual)  
- Molded kind: shell/rib/boss oriented generators (even if simple)  
- AM kind: lattices / dense freeform as native fields + thickness hygiene  
- Better surface-quality metrics and hotspot UX  
- Kind-specific check hooks  
- Improve mesher (dual contouring / feature-aware) for sharper mechanical export  

**Success criteria:**

- [ ] Demo assembly mixes at least three kinds (e.g. machined + imported + sheet or AM)  
- [ ] Smooth-ish fillets/blends read as intentional  
- [ ] Checks run per kind without special-case host code  

---

## Phase 4 — Language and interface growth

**Goal:** Plain language and dynamic affordances feel native.

- Stronger interpreter (rules → LLM-assisted), always compiling to DocumentOps  
- Richer capability registry (param forms, thickness tools, section view)  
- Op log visible for “what did the system do?”  
- Agent-friendly structured API matching ops  

**Success criteria:**

- [ ] Multi-step NL edit session without the user learning a large CLI manual  
- [ ] Interpreter can request UI mid-flow and resume  
- [ ] Same ops runnable from agent without the NL layer  

---

## Phase 5+ — Manufacturing bridge (optional / external)

**Goal:** Better handoff to real manufacturing workflows without abandoning the document model.

- Higher-quality mesh export conventions  
- Optional B-rep/STEP backend or external converter pipeline  
- Harder DFM-oriented checks (still honest about limits)  
- Flat pattern for sheet, richer molded/AM rules as value accrues  

**Success criteria:**

- [ ] A part definition can produce field + mesh today and higher-fidelity export later without a full redesign of the document  
- [ ] Downstream traditional CAD or AI CAD can use outputs as reference with clear expectations  

---

## Suggested implementation order (after SDF charter #14)

1. ~~Viewport scaffold (mm, Z-up, demo solid)~~ ✅  
2. ~~SDF kernel + demo; remove Manifold~~ ✅ (initial)  
3. Docs aligned to field-first ✅ (this track)  
4. Selection v2: surface-region faces (#32) → edges/verts (#33) → feature handles (#34)  
4b. Measure v2 (field-native)  
5. Document schema stub + in-memory store  
6. Evaluator + worker + cache  
7. Viewport binding to evaluated scene  
8. Structured command → ops → evaluate → view  
9. Import mesh→field / export STL from field  
10. Validity module (field sampling)  
11. NL sugar on top of ops  
12. Broader generators / kinds  

---

## Defaults for open product choices

| Question | Default until revisited |
|----------|-------------------------|
| Interpreter v1 | Structured ops as core; NL maps into ops (rules first) |
| Host | Web app with text channel + viewport as reference UI |
| Kind priority | `generic`/`machined` + `imported` first; sheet/molded/am specified early, built in Phase 3 |
| Units | mm internal only |
| Transform convention | **Z-up**, right-handed (decided with first viewport) |
| Kernel class | **SDF / implicit field solids** (plan of record) |
| Mesh role | **Export only** (display = GPU sphere-trace) |
| Export | STL first; glTF for structure; 3MF when needed |

---

## Open questions

1. **NL depth in Phase 1:** keyword/command parser only, or early LLM hook?  
2. ~~**Transform convention:** Z-up vs Y-up~~ → **Z-up** (see defaults table).  
3. **History in file:** always store op log, optional, or external only?  
4. **Subassemblies:** instance parent tree only, or nested documents?  
5. **When to invest in sheet flat pattern** vs visual bent form only?  
6. **Repair / field-quality policy for bad STLs:** auto-approx silent vs always warn?  
7. ~~**Display:** ray-march vs tessellate?~~ → **GPU sphere-trace display; mesh export-only** (#30)  
8. **Mesher:** dual contouring timeline for sharp mechanical edges?  
9. **WASM:** stay pure TS longer, or port libfive-class F-rep?  
10. ~~**Face pick model**~~ → **Surface region flood-fill to creases**; planar = classification; blends as high-κ bands later (#32)  

Record decisions here when made.

---

## Explicit deferrals

- Full sketcher + geometric constraint solver  
- Mate solver as required assembly core (explicit transforms first)  
- FEA, CAM, mold flow  
- Multiplayer  
- B-rep as v0 dependency  
- Permanent dual solid kernels  
- Certified manufacturing sign-off from field/mesh heuristics alone  

---

## Related docs

- [Architecture](./architecture.md)  
- [Document model](./document-model.md)  
- [Interface evolution](./interface-evolution.md)  
- [Geometry and validity](./geometry-and-validity.md)  
