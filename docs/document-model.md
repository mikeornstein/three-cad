# Document model

The **assembly document** is the durable source of truth for design intent. Geometry, meshes, and viewport state are derived from it.

Goals for the model:

- **Idempotent** — same document + same generator versions → same geometry  
- **Shareable** — plain, versionable text (JSON or equivalent)  
- **Transportable** — small docs travel alone; large assets are content-addressed  
- **Isolatable** — parts and instances addressable for inspect, check, and export  
- **Evolvable** — `schemaVersion` and part **kinds** grow without breaking the core  

This document describes the *conceptual* model. Concrete JSON schema lands with implementation.

---

## Top-level shape

```text
AssemblyDocument
├── schemaVersion: number
├── units: "mm"                    // internal units always mm
├── meta: { name?, created?, … }
├── parts: Map<PartId, PartDef>
├── instances: Instance[]
├── assets: Map<AssetId, AssetRef>
├── checkPolicy: CheckPolicy
└── (optional) history: DocumentOp[]   // replay / audit; may be derived
```

### Units

- **Internal unit is millimeters** for all dimensions, tolerances, and check thresholds.  
- Display units (inch, etc.) are a presentation concern only.  
- Generators and imports must normalize into mm.

### Identifiers

- `PartId`, `InstanceId`, `AssetId`, feature ids: stable strings within a document.  
- Prefer human-readable ids when created from language (`base_plate`, `motor_left`).  
- Content-addressed assets use hashes (`sha256:…`) so the same binary is shared and cacheable.

---

## Parts

A **part** is a reusable geometric definition. It is not yet placed in space.

```text
PartDef
├── id: PartId
├── kind: PartKind
├── generator?: { name, version }   // parametric rebuild path
├── params / features / meshRef     // kind-dependent payload
└── attributes?: { name, materialHint, notes, … }
```

### Part kinds

Kinds express **manufacturing-shaped intent**, not full process simulation. They guide generators, checks, and language understanding.

| Kind | Intent | Typical payload (conceptual) |
|------|--------|------------------------------|
| `generic` | Process-agnostic solid | Params + feature list / CSG tree |
| `machined` | Prismatic / milled / turned feel | Features: extrude, bore, pocket, fillet, chamfer, pattern |
| `sheet` | Formed sheet metal | Gauge, sketch/profile, bends, flanges, reliefs |
| `molded` | Injection-molded-like solid | Shells, ribs, bosses, fillets, outer skin |
| `am` | Additive / topology-optimized | Freeform mesh or procedural organic/lattice definition |
| `imported` | Vendor or external mesh | `meshRef` → asset; optional repair flags |

**Rules:**

- Kinds are first-class from day one of the schema, even if early generators only implement `generic` + `imported`.  
- A part has exactly one primary kind; mixed-process assemblies use multiple parts.  
- Smooth features (fillets, blends, freeform) live as **intent in the document**; the evaluator produces mesh approximations.

### Parametric vs imported

| Mode | Source of truth | Derived |
|------|-----------------|---------|
| Parametric | `generator` + params/features | Mesh on evaluate |
| Imported | Asset bytes (content hash) | Mesh load / optional repair |
| Hybrid later | Parametric base + imported insert | Both |

Never store *only* a triangle buffer as the definition of a parametric part. Cached meshes are allowed as **derived artifacts**, keyed by definition hash.

---

## Features (conceptual)

Features are structured edits that generators understand. Exact feature set grows per kind.

Examples:

- `box` / `cylinder` / `extrude`  
- `bore` / `hole` / `pocket`  
- `fillet` / `chamfer` / `blend` (mesh approx)  
- `patternLinear` / `patternCircular`  
- `boolean` (union / difference / intersection)  
- sheet: `bend`, `flange`  
- molded: `rib`, `boss`  

Features should be **addressable** (ids) so language and selection can say “change *that* fillet to 3 mm” without rewriting the whole part.

---

## Instances

An **instance** places a part in the assembly.

```text
Instance
├── id: InstanceId
├── part: PartId
├── transform: translation + rotation (+ scale only if explicitly allowed)
├── parent?: InstanceId          // hierarchy / subassembly
└── visible?: boolean
```

