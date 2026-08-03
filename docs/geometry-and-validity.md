# Geometry and validity

This document describes the **SDF / implicit solid kernel** (plan of record), how **part kinds** map to it, export expectations, and the **validity** system as a first-class product surface.

**Decision charter:** [issue #14](https://github.com/mikeornstein/three-cad/issues/14).

---

## Geometry strategy

### Field-first solids (plan of record)

Runtime solids are **signed distance / implicit fields** evaluated from the assembly document. Triangle meshes are **derivatives only** (viewport display, temporary picking, STL/3MF/glTF export). They are never the design solid.

| Choice | Rationale |
|--------|-----------|
| SDF / F-rep solids | Robust CSG, offsets, blends; one math for all part kinds |
| Millimeters | Real dimensions from day one |
| Derived meshes | Export handoff only (STL / 3MF / glTF) |
| GPU sphere-trace display | Inspection viewport (FieldNode → GLSL) |

**Not in v0:** OpenCascade / B-rep / STEP as the authority. Those remain a later or external manufacturing bridge.

**Retired:** Mesh-first Manifold solids as product direction. No permanent dual kernel (no “Manifold for machined / SDF for AM”).

### Authority chain

```text
Document (intent)
    → Evaluator (generators + field kernel)
        → FieldSolid (authority solid, mm)
            → GPU sphere-trace / field pick (interactive display)
            → Derived mesh (export only)
```

Parametric intent lives in the document. Fields (and mesh caches) are derived and cacheable by definition hash.

### Sign convention

```text
f(p) < 0  inside
f(p) = 0  surface (isosurface)
f(p) > 0  outside
```

True SDFs encode Euclidean distance. Practical CSG (`min` / `max`) often yields **bound fields** (safe lower bounds)—fine for meshing and ray marching, not always correct for naïve uniform offset until redistanced or restricted.

### Kernel direction

Implement a **field solid** kernel (TypeScript and/or WASM). Current scaffold: pure TS primitives + CSG ops + marching-cubes meshing under `src/sdf/`.

Requirements on the kernel abstraction:

- Create primitives (box, sphere, cylinder, extrude, …)  
- Boolean union / difference / intersection  
- Smooth blend / offset (with explicit distance-policy)  
- Transform  
- Import triangle soups → approximate field (success/fail + quality flags)  
- Export triangle data for STL/glTF only (`toMesh(quality)` — not for viewport)  
- Run off the main thread when used in interactive hosts (worker)  
- Optional leaf / material ids for future field-native selection  

Implementation wraps the kernel so part-kind generators stay testable.

### Distance policy (accepted constraint)

| Situation | Policy |
|-----------|--------|
| True-SDF primitives (box, sphere, …) | Metric distance; offset is trustworthy |
| After classic CSG (`min`/`max`) | Bound field; ray march/mesh OK; offset may be wrong |
| Ops that need metric thickness | Redistance, restrict to true-SDF subgraphs, or document approximation |

Do not pretend `min` always preserves Euclidean distance.

---

## Visually credible geometry

“Visually credible” means a human looking at the assembly believes the parts could be real mechanical objects at real scale—not that the mesh is a certified manufacturing solid.

Implications:

- Fillets, blends, and freeform surfaces live as **field ops / document intent**, then tessellate for display  
- Thin sheet bodies use offset/shell on fields when distance policy allows  
- AM / organic parts are natural field / lattice generators  
- Dimensions in the document are real mm values users can measure in the viewport  
- Interactive display is GPU sphere-trace (infinite surface fidelity within step ε). Marching cubes / dual contouring only at export.  

Higher surface continuity and exact CAD handoff come later.

---

## Part kinds and geometry

Kinds are defined in [document-model.md](./document-model.md). Generators emit **field graphs**:

### Generic / machined

- CSG primitives + extrudes + booleans on fields  
- Holes, pockets, patterns as features  
- Fillets / chamfers: global smooth-min early; targeted edge blends later  
- Goal: plates, brackets, housings, fixtures that read as machined  

### Formed sheet metal

- Thin solid via offset / shell from profile + bend metadata  
- Near term: **visual** bent form; flat-pattern unfold is later  
- Checks later: gauge consistency, min flange length (kind-specific)  

### Injection molded

- Shell-like bodies, ribs, bosses, generous blends as field ops  
- Outer skins may come from smoother generators or imported freeform → field  
- Checks later: crude draft heuristics (optional), thickness  

### Topology-optimized / AM

- Lattices / density fields as native generators  
- Or import mesh → field promotion  
- Checks: thickness for printability hygiene, watertight export  

### Imported vendor

- STL / OBJ / glTF as assets  
- Promote to approximate field solid  
- Record quality flags; limited ops until field quality is known  

**Shared across kinds:** isolatable, measurable, exportable, checkable, addressable by id for language-driven edits.

---

## Evaluation and caching

```text
definitionHash = hash(kind, generator, version, payload, assetHashes)
field = cache.get(definitionHash) ?? buildAndStore(definitionHash)
exportMesh = meshCache.get(definitionHash, quality) ?? fieldToMesh(field, quality)
```

- Instances only apply transforms; they do not duplicate part fields.  
- Assembly-level meshes for export may bake transforms.  
- Tessellation quality is part of the **export** mesh cache key, not the field identity.  
- Viewport display compiles `FieldNode` → GLSL and sphere-traces; it does not populate the mesh cache.  

---

## Import and export

### Import

| Format | Role |
|--------|------|
| STL | Common vendor / print mesh → approximate field |
| OBJ | Simple mesh exchange → field |
| glTF / GLB | Structured mesh + nodes when useful |

Import pipeline:

1. Decode → triangle mesh  
2. Build approximate signed field (BVH distance / voxel / hierarchical)  
3. Record asset hash + flags (`fieldQuality`, `repaired`, …)  
4. Part kind `imported` references asset + field derivative  

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

## Selection and measurement (migration)

**Plan of record** is field-native identity, not triangle adjacency:

| Kind | Field-native idea |
|------|-------------------|
| Solid | Instance / part field root |
| Face / region | CSG leaf id, material id, or multi-label face fields |
| Edge | Sharp crease (∇f discontinuity) or multi-label junction |
| Vertex | Multi-edge / multi-face junction samples |

**Current codebase:** mesh topology pick/measure remains as **migration debt** so the scaffold stays usable while the kernel lands. It will be redesigned (selection v2, measure v2)—not treated as long-term authority.

Authority measurements (target):

- Point ↔ surface via \|f\| / projection along ∇f  
- Clearance / interference via field samples or instance CSG  
- Bbox from primitive bounds or sampled bounds  
- Diameter / circular features: document-declared or detected—not “triangle soup ≈ circle” as truth  

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

| Check | Meaning | Field approach (direction) |
|-------|---------|----------------------------|
| **Watertight / solid** | Closed solid, consistent export | Well-formed field + manifold-ish meshing policy on export |
| **Min thickness** | No region thinner than threshold | Interior distance sampling / medial-ish probes on \(f\) |
| **Interference** | Unwanted solid overlap between instances | Field CSG of instances or dense sampling + hotspots |
| **Surface quality** | Display/export hygiene | Gradient health, crease noise, mesh derivative metrics |

### Assembly vs part

| Scope | Typical checks |
|-------|----------------|
| Part | Solid/export policy, min thickness, surface quality |
| Assembly | Interference (+ optional clearance later), aggregate policy |

### Kind-specific checks (extensible)

Attach without breaking the core report schema, e.g.:

- Sheet: gauge vs measured thickness distribution  
- AM: minimum feature size / thickness for print hygiene  
- Molded: optional draft-ish heuristics later  

### Honesty

Field-based thickness and surface metrics are **design hygiene**, not certified manufacturing validation. Document thresholds in UX copy accordingly. False positives/negatives are expected; hotspots help humans judge.

### Policy

Defaults live in the document (`checkPolicy`). Commands may override for a one-shot run. “Set minimum thickness policy to 1.5 mm” is a DocumentOp.

---

## Smooth parts and future enrichment

Users will want real **smooth** mechanical character:

- Machined fillets and blends  
- Sheet bends with realistic radii  
- Molded continuous skins  
- AM organic surfaces  

Strategy:

1. Store smooth intent in the document (radii, blend targets, freeform refs).  
2. Evaluate as field ops where possible.  
3. Tessellate credibly for display and mesh export (improve mesher over time).  
4. Optionally add a B-rep/STEP path later for external manufacturing without rewriting the document model.  

Do not block assembly workflow on exact curvature.

---

## Performance notes

- Evaluate fields in a worker; keep the viewport responsive.  
- Cache fields by definition hash; cache meshes by (hash, quality).  
- Rebuild only dirty parts when ops land.  
- Progressive quality (coarse while dragging UI, fine on commit) is allowed.  
- Ray-marched display is the default; tessellation is export-only (and transitional tests).  

---

## Related docs

- [Architecture](./architecture.md)  
- [Document model](./document-model.md)  
- [Interface evolution](./interface-evolution.md)  
- [Roadmap](./roadmap.md)  
- Epic: [issue #14](https://github.com/mikeornstein/three-cad/issues/14)  
