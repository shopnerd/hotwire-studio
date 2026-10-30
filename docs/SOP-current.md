# Hotwire CNC SOP (current workflow, as of 2026-09-14)

> Update 2026-10-30, from a real DevFoam cut (`docs/samples/payload-foam-floor`): DevFoam writes **G93 inverse-time feed**
> (each F = 1 / minutes for that move); cut speed was **200 mm/min**; kerf compensation was **1.5 mm per side**.
> That settles the speed and kerf questions below.

Source of truth for how the shop cuts today. The web app replaces the DevFoam step (and the buggy preview in GRBL Hotwire); the machine side stays.

## Current toolchain
OnShape face -> DXF (R11/12, mm) -> DevFoam Pro 3 (drawing .dc1 -> tapered part -> cut) -> 4-axis G-code (.nc/.gcode) -> GRBL Hotwire controller (laptop, USB COM port) -> machine

## Machine facts
- Axes: Left carriage X (horizontal), Y (vertical); Right carriage A (horizontal), Z (vertical)
- Motion lines: `G1 X.. Y.. A.. Z.. F..` (feed in mm/min)
- Carriage width (wire length between towers): 882.65 mm
- Cutting speed: listed as "300 mm / s" (UNCONFIRMED - example shows F200 mm/min; likely 300 mm/min)
- Wire: 0.4 mm
- Kerf: 0.7 mm (UNCONFIRMED - test-cut section says ~1/16 in each side of the wire)
- Wire heat: manual current knob on bench power supply, not G-code controlled
- Homing cycle, then jog wire to front edge of vacuum table, square wire to table, zero both axes there

## Hardware as seen in photos (docs/photos, 2026-09-14; identification by eye, unconfirmed)
- Two independent towers: horizontal axis = lead screw + 2 smooth rods on plywood base, drag chain; vertical axis = aluminum extrusion + lead screw; wire clipped between tower tops with alligator clips
- Microswitch limit/homing switches on the axes
- Controller: looks like Arduino Mega + RAMPS 1.4 with plug-in stepper drivers (5 driver slots) -> consistent with the "Grbl Hotwire Mega 5X" firmware, which supports a 5th axis
- Wire power: Kungber bench DC supply (CV/CC, coarse/fine V and A knobs), manual only
- Wiring loose around the drivers; banana plug held with blue tape

## Turntable (5th axis) - ADDED TO PLAN 2026-09-14
Planned as axis B (degrees) on the 5th driver slot, if the firmware build supports it (check `$I` / `$$`).
Two cut modes:
1. Silhouette cuts: rotate B to an angle, wire cuts the part's outline straight through, repeat at the next angle. Good for asymmetric shapes and squaring blocks.
2. Lathe cuts: table spins while the wire moves up/down and in/out, carving a round shape (nose cones, round bodies). Wire's distance from the spin axis = radius.
Needs: turntable center found in machine coordinates (calibration step), angle-zero homing switch, gear reduction so wire drag can't turn the table, block secured and centered.

## DXF export (OnShape)
Hide other parts -> select face -> N (view normal) -> export as drawing, DXF R11-12, mm. Leading edge on the LEFT.

## DevFoam steps
1. New drawing part, File -> Import polylines (one DXF per drawing), delete extras, check units, save .dc1
2. New tapered part (even if not tapered): pick left + right face (same file if symmetric)
3. Offsets for taper/twist: measure dX/dY between a reference point on each profile in CAD, apply with DevFoam offset tool
4. Set part width, save tapered file
5. Cut from archived parts -> select tapered part -> G-code

## Offsets table example (HPFRT 2026 cut)
| Part | Offset X | Offset Z | Width (mm) | Ref point |
|---|---|---|---|---|
| S1 LE IB | 5.643 | 4.118 | 685.8 | LE-LL |
| S1 LE OB | 5.646 | 4.120 | 685.8 | LE-LL |
| S1 TE IB | 19.546 | 6.584 | 685.8 | TE-LL |
| S1 TE OB | 19.546 | 6.832 | 685.8 | TE-LL |
LE-LL = leading edge lower left, TE-LL = trailing edge lower left. (Stray value 76.2 mm = 3 in, likely the length oversize.)

Parts list template: Inboard Wing, Fuselage, Aileron, Flap, End Caps, Winglets (width mm, length mm, height in, qty).

## Foam block sizing rules
- Height: as bought (>2 in), excess OK
- Width (span between the two profile faces): part width + ~1 in each side
- Length (chordwise): longest chord + ~3 in front and back
- Mark half-width on front face, align to table center mark (centering matters for tapered cuts)
- Square block to front edge of vacuum table; square blocks first with a hanging vertical cut

## Running a cut (operator)
Outdoors only. Clear rails, table squared + planked, wire tensioned. Power off/wire cold, release e-stop, machine on. Vacuum on a separate stool, hose connected, off. Launch GRBL Hotwire, USB, COM port, connect. Jog forward+down, home, zero. Test cuts to set current (no wire lag, ~1/16 in kerf each side; lower heat when exiting cutouts or re-tracing). Dry run with no foam, wire off. Load G-code (preview is buggy/doesn't scale). Send setup lines with "Send line", move to start, jog to highest/farthest-back point to confirm fit. Vacuum on, power supply on, Start. Never unattended. Wire off on exit. Check accuracy against a paper print of the DXF. Shutdown: PSU + vacuum off, return to zero, disconnect, e-stop, unplug, roll inside.

## Future: turntable (5th axis)
Silhouettes at evenly spaced angles, wire cuts each silhouette, table rotates between. Simple use: squaring blocks. Needs turntable centered on the axis, block centered on turntable, block position known at G-code generation, block secured. Ref: hotwiresystems.com turn-table page.
