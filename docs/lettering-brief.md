# Embroidery lettering brief — what we've tried, what I want

## Setup

I generate small embroidered "run badges" (~70–75mm square patches) on a **Brother SE700**
(4×4" hoop, no within-color jump trims — we insert same-color stops so it pauses+cuts).
Dark knit shorts fabric, **40wt polyester thread**, cream on navy. A custom TypeScript
pipeline writes the PES file directly (validated byte-identical against pyembroidery) —
no Ink/Stitch or PE-Design in the loop, fully automated per run.

Badge layout: GPS route as a 2–3mm satin ribbon (works great), corner brackets (great),
and **two text lines that keep disappointing me**:

- distance line, cap height ≈ **6.3mm** (e.g. "10.09 MI")
- date line, cap height ≈ **4.7mm** (e.g. "2026.07.21")

## What we tried (in order) and how it failed

1. **Hand-drawn single-stroke font, running/bean stitch** — legible but thin + scratchy, DIY look.
2. **Algorithmic zigzag satin over stroke skeletons** — shredded small letterforms (spikes on bowls/corners).
3. **Ink/Stitch "Glacial Tiny 60 AGS"** (digitized tiny satin font, 2.8–8.4mm, spec says 60wt
   thread mandatory) with naive rail pairing — read as too thick/blobby; diagonals striped
   because we ignored the rungs (pairing synchronization).
4. **Same font's centerlines as a thin single running line** — clean but wobbly, looked like
   handwriting skeletons, not type.
5. **Arimo Bold (Arial clone) true TTF outlines, stitched as closed contour running lines** —
   real typography and spacing, but reads as outlined/hollow type, not embroidery lettering.
6. **Ink/Stitch "Excalibur small"** (KOR-lineage satin font, 4.5–9mm) with proper
   rung-synchronized rail pairing — technically correct satin now, but still not the clean
   result I want at these sizes.

## Known gaps in our satin rendering (suspects)

- **No underlay**: the fonts specify center-walk underlay; we skip it entirely.
- **No pull compensation** (fonts specify ~0.02mm plus fabric-dependent needs on knit).
- Density fixed at ~0.38mm per-rail spacing for 40wt (fonts were digitized at 0.25mm for 60wt).
- Tiny satin fonts we used are all specced for **60wt thread + 75/11 or smaller needle**; I sew 40wt.

## What I'm actually looking for

Classic, clean **machine-embroidery satin lettering** — the look of Brother's built-in fonts
or a pro shop's small block lettering — at **4.5–7mm cap height**, in 40wt (or tell me 60wt is
simply non-negotiable at this size), on stretchy knit with stabilizer, produced
**programmatically** (my pipeline can consume: satin rail pairs + rungs in Ink/Stitch font
format, TTF outlines, or any polyline/stitch-coordinate format — and I can add underlay/pull
comp if told how to parameterize them).

Questions I want answered:
1. Is clean 4.5–5mm satin text realistic in 40wt at all, or is 60wt/bigger-letters the fork?
2. Which specific font (Ink/Stitch library, BX, ESA, or other open format) is the proven
   choice for 5–7mm block lettering?
3. What underlay + pull-comp + density settings would a digitizer use for this size on knit?
4. Is there a saner route I'm ignoring (e.g. machine built-in lettering combined at the
   machine, PE-Design Lite for text only, paid small-lettering BX fonts)?