- Multiple instances may reference one part (shared definition).  
- Transforms use a documented convention: **right-handed, Z-up**, millimeters (picked with the first viewport scaffold; stick to it).  
- Subassemblies are trees of instances (`parent`), not a separate document type in v0 (nested documents may come later).

### Isolation

Any part or instance can be:

- Shown alone in the viewport  
- Checked alone  
- Exported alone  

Isolation does not require a different document type; it is a view/export scope over the same model.

---

## Assets

```text
AssetRef
├── id / contentHash
├── format: "stl" | "obj" | "gltf" | "glb" | …
├── byteLength?
└── sourceHint?   // original filename or URL; not required for rebuild
```

- Binaries live beside the document (package directory) or in a content store.  
- The document stores **hashes and metadata**, not necessarily inline base64 for large files.  
- Rebuild requires document + asset payload for every referenced hash.

---

## Check policy

```text
CheckPolicy
├── minThicknessMm?: number
├── interference: boolean | { ignorePairs?: [InstanceId, InstanceId][] }
├── surfaceQuality?: { maxAspectRatio?, … }
└── kindOverrides?: partial policies per PartKind
```

Policy is document-level defaults. Individual check commands may override thresholds without mutating the document unless the user asks to “set policy”.

See [geometry-and-validity.md](./geometry-and-validity.md).

---

## Document operations

Mutations are ideally expressed as **DocumentOps**: small, named, serializable commands applied to the document.

Examples (illustrative names):

- `part.upsert` / `part.remove`  
- `part.addFeature` / `part.updateFeature` / `part.removeFeature`  
- `instance.add` / `instance.transform` / `instance.remove`  
- `asset.link`  
- `checkPolicy.set`  

**Why ops matter:**

- Plain language compiles to ops (not to ad-hoc JSON patches).  
- Agents and UIs share one mutation vocabulary.  
- Optional history enables replay, undo, and audit.  
- Idempotent rebuild still depends on the **resulting document**, not on how many times an op was typed.

The interpreter commits ops; it does not hand-edit mesh buffers.

---

## Derived artifacts (not source of truth)

| Artifact | Role |
|----------|------|
| Evaluated mesh per part | Display, export, checks |
| Assembly scene graph | Viewport |
| Validity reports | UX + automation |
| Content-hash caches | Performance |

Safe to delete and regenerate. Packages may optionally include caches for faster load; missing caches must not change meaning.

---

## Idempotency and versioning

### Rebuild identity

```text
mesh(part) = evaluate(
  part.kind,
  part.generator.name,
  part.generator.version,
  part.payload,
  assets
)
```

Changing generator **version** may change mesh output; document should record versions used so results are reproducible.

### Schema evolution

- `schemaVersion` increments when the document shape changes.  
- Readers must migrate or reject unknown versions explicitly.  
- Additive fields preferred over silent meaning changes.

### Sharing

| Package | Contents |
|---------|----------|
| Document only | Works if no external assets |
| Full package | Document + asset blobs by hash |
| URL / gist later | Compressed document (+ asset refs) |

---

## Export scopes

| Scope | What is written |
|-------|-----------------|
| Part | Mesh for one `PartDef` |
| Instance | Mesh of that part at identity (or baked transform—document the choice) |
| Assembly | Combined mesh and/or multi-node glTF with instance structure |

Prefer formats that preserve **instance structure** when possible (glTF nodes); STL may be a single baked mesh with clear naming conventions.

---

## What the model deliberately avoids (v0)

- Feature history trees identical to commercial CAD kernels  
- Constraint/mate solvers as required document content (transforms are explicit first)  
- Materials as FEA definitions  
- Drawing / PMI sheets  

Mates and richer assembly constraints can appear later as optional layers on instances without discarding the transform-based baseline.

---

## Related docs

- [Architecture](./architecture.md)  
- [Interface evolution](./interface-evolution.md)  
- [Geometry and validity](./geometry-and-validity.md)  
- [Roadmap](./roadmap.md)  
