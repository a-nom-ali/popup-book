# Original paper scenery

These four illustrations were created for this project. The SVG files are the editable vector
sources; PNGs preserve the transparent outer silhouette and actual window openings. `library.json`
contains the same millimetre contours, original image bounds and a proposed rigid glue patch.

The cut-outs are paper prototypes, not physically tested or certified designs. Their starter
assemblies are covered by geometric opening and fabrication checks in `src/scenery.test.ts`.

Regenerate the PNGs and bundled data with a local Sharp installation:

```sh
node src/assets/scenery/generate.cjs /absolute/path/to/sharp
```

The generator uses only the original SVG geometry in this directory and no external assets.
