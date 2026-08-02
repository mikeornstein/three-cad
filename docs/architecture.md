# Architecture

## Product thesis

**three-cad is a text-first mechanical assembly workbench**, not a traditional CAD application.

Users describe mechanical assemblies in plain language (and structured intent). The system interprets that intent into a durable document, evaluates **visually credible mesh geometry**, and exposes a viewport for **inspection, measurement, and selecting features** that need further adjustment. Geometric validity—watertight solids, interference, minimum thickness, surface hygiene—is a first-class product surface, not an afterthought.

| Is | Is not |
|----|--------|
| Plain-language and structured **intent in** | Sketch / feature / gizmo CAD as the primary UI |
| Viewport for **inspect, measure, select/call-out** | Freehand modeling surface |
| **Mesh-first** visually credible geometry (near term) | B-rep manufacturing kernel as a v0 requirement |
| **Validity checks** as core product behavior | Render-only sandbox |
| **Evolving interface**—interpreter may open new affordances | A frozen CLI grammar as the product identity |
| Assemblies of **real part classes** (machined, sheet, molded, AM, imported) | Forever limited to boxes and cylinders |

Manufacturing-grade exact solids (STEP/B-rep) and full process simulation live **later or outside** this tool. Downstream humans or AI designers may use traditional CAD with our mesh export as reference.

---

## Primary loop

```
plain language (or structured intent)
        ↓
interpreter → document ops + optional UI requests
        ↓
geometry evaluation (mesh) + validity reports
        ↓
viewport inspect / measure / select features
        ↓
selection + language refine the next edit
```

Everything that permanently changes the design must land as **durable operations on a document**. Ephemeral UI (pickers, sliders, temporary measure tools) exists only to resolve intent that text alone cannot.

---

## Layered system

```
┌─────────────────────────────────────────────────────────────────┐
│ Intent channel                                                   │
│  plain language · structured commands · (later: voice / files)   │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Interpreter                                                      │
│  parse / disambiguate / plan                                     │
│  → DocumentOps                                                   │
│  → UIRequests (picker, parameter sheet, measure tool, …)         │
│  → Questions back to user                                        │
└───────────────┬───────────────────────────────┬─────────────────┘
                │                               │
                ▼                               ▼
┌───────────────────────────┐     ┌───────────────────────────────┐
│ Assembly Document         │     │ Interface Host                │
│  parts · instances ·      │◄────│  text channel · evolving UI   │
│  assets · check policy ·  │     │  viewport selection context   │
│  optional op history      │     └───────────────┬───────────────┘
└─────────────┬─────────────┘                     │
              ▼                                   │ picks / measures
┌───────────────────────────┐                     │
│ Evaluator                 │                     │
│  generators by part kind  │                     │
│  mesh kernel              │                     │
│  cache by content hash    │                     │
└─────────────┬─────────────┘                     │
              ├──────────────► Validity Engine    │
              ▼                                   │
┌───────────────────────────┐                     │
│ Scene / Viewport          │◄────────────────────┘
│  inspect · isolate ·      │
│  highlight check hotspots │
└─────────────┬─────────────┘
              ▼
         Export (STL / 3MF / glTF)
```

### Stable core vs evolvable surface

| Stable (change carefully) | Evolvable (expected to churn) |
|---------------------------|-------------------------------|
| Assembly document model | CLI / text grammar |
| Document operations | Agent prompts and NL phrasing |
| Geometry evaluation contract | Widgets and task-specific UI |
| Validity report shape | How results are presented |
| Units and identity rules | Host shell (web, terminal, etc.) |

**Stable core = document + ops + geometry + checks.**  
**Unstable surface = language surface, widgets, prompts.**

This split is deliberate: users will keep inventing better ways to express edits. New interfaces must not require rewriting the meaning of an assembly.

---

## Layer responsibilities

### Intent channel

Entry point for user desire: plain language first, structured commands as a durable intermediate (and for agents/scripts). Future channels (files, voice) map into the same interpreter.

### Interpreter

Turns intent into:

1. **DocumentOps** — commits that mutate the assembly document  
2. **UIRequests** — ask the host to open a registered capability (edge picker, thickness field, …)  
3. **Questions** — clarifications when intent is ambiguous  

The interpreter does not own geometry. It plans and commits; the evaluator builds meshes.

See [interface-evolution.md](./interface-evolution.md).

### Assembly document

Source of truth for design intent: parts, instances, transforms, imported assets, check policy. Geometry is **derived**. Same document + same generator versions should rebuild identically (idempotency).

See [document-model.md](./document-model.md).

### Evaluator

Maps part definitions to meshes (and instance transforms to a scene graph). Uses a mesh solid kernel suitable for robust booleans and manifold solids. Caches by content hash so unchanged parts are not rebuilt.

### Validity engine

Produces structured reports for parts and assemblies: watertight/manifold, min thickness, interference, surface quality, plus extensible kind-specific checks. Hotspots feed viewport highlighting.

See [geometry-and-validity.md](./geometry-and-validity.md).

### Interface host

Presents the text channel, viewport, and any ephemeral UI requested by the interpreter. The host binds **selection context** (what the user picked) back into subsequent interpretation. It is not the authority on design state.

### Viewport

Read-mostly inspection surface:

- View, isolate, hide, explode  
- Measure  
- Select parts / regions / features so language can refer to them  
- Highlight validity failures  

No freehand solid modeling tools as the primary path.

### Export

Mesh formats (STL, 3MF, glTF/GLB) for isolatable components and whole assemblies. Low-friction handoff to humans, AI, and traditional tools as **reference geometry**. Exact CAD interchange is a later concern.

---

## Product principles

### 1. Language is the front door; the interface is not frozen

Plain language is the default input. The interpreter may open new UI surfaces when text is a poor fit for spatial or multi-value edits. Those surfaces resolve parameters and selections; they do not become a parallel source of truth.

### 2. Mesh-first now; manufacturing fidelity later

- Runtime: mesh solids with real **millimeter** dimensions  
- Export: mesh as reference  
- Exact B-rep / STEP: future or external  

### 3. Part classes span real processes

The document and generator architecture treat these as first-class **kinds**, not afterthoughts:

- Machined (fillets, blends, bores, pockets, patterns)  
- Formed sheet metal (gauge, bends, flanges)  
- Injection molded (shells, ribs, bosses, complex skins)  
- Topology-optimized / AM (organic solids, dense freeform)  
- Imported vendor geometry  

v0 does not implement full process DFM. It **must not** hard-code a world where only CSG boxes exist. Smooth features are mesh approximations first.

### 4. Validity is product, not a QA script

Create and evaluate paths always can return structured validity. Failure is visible in text reports and in the viewport.

### 5. Transportable, shareable, idempotent

- Document is shareable and versionable  
- Imports are content-addressed  
- Components are isolatable and independently exportable  
- Rebuilds are deterministic given generator versions  

---

## Non-goals (near term)

- Full SolidWorks / Onshape / Fusion clone  
- B-rep kernel as a v0 dependency  
- Frozen CLI as the product identity  
- Process simulation (mold flow, FEA, CAM toolpaths)  
- Multiplayer collaboration  
- Certified manufacturing validation from mesh heuristics alone  

---

## Related docs

- [Document model](./document-model.md)  
- [Interface evolution](./interface-evolution.md)  
- [Geometry and validity](./geometry-and-validity.md)  
- [Roadmap](./roadmap.md)  
