# Material reference library

Still images and look-dev notes for tuning **field materials** and **scene looks** in three-cad. Geometry in reference art is illustrative only — match materials, lighting, and volume read, not solid shape.

## Catalog

| Id | Reference | Materials | Scene look | Notes |
|----|-----------|-----------|------------|-------|
| `mat_ref_01` | [`mat_ref_01.jpg`](./mat_ref_01.jpg) | cyan glass + amber glass | `LOOK_MAT_REF_01` | Neon Fresnel edges, molten volume swirl, dark studio |

Code registry: [`src/render/library.ts`](../src/render/library.ts)  
Material params: [`src/render/materials.ts`](../src/render/materials.ts)  
Scene looks: [`src/render/looks.ts`](../src/render/looks.ts)

## Look-dev workflow

Use this loop for every new reference still. Goal: a named library entry that reproduces the **material and lighting language** of the image under interactive WebGPU constraints.

### 1. Ingest

```bash
# Copy the still into refs/ with a stable id
cp ~/Downloads/some-hero.jpg refs/mat_ref_NN.jpg
```

### 2. Baseline screenshot (before)

```bash
npm run dev
# other terminal:
npm run lookdev:capture -- tmp/lookdev/mat_ref_NN-before.png
```

Open the ref and the before shot side by side. Ignore geometry (fillets, proportions, internal swirl as real geo). Note differences in:

| Axis | What to look for |
|------|------------------|
| Surface | Matte plastic vs glass / metal / rubber |
| Specular | Soft blob vs sharp hot highlight |
| Fresnel / edges | Missing rim vs neon edge glow |
| Transmission | Opaque body vs see-through with colored depth |
| Volume | Flat fill vs dense / swirling interior |
| Lighting | Flat ambient vs key + cool fill + rim |
| Backdrop | Flat gray vs near-black vignette studio |
| Grid / floor | Dim construction grid vs clean floor with spill |

### 3. Derive preset

1. Add or retune `FieldMaterial` entries in `src/render/materials.ts`
   - `roughness`, `transmission`, `ior`, `sigmaA` / `sigmaS`
   - `rimBoost`, `specularBoost`, `swirl` for glass look-dev
2. Add a `SceneLook` in `src/render/looks.ts`
   - `background`, key / fill / rim lights, grid colors, `maxPixelRatio`, step budget
3. Register a `MaterialLookEntry` in `src/render/library.ts` pointing at the ref path
4. Point the demo (or a future part material binding) at that entry

### 4. After screenshot + iterate

```bash
npm run lookdev:capture -- tmp/lookdev/mat_ref_NN-after.png
```

Compare after vs ref. Adjust one axis at a time (e.g. rim first, then volume density, then key intensity). Keep FPS ≥20 on a typical laptop GPU — raise `maxSteps` / `maxPixelRatio` only while headroom remains.

### 5. Document

Add a row to the catalog table above. Optional: short `refs/mat_ref_NN.notes.md` with the before/after bullets and final param snapshot.

### 6. Land via PR

Branch `feat/<issue>-mat-ref-NN-lookdev`, commit refs + presets + capture script usage notes. Do not commit large binaries outside `refs/` stills.

## Capture script

```bash
# Full UI
npm run lookdev:capture -- tmp/lookdev/shot.png

# Custom URL (dev server port may vary)
npm run lookdev:capture -- tmp/lookdev/shot.png http://127.0.0.1:5173/three-cad/

# Hide chrome rails for clean look-dev frames
LOOKDEV_HIDE_UI=1 npm run lookdev:capture -- tmp/lookdev/clean.png
```

Requires Playwright Chromium (`npx playwright install chromium` once).

## Constraints

- Field sphere-trace remains the display authority; no mesh path for look-dev.
- No nested light rays / full path tracing in the interactive path.
- Swirl is **procedural density** in the volume integrator, not authored geometry.
- Floor reflections and true caustics are out of scope for interactive mode.
