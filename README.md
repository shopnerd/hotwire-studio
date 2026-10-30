# Hotwire Studio

Browser app that makes G-code for a 4-axis CNC hot-wire foam cutter (two towers: X/Y left, A/Z right, GRBL Hotwire firmware). It replaces the DevFoam Pro 3 step in the shop workflow.

**Live:** https://shopnerd.github.io/hotwire-studio/

## What it does
- Profiles from a **DXF** (OnShape face export, R11/12, mm), an airfoil **.dat** (Selig or Lednicer), or a built-in **NACA 4-digit** generator.
- Different left and right faces for tapered parts: chord, rotation (washout), and a typed **dX / dY offset** between the faces. You don't need to measure in CAD and re-enter values in DevFoam.
- Point-for-point sync of the two faces (start point, leading edge, matched corners), kerf compensation per face with round outside corners, and projection of each face out to its tower.
- G-code in the same form DevFoam writes: `G21 G17 G90`, `F…`, `M3`, `G0` to the start point, **`G93` inverse-time feed** timed so the faster tower moves at the set speed, `M5`.
- Side view, 3D view and a play-through of the cut. **Preview .nc** loads any existing program (including DevFoam's), which replaces the GRBL Hotwire preview.

## Checked against DevFoam
`docs/samples/payload-foam-floor` has a real DevFoam Pro 3 job (DXF, .dc1 and the G-code it wrote). `node test/run.js` rebuilds it:
every DevFoam point lies within 0.02 mm of our path, the cut time matches to 0.001 min, and the header lines are identical.
Inside corners differ by up to 0.36 mm, because DevFoam chamfers them with its 1 mm steps while this app follows the exact kerf offset.

## Not checked yet
- A **tapered** DevFoam sample. The G93 timing for tapers (faster tower at set speed) is a reasoned choice, not yet matched to DevFoam.
- Machine travel limits (enter them under Machine to get warnings).
- Turntable (5th axis, B) cut modes. They're planned, not built.

## Run locally
No build step. Serve the folder (`npx http-server -p 8765`) and open `index.html`. Tests: `node test/run.js`.
