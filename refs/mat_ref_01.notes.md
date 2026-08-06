# mat_ref_01 — look-dev notes

**Reference:** [`mat_ref_01.jpg`](./mat_ref_01.jpg)  
**Library id:** `mat_ref_01`  
**Code:** `MAT_CYAN_RESIN` + `MAT_AMBER_RESIN` + `LOOK_MAT_REF_01`

## Diff vs current display (geometry ignored)

| Axis | Before (plastic demo) | After (this entry) | Reference still |
|------|----------------------|--------------------|-----------------|
| Surface | Matte Lambertian plastic | Low-roughness glass shell | Optical glass / resin |
| Specular | Soft dim | Hot white key + fill | Sharp multi-highlight |
| Edges | None | Cyan Fresnel rim + edge sheen | Neon cyan edge light |
| Transmission | Opaque read | See-through body, dark studio shows through | Deep glass slab |
| Volume | Flat fill | Amber domain-warped swirl density | Molten swirl filaments |
| Lighting | Even gray studio | Dark void, cool fill, rim kicker | Dramatic product light |
| Backdrop | Flat `#1a1c1e` | Near-black `#03050a` | Soft vignette void |
| Grid | Dim construction | Slightly brighter center lines | Clean floor + spill |

## Lighting model (important)

**Real HDRI** — `public/env/studio_small_08_1k.hdr` (Poly Haven CC0 **Studio Small 08**).

- Basic photo studio: softboxes / octabox + infinity cove
- Loaded via `HDRLoader` → equirect sample in WGSL + `PMREMGenerator` for `scene.environment`
- **Z-up rotation:** `backgroundRotation` / `environmentRotation` = Rx(+90°); field shader `zUpToYUp` matches (HDR +Y ceiling → world +Z, right-side up)
- Background blurriness/intensity are look knobs; set `backgroundBlurriness: 0` to inspect orientation
- Key/fill DirectionalLights are probes extracted from the HDR

Do not reintroduce painted studio lights, analytic floor grids, or solid face paint.

## Transparency model

Field solid is an AABB proxy with **real alpha blending**.

- Residual `T` → mesh opacity; scene `GridHelper` draws first and is visible through the glass
- Color = glass emit (specular + rim + volume + tinted HDR thru)

## Remaining gaps (interactive path)

- Cube less “deep sapphire” and less neon edge light than the offline ref
- No caustics / multi-bounce refraction / floor contact shadow
- Swirl is procedural density, not authored internal geometry
- Soft-union fillet smoother than ref neck; proportions differ
- 1k HDR + bilinear `textureLoad` soft-box reflections less sharp than path-traced ref
- Scalar alpha approximates RGB beer-law

## Capture

```bash
npm run dev
LOOKDEV_HIDE_UI=1 npm run lookdev:capture -- tmp/lookdev/mat_ref_01-after.png
```
