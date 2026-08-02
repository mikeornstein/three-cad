# Geometry and validity

This document describes the **mesh-first geometry strategy**, how different **part kinds** map to it, export expectations, and the **validity** system as a first-class product surface.

---

## Geometry strategy

### Mesh-first (near term)

Runtime solids are **meshes**, evaluated from the assembly document.

| Choice | Rationale |
|--------|-----------|
| Mesh solids | Fast iteration, small stack, good enough for assembly visualization |
| Millimeters | Real dimensions from day one |
| Manifold-oriented kernel | Robust booleans; watertight solids as a default goal |
| Tessellated display in Three.js (or equivalent) | Inspection viewport |

**Not in v0:** OpenCascade / B-rep / STEP as the authority. Those remain a later or external manufacturing bridge.

### Authority chain

```text
Document (intent)
    → Evaluator (generators + mesh kernel)
        → Mesh solids (exact-enough for viz / mesh export)
            → Viewport buffers (disposable)
```

Parametric intent lives in the document. Meshes are derived and cacheable.

### Kernel direction

Prefer a library designed for **manifold solid boolean** results (e.g. Manifold / `manifold-3d` class of tools) over ad-hoc triangle CSG that leaves non-manifold junk.

Requirements on the kernel abstraction:

- Create primitives (box, cylinder, extrude, …)  
- Boolean union / difference / intersection  
- Transform  
- Import triangle soups with clear success/fail (repair optional)  
- Export triangle data for STL/glTF and for display  
- Run off the main thread when used in interactive hosts (worker)  

Implementation may wrap the kernel so part-kind generators stay testable.

---

## Visually credible geometry

“Visually credible” means a human looking at the assembly believes the parts could be real mechanical objects at real scale—not that the mesh is a certified manufacturing solid.

Implications:

- Fillets, blends, and freeform surfaces are **approximated** with sufficient tessellation  
- Thin sheet bodies have believable gauge thickness  
- AM / organic parts may be dense meshes  
- Dimensions in the document are real mm values users can measure in the viewport  

Higher surface continuity and exact CAD handoff come later.

---

## Part kinds and geometry

Kinds are defined in [document-model.md](./document-model.md). Geometry notes:

### Generic / machined

- CSG primitives + extrudes + booleans  
- Holes, pockets, patterns as features  
- Fillets / chamfers / blends as mesh approximations of edge treatments  
- Goal: plates, brackets, housings, fixtures that read as machined  

### Formed sheet metal

- Thin solid (offset shell or solid of gauge thickness) from profile + bend metadata  
- Near term: **visual** bent form; flat-pattern unfold is later  
- Checks later: gauge consistency, min flange length (kind-specific)  

### Injection molded

- Shell-like bodies, ribs, bosses, generous fillets  
- Outer skins may come from smoother generators or imported freeform  
- Checks later: crude draft heuristics (optional), thickness  

### Topology-optimized / AM

- Often **imported** dense meshes from external optimizers  
- Or procedural generators (lattices, smoothed density fields)—phased  
- Preserve manifoldness when possible; otherwise display + warn  
- Checks: thickness for printability hygiene, watertight  

### Imported vendor

- STL / OBJ / glTF as assets  
- Promote to Manifold solid when topology allows  
- Otherwise: display mesh, limited booleans, explicit validity warnings  

**Shared across kinds:** isolatable, measurable, exportable, checkable, addressable by id for language-driven edits.

---

## Evaluation and caching

```text
definitionHash = hash(kind, generator, version, payload, assetHashes)
mesh = cache.get(definitionHash) ?? buildAndStore(definitionHash)
```

- Instances only apply transforms; they do not duplicate part meshes.  
- Assembly-level meshes for export may bake transforms.  
- Changing tessellation quality settings should be part of the hash or a separate display derivative so “export quality” is intentional.

---

## Import and export

### Import

| Format | Role |
|--------|------|
| STL | Common vendor / print mesh |
| OBJ | Simple mesh exchange |
| glTF / GLB | Structured mesh + nodes when useful |

Import pipeline:

