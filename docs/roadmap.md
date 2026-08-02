# Roadmap

Phased plan for three-cad. Architecture and product principles live in the other docs; this file sequences delivery and records open questions.

---

## North star

A **text-first** mechanical assembly workbench: plain language in, mesh assemblies out, viewport for inspect/measure/select, first-class validity, isolatable components, shareable idempotent documents—and room to grow part kinds (machined, sheet, molded, AM, imported) and UI affordances without rewriting the core.

---

## Phase 0 — Architecture in-repo ✅ (current deliverable)

**Goal:** Capture product direction before application code.

| Deliverable | Status |
|-------------|--------|
| [architecture.md](./architecture.md) | Written |
| [document-model.md](./document-model.md) | Written |
| [interface-evolution.md](./interface-evolution.md) | Written |
| [geometry-and-validity.md](./geometry-and-validity.md) | Written |
| [roadmap.md](./roadmap.md) | Written |
| Root [README.md](../README.md) | Product summary + links |

**Success:** A new contributor understands what we are (and are not) building without reading chat history.

---

## Phase 1 — Vertical slice

**Goal:** Prove the loop end-to-end with minimal generators.

- Mesh evaluator skeleton (manifold-oriented kernel + worker)  
- Minimal assembly document load/save  
- Structured ops for create part / instance / transform  
- Thin plain-language or text-command mapping into those ops  
- Three.js (or equivalent) viewport: view, mm scale, basic part pick  
- STL import + export (part and assembly)  
- Core checks: manifold/watertight, interference, crude min thickness  

**Success criteria:**

- [ ] Describe a small assembly via text; see it in mm in the viewport  
- [ ] Import a vendor STL; place it; detect interference  
- [ ] Export isolatable part STL  
- [ ] Reload document → same geometry (idempotent rebuild)  
- [ ] Validity report surfaces a failure clearly  

---

## Phase 2 — Assembly speed + selection-driven edits

**Goal:** Make multi-part work fast and make “that edge/face” addressable.

- Instance tree, hide, isolate, explode  
- Selection context fed into interpreter  
- First UIRequest capabilities: `pick.part`, `pick.face` / region, maybe `pick.edge`  
- Content-hash mesh cache  
- Shareable package layout (document + assets by hash)  
- Measure distance in viewport + text  

**Success criteria:**

- [ ] Isolate any instance in one command or click+command  
- [ ] Complete at least one edit that required a picker (e.g. feature on selected face)  
- [ ] Unchanged parts do not rebuild on unrelated ops  

---

## Phase 3 — Part-class depth

**Goal:** Move beyond generic boxes toward process-shaped geometry.

- Machined feature depth: holes, pockets, patterns, fillet/chamfer as document features with credible mesh  
- Sheet kind: gauge + simple bent solid from profile (visual)  
- Molded kind: shell/rib/boss oriented generators (even if simple)  
- AM kind: robust import path for dense meshes + thickness hygiene  
- Better surface-quality metrics and hotspot UX  
- Kind-specific check hooks  

**Success criteria:**

- [ ] Demo assembly mixes at least three kinds (e.g. machined + imported + sheet or AM)  
- [ ] Smooth-ish fillets/blends read as intentional, not accidental faceting only  
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

- [ ] A part definition can produce mesh today and higher-fidelity export later without a full redesign of the document  
- [ ] Downstream traditional CAD or AI CAD can use outputs as reference with clear expectations  

---

## Suggested implementation order (after Phase 0)

1. Document schema stub + in-memory store  
2. Evaluator + kernel wrapper + cache  
3. Viewport binding  
4. Structured command → ops → evaluate → view  
5. Import/export STL  
6. Validity module  
7. Selection + first UIRequest  
8. NL sugar on top of ops  
9. Broader generators / kinds  

---

## Defaults for open product choices

| Question | Default until revisited |
|----------|-------------------------|
| Interpreter v1 | Structured ops as core; NL maps into ops (rules first) |
| Host | Web app with text channel + viewport as reference UI |
| Kind priority | `generic`/`machined` + `imported` first; sheet/molded/am specified early, built in Phase 3 |
| Units | mm internal only |
| Kernel class | Manifold-oriented mesh solids |
| Export | STL first; glTF for structure; 3MF when needed |

---

## Open questions

1. **NL depth in Phase 1:** keyword/command parser only, or early LLM hook?  
2. **Transform convention:** Z-up vs Y-up for the whole stack—pick before first shared files.  
3. **History in file:** always store op log, optional, or external only?  
4. **Subassemblies:** instance parent tree only, or nested documents?  
5. **When to invest in sheet flat pattern** vs visual bent form only?  
6. **Repair policy for bad STLs:** auto-repair silent vs always warn?  

Record decisions here when made.

---

## Explicit deferrals

- Full sketcher + geometric constraint solver  
- Mate solver as required assembly core (explicit transforms first)  
- FEA, CAM, mold flow  
- Multiplayer  
- B-rep as v0 dependency  
- Certified manufacturing sign-off from mesh checks  

---

## Related docs

- [Architecture](./architecture.md)  
- [Document model](./document-model.md)  
- [Interface evolution](./interface-evolution.md)  
- [Geometry and validity](./geometry-and-validity.md)  
