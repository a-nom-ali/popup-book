# Fold Studio

A local paper-engineering studio with linked 2D construction, live 3D folding, printable templates, and digital layers. Built with React, TypeScript, Vite, Three.js, and Zustand.

## Run locally

Requires Node.js 22.12+ (tested with 22.18). On Windows, run `./Start-Studio.ps1` from PowerShell. It uses the npm bundled with Node rather than a potentially stale global npm shim.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The app binds to this computer only. Fonts and the example artwork are bundled; editing and exporting make no external service requests. Keep the terminal running while using the studio.

```sh
npm test
npm run build
npm run preview
```

## Working in the studio

- Choose a spread or add, duplicate, and reorder spreads in **Your book**. Change book titles and page sizes in the properties panel.
- Click a paper part in 3D or the Structure tree. Adjust its dimensions, fold angles, attachment, color, or assembly side. **Build on this fold** mounts a child across the selected ridge.
- Switch to **2D pattern** or **Split**. Drag outline vertices; use **Vertex** to add one and double-click a vertex to remove it. **Draw paper part** creates a rigid decoration on the selected panel. **Draw cutout** removes a polygon from an editable part. Click **Finish** to close a drawing.
- Generated joining tabs appear in the 2D view and fabrication sheets. Add custom tabs by choosing an outline edge in the inspector. Custom shapes retain their geometry when supported dimensions change.
- Scrub **Book opening**, press Space to play/pause, or use **Read book** and previous/next controls. Pull tabs have independent travel sliders in their properties and in reader mode.
- Import PNG/JPEG artwork or an uncompressed, self-contained GLB onto the selected panel. Imported models fit to roughly 50 mm initially; adjust their transform and choose loop, click, or opening-angle playback. Standard GLB clips, including skeletal and morph animations, are supported by Three.js; custom material animation extensions and compressed assets requiring decoders are outside this prototype.
- Use **Check folding** to check all 181 integer opening angles. Each slider is also sampled at 0%, 50%, and 100%, with other sliders retracted; combinations of independently moving sliders are not exhaustively checked. Select a finding to highlight its parts and jump to its angle. Invalid work remains editable and savable. Geometry that cannot solve retains its last valid preview until repaired.
- On narrow screens, **Book and mechanisms** and **Properties** open side drawers. The 2D/3D split stacks vertically on phones.

### Files and recovery

The current project autosaves to IndexedDB on this browser and origin. Keep one editing tab open per browser; concurrent tabs do not synchronize edits. Save a portable **.popupbook** file for backup or transfer; clearing browser storage removes the local autosave. The ZIP contains `project.json` and embedded assets. Imports are schema-checked before replacing the open project. Missing assets remain recoverable and are reported by diagnostics. New asset imports have a 90 MB combined budget; project files are limited to 100 MB compressed and 250 MB expanded. Use **Remove unused assets** in book properties to recover space. No accounts or cloud storage are used.

Ctrl/Cmd+S downloads a project file. Ctrl/Cmd+Z undoes an edit, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes it, and Delete removes the selected mechanism or digital object. Removing a host leaves its dependents present for repair.

### Export

- **SVG:** one full-scale millimetre artboard with outlines, folds, tabs, matching glue footprints, labels, and assembly notes. Suitable for further preparation in vector/cutter software.
- **PDF:** A4 or US Letter, one piece per sheet, with overlapping tiles for oversized pieces. Print at **100% / actual size** and measure the 20 mm square. Matching overlap marks carry the same master coordinates on adjacent tiles. PDF linework stays vector; imported artwork remains raster.
- **GLB:** the current spread at its current pose, or a six-second opening animation. Geometry uses metres and glTF's Y-up orientation. The project file retains editing constraints and interactive rules; GLB carries baked motion.

## Geometry model and boundaries

The book opens from 0° closed to 180° open. V-folds are solved as spherical linkages; tents use circle-intersection closure. Each mechanism exposes an oriented ridge port. Children use the ridge's actual angle, rather than an independent book-angle animation. Symmetric exterior branches have explicit closed endpoints. Guided strips have widened stops, two guides, a window cover, and independent travel.

The six presets are V-fold, raised tent, nested bloom, tiered pavilion, layered scene, and pull-tab reveal. Compound presets expand to ordinary editable mechanisms. V-fold authoring currently uses symmetric base angles; the primitive solver also has tested asymmetric fixtures. Exterior branches require symmetric anchors.

Paper is a rigid, **zero-thickness** model. Diagnostics cover valid outlines, essential crease material, attachment and glue-footprint containment, closed-page bounds, travel, and sampled intersections. They do not prove continuous collision freedom or account for stiffness, friction, thickness, glue tolerances, or binding mechanics. Presets are **not physically tested** until printed and assembled. Auto tabs choose the recipient's material side; difficult custom joins may need manual adjustment and will be flagged. General linkage loops, arbitrary structural creases, curved paper simulation, and live AR are not implemented.

## Architecture

- `src/model.ts` defines the versioned document and import schema; `src/store.ts` owns editing commands and history. Selection, camera, playback and driver values are separate from the document.
- `src/engine/geometry.ts` provides `compileProject` and `evaluateSpread`; `fabrication.ts` derives joining tabs and matching footprints; `validation.ts` performs diagnostic checks. `media.ts` attaches images and models to solved panels.
- `src/components` contains the studio surfaces. `src/io` handles portable files, IndexedDB, vector fabrication outputs, and GLB baking. Renderers consume the same geometry and attachment frames, which are reusable by a future AR adapter.
- Feature-detected WebMCP tools expose `inspect_book`, `add_mechanisms`, and `set_book_drivers`. They invoke the same state and commands as the visible editor; browsers without that proposed API work normally.

`npm test` checks analytic fixtures, full-angle forward/reverse sweeps, rigid edges and joints, nested branches, malformed documents and geometry, storage/history round-trips, tiled PDF scale, and exported GLB poses/animation. Test output files go to the ignored `test-results/` directory. Browser UI and visual PDF checks complement the automated tests.

Geometry references: [Kinematic Representations of Pop-Up Paper Mechanisms](https://fab.cba.mit.edu/classes/865.18/discrete/folding/KinematicPaperMechanisms.pdf), [Georgia Tech's Physics of Paper Engineering](https://paper.gatech.edu/kinetic-joy/physics-paper-engineering).
