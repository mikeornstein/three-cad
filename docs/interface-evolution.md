# Interface evolution

The product interface will **intentionally evolve**. Users speak plain language; that input is interpreted into document operations—and sometimes into **new or temporary UI** that makes a spatial or multi-parameter edit tractable.

This doc defines how language, interpreter, durable ops, and ephemeral UI fit together without freezing a CLI forever or turning the viewport into a CAD sketcher.

---

## Problem

Spatial mechanical design is hard to express in a single fixed command grammar:

- “Fillet the top edges of the bracket 2 mm” needs edge identity  
- “Make that wall thicker” needs a face and a thickness  
- “Align the motor to the plate holes” needs references and maybe a temporary measure  

A rigid CLI either becomes unusable or grows into a second programming language. A pure GUI becomes the traditional CAD we are not building.

**Approach:** durable **ops + document** stay stable; **intent channels and UI capabilities** churn.

---

## Roles

| Piece | Owns | Does not own |
|-------|------|--------------|
| **Intent channel** | User utterances / structured commands | Geometry truth |
| **Interpreter** | Mapping intent → ops, UIRequests, questions | Mesh buffers |
| **Document + ops** | Design meaning | Presentation |
| **Interface host** | Text box, widgets, viewport chrome | Long-term design state |
| **Viewport** | Inspect, measure, select, highlight | Freehand modeling as primary path |
| **Selection context** | What is currently “that” / `$selection` | Permanent feature definition until committed |

---

## Intent channel

### Plain language (default human path)

Examples:

- “Add a 100 by 80 by 4 mm base plate”  
- “Put the motor STL on the plate at the center”  
- “Check interference”  
- “Round the top edges of the bracket by 2 mm”  
- “Isolate the bracket and export STL”  

Ambiguity is normal. The interpreter may ask questions or open UI rather than guess destructively.

### Structured commands (durable intermediate)

A stable, scriptable op vocabulary (and optional human-typed commands that map 1:1 to ops) exists for:

- Agents and automation  
- Replay and tests  
- Power users  
- Debugging what NL compiled to  

**Principle:** plain language compiles **into** structured ops. Structured ops are not optional internal detail—they are the contract.

### Future channels

Files, voice, or chat side-panels should enter the same interpreter pipeline. Do not fork parallel mutation paths per channel.

---

## Interpreter contract

Given:

- User intent (text / structured)  
- Current document  
- Selection context  
- Available UI capabilities  

Produce one or more of:

1. **DocumentOps** — commit mutations  
2. **UIRequests** — open host capabilities to gather missing structure  
3. **Questions** — textual clarifications  
4. **Read-only actions** — check, measure, export, isolate (may not mutate document)

```text
Intent
  → Interpreter
      → [DocumentOp, …]
      → [UIRequest, …]
      → [Question, …]
      → [ViewCommand, …]   // isolate, highlight, focus
```

The interpreter may be rules-based at first and LLM-assisted later. Swapping interpretation strategy must not change the DocumentOp vocabulary without a versioned migration.

---

## UIRequest and the capability registry

When text cannot safely complete an edit, the interpreter emits a **UIRequest** naming a **registered capability**.

### Why a registry

- New edit patterns appear over time  
- Hosts (web, terminal+browser, future) implement what they can  
- Unknown capabilities fail gracefully (“this host cannot pick edges yet”)  
- Avoids one-off UI hardwired into random commands  

### Capability examples (illustrative)

| Capability id | Purpose | Returns |
|---------------|---------|---------|
| `pick.part` | Choose instance/part | ids |
| `pick.face` | Choose face/region on a part | feature or region ref |
| `pick.edge` | Choose edges for fillet/chamfer | edge refs |
| `pick.point` | Point on geometry or grid | coordinates mm |
| `form.params` | Parameter sheet for a known schema | param values |
| `form.thickness` | Single thickness / offset | number mm |
| `measure.distance` | Interactive measure | value + refs |
| `view.section` | Section plane for inspection | plane |

Capabilities are **ephemeral**: they resolve data that is then folded into a DocumentOp or a one-shot read action. Closing a widget without commit does not change the document.

### Example flow

1. User: “Round over the top edges of the bracket by 2 mm.”  
2. Interpreter identifies part `bracket`, op kind `fillet`, radius `2`, but not edge set.  
3. Emits `UIRequest: pick.edge { part: bracket, hint: "top", multi: true }`.  
4. Host opens edge picker; user confirms (or accepts auto-proposal).  
5. Interpreter commits `part.addFeature { fillet, edges, r: 2 }`.  
6. Evaluator rebuilds; validity runs; viewport updates.

---

## Selection context

The viewport (and other UI) maintains a **selection context** available to the interpreter:

```text
SelectionContext
├── instances[]
├── parts[]
├── features[] / regions[]
├── measureScratch?
└── lastExportScope?
```

Language can refer to:

- Explicit ids: `bracket`, `i_motor`  
- Deictic references: “that”, “the selected face”, “these edges”  
- Bound tokens after pick: `$selection`, `$edges`  

Selection is **not** design state until an op commits it into the document (e.g. as a feature’s target refs).

---

## Viewport responsibilities

In scope:

- Orbit / pan / zoom with true mm scale cues  
- Isolate / hide / explode  
- Measure (with results readable in text channel too)  
- Pick for selection context  
- Highlight validity hotspots and interpreter focus  

Out of scope as primary modeling:

- Sketching profiles with constraint solvers  
- Drag-to-extrude as the main authoring path  
- Gizmo-first assembly design (transforms may still be editable via language or rare utility UI)

Temporary gizmos are allowed when a UIRequest needs them (e.g. nudge an instance after “move it up a bit”), but the committed result is still a DocumentOp.

---

## Host shapes

The architecture does not mandate a single shell. Reference direction:

| Host | Fit |
|------|-----|
| **Web app** with prominent text channel + viewport | Default reference; easiest unified selection + widgets |
| Terminal REPL + browser viewport | Power-user / agent-adjacent |
| Headless evaluate + export | CI, batch, agents |

All hosts should speak **DocumentOps + UIRequests** (headless hosts error or no-op on UIRequests that require interaction).

---

## Evolution rules

1. **Add capabilities** without changing document meaning.  
2. **Version DocumentOps** when semantics change; migrate documents.  
3. **Prefer compiling NL → ops** over executing side effects only the LLM knows about.  
4. **Log interpreted ops** (even if history is optional in the file) for debugging “what did the system think I meant?”  
5. **Do not** grow a second permanent GUI modeler that bypasses the document.  
6. When a new part kind needs new edit UX (bend table, lattice density), add **capabilities + features**, not a separate app mode with private state.

---

## Agent and automation

Agents are first-class consumers of the structured layer:

- Propose DocumentOps  
- Request checks and read reports  
- Ask for UIRequests only when a human must resolve spatial ambiguity  
- Prefer deterministic scripts for regressions  

Plain language is for humans; agents should prefer ops, with NL as a convenience wrapper.

---

## Non-goals for the interface layer

- Pixel-perfect clone of commercial CAD UI  
- Single eternal command grammar  
- Fully automatic resolution of all spatial ambiguity without selection  
- Multiplayer cursor presence (later, if ever)  

---

## Related docs

- [Architecture](./architecture.md)  
- [Document model](./document-model.md)  
- [Geometry and validity](./geometry-and-validity.md)  
- [Roadmap](./roadmap.md)  
