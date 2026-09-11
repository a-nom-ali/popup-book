# Prototype verification

Verified locally on Windows on 12 September 2026.

## Automated checks

`npm test`: 49 passing tests in six suites. `npm run build`: TypeScript and Vite production build pass.

- Analytical tent and V-fold fixtures, including an asymmetric V-fold fixture and singular endpoints.
- 181-angle forward and reverse seeks, rigid edge lengths and matching hinges within 0.01 mm, and three generations of nested folds.
- All three example spreads pass the sampled checks, including glue-tab surfaces and independently sampled slider travel.
- Invalid dimensions, missing hosts, attachment cycles, damaged creases, overlapping cutouts, slider overtravel, damaged guide engagement and end stops, true intersections, shared-edge contacts, and separated surfaces.
- Outline subdivision preserves required tabs and their matching glue regions. Rigid decoration parents resolve independently of document array order.
- IndexedDB and ZIP round-trips, project schema/version rejection, asset preservation, undo/redo, duplicated attachments, and portable-file capacity policy.
- SVG/PDF physical units, A4/Letter dimensions, complete joining tabs, matching registration coordinates across oversized tiles, and exclusion of digital objects from fabrication.
- Posed GLB reimports at 0°, 90°, and 180° match paper transforms and metre scale. Baked animation matches the solver at its midpoint.
- Imported clip endpoints and reverse scrubbing, and distinct animation targets whose original names sanitize to the same string.
- Alpha tracing: transparent margins, holes, disconnected and diagonally touching regions, empty masks, simplification, original-image registration, and retracing groups without duplicate islands.
- Version 1 migration preserves appearance; version 2 silhouettes, source assets, image registration, glue patches and rotations survive IndexedDB/ZIP round-trips. Shared scenery insertion commands and proportional transforms have atomic undo/redo coverage.
- All four starter assemblies and the illustrated example at two page heights pass 181-angle sweeps. Scenery inherits rigid parent motion and retains physical scale. These are geometric checks, not printed assembly tests.
- Cut-out glue uses material intersections including holes; invalid and narrow patches are diagnosed. Display-only offsets are removed from collision poses. Intentional coplanar bonds and glue tabs on a common recipient are allowed only with valid declared contacts; unrelated and tilted parts still collide.
- Illustrated SVG/PDF fixtures preserve holes, vector cut lines, matching part numbers, image registration and mirrored reverse-side glue insets. Cut-out GLB geometry and baked poses reimport correctly; front-face material winding is checked on either side of a panel.

## Browser checks

Exercised in the available Codex Chromium browser surface, with the local Vite server. Desktop layout and a 390 × 844 viewport were checked.

- Parameter edits, vertex insertion, pointer-driven reshaping, drawing a rigid paper decoration, and cutting a hole in it.
- Child mechanism attachment, invalid-pose messages, geometry checks, undo/redo, and stale-result messaging after edits.
- PNG artwork import and animated GLB import. A textured spread with a digital animation completed its baked GLB export without a runtime error.
- Single-tab autosave reload restored the imported model and its opening-angle playback mode.
- Project-file import, spread navigation, reader mode, and reader pull-tab controls.
- Book and properties drawers remain reachable at narrow width; temporary viewport overrides were reset.
- Feature-detected WebMCP opening controls updated the visible editor.
- Transparent tower PNG import displayed one piece and one cut hole; castle retracing displayed its three windows. Detail changes, apply, and undo were exercised.
- Direct cut-out dragging, rotation and proportional resize handles updated the document, and single-step undo restored the original values. Reattachment, hand-drawn/moved glue patches, new cut holes, vertex reshaping, duplication, and both library insertion paths worked. Starter insertion was also exercised from the narrow-screen drawer.
- A confirmed local save restored the illustrated example and embedded artwork after reload. Browser-agent scenery insertion invoked the shared command successfully.
- The illustrated example completed its 181-angle browser check with zero issues. Its textured animated GLB exported and reimported with an `Open book` clip. The actual GLB contains three embedded images/textures, three front-only printed materials, 138 animation channels and no external resources. No browser errors were reported.

The generated PDFs were rendered with Poppler and visually inspected for legible labels, glue regions, image placement, line types, and tile alignment. A5 page patterns fit on both supported sheet sizes without shrinking. Export and storage test files are generated in the ignored `test-results/` directory.

## Remaining verification limits

- Chrome and Edge were not available as connected browser surfaces, so browser-specific acceptance checks remain unverified.
- No preset has been printed and physically assembled. Rigid zero-thickness geometry does not model material stiffness, friction, thickness, binding, or glue tolerances.
- Intersection testing samples integer opening angles. Each slider is tested at 0%, 50%, and 100%, with other sliders retracted; independent slider combinations and continuous collision freedom are not certified. Guide engagement is also checked against swept material regions.
- WebGL initialization and context-loss messages are implemented; forced graphics failure was not exercised in the browser.
- Keep one editor tab open per browser. Simultaneous tabs share the same local autosave and do not synchronize changes.
- SVG is a full-scale vector artboard. PDF supplies A4/Letter sheet layout and tiling. Live AR and arbitrary linkage loops remain outside this version.
