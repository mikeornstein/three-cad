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

## Remaining gaps (interactive path)

- Cube body still lighter / less “sapphire” than the ref (no nested refraction / env map).
- No true floor reflections or caustics (out of interactive budget).
- Swirl is procedural density, not authored internal geometry.
- Soft-union fillet is smoother than the ref’s neck blend.

## Capture

```bash
npm run dev
LOOKDEV_HIDE_UI=1 npm run lookdev:capture -- tmp/lookdev/mat_ref_01-after.png
```