1. Decode → triangle mesh  
2. Attempt solid/manifold promotion  
3. Record asset hash + flags (`manifold: true/false`, `repaired: …`)  
4. Part kind `imported` references asset  

### Export

| Format | Role |
|--------|------|
| STL | Ubiquitous mesh handoff; per part or baked assembly |
| 3MF | Richer print-oriented package (later ok) |
| glTF / GLB | Shareable viz; may preserve instance graph |

**Expectation setting:** exports are **reference geometry** for humans and AI using traditional CAD or other tools—not guaranteed drop-in CNC B-rep.

### Isolation

Export and checks accept a scope:

- Single part  
- Single instance  
- Subassembly (instance subtree)  
- Whole assembly  

---

## Validity system

Validity is a **product feature**. Users and agents should be able to demand checks at any time; evaluation paths should be able to attach reports by default.

### Report shape (conceptual)

```text
ValidityReport
├── targetId          // part, instance, or assembly
├── scope             // part | instance | assembly
├── ok                // overall
├── checks[]
│   ├── type          // watertight | minThickness | interference | surfaceQuality | …
│   ├── pass
│   ├── metrics       // type-specific numbers
│   ├── message
│   └── hotspots[]    // points / regions for viewport highlight
└── policySnapshot    // thresholds used
```

Text channel prints human-readable summaries; viewport consumes hotspots.

### Core checks

| Check | Meaning | Mesh approach (direction) |
|-------|---------|---------------------------|
| **Watertight / manifold** | Closed solid, consistent topology | Kernel manifold status + topology audit |
| **Min thickness** | No region thinner than threshold | Sampling / ray pairs / local thickness estimates; report min and hotspots |
| **Interference** | Unwanted solid overlap between instances | Broadphase then boolean intersection volume > ε |
| **Surface quality** | Mesh hygiene for credible solids | Triangle aspect ratio, degenerates, normal consistency; later curvature proxies |

### Assembly vs part

| Scope | Typical checks |
|-------|----------------|
| Part | Watertight, min thickness, surface quality |
| Assembly | Interference (+ optional clearance later), aggregate policy |

### Kind-specific checks (extensible)

Attach without breaking the core report schema, e.g.:

- Sheet: gauge vs measured thickness distribution  
- AM: minimum feature size / thickness for print hygiene  
- Molded: optional draft-ish heuristics later  

### Honesty

Mesh-based thickness and surface metrics are **design hygiene**, not certified manufacturing validation. Document thresholds in UX copy accordingly. False positives/negatives are expected; hotspots help humans judge.

### Policy

Defaults live in the document (`checkPolicy`). Commands may override for a one-shot run. “Set minimum thickness policy to 1.5 mm” is a DocumentOp.

---

## Measurement

Viewport and text channel should share measurement semantics:

- Distance between points / features  
- Bounding box sizes  
- Simple diameters from circular edge approximations when available  
- Always in mm internally; format for display  

Measurements are read-only unless the user commits a change derived from them (“move until gap is 2 mm” → transform op).

---

## Smooth parts and future enrichment

Users will want real **smooth** mechanical character:

- Machined fillets and blends  
- Sheet bends with realistic radii  
- Molded continuous skins  
- AM organic surfaces  

Near-term strategy:

1. Store smooth intent in the document (radii, blend targets, freeform refs).  
2. Tessellate credibly for display and mesh export.  
3. Improve tessellation quality and generators over time.  
4. Optionally add a B-rep/STEP path later for external manufacturing without rewriting the document model—generators gain a second backend.

Do not block assembly workflow on exact curvature.

---

## Performance notes

- Evaluate in a worker; keep the viewport responsive.  
- Cache by definition hash.  
- Rebuild only dirty parts when ops land.  
- Progressive quality (coarse while dragging UI, fine on commit) is allowed as a host optimization if hashes distinguish quality or display meshes are separate from export meshes.

---

## Related docs

- [Architecture](./architecture.md)  
- [Document model](./document-model.md)  
- [Interface evolution](./interface-evolution.md)  
- [Roadmap](./roadmap.md)  
