import {
  PDFDocument,
  StandardFonts,
  PrintScaling,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  closePath,
  clipEvenOdd,
  endPath,
} from 'pdf-lib';
import type { PDFPage, PDFImage } from 'pdf-lib';
import type { Diagnostic, Vec2 } from '../model';
import { evaluateSpread, polygonBounds } from '../engine/geometry';
import type { CompiledSpread } from '../engine/geometry';
import { templateParts } from '../engine/fabrication';
import type { TemplatePart } from '../engine/fabrication';
import { svgPath } from '../engine/polygon';
import { bytesFromData } from './projects';

export const MM = 72 / 25.4;
export const PAPER = { A4: [210, 297], Letter: [215.9, 279.4] } as const;
const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const printable = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '-');
function layout(entry: TemplatePart) {
  const b = polygonBounds(entry.outline),
    paperWidth = b.maxX - b.minX + 10,
    paperHeight = b.maxY - b.minY + 10,
    scale = Math.min(1, 90 / Math.max(1, b.maxX - b.minX), 60 / Math.max(1, b.maxY - b.minY)),
    inset = entry.reverseGlue.length
      ? { x: 5, y: paperHeight + 13, scale, b, height: (b.maxY - b.minY) * scale }
      : undefined;
  return {
    x: 5 - b.minX,
    y: 5 - b.minY,
    width: inset ? Math.max(120, paperWidth) : paperWidth,
    height: inset ? inset.y + inset.height + 7 : paperHeight,
    inset,
  };
}
const regionPath = (points: Vec2[], holes: Vec2[][] = []) =>
  [svgPath(points), ...holes.map(svgPath)].join(' ');
function labelPosition(points: Vec2[]): Vec2 {
  const b = polygonBounds(points);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}
type GlueLabel = { x: number; y: number; width: number; height: number };
function glueLabelPosition(points: Vec2[], width: number, height: number, used: GlueLabel[]): Vec2 {
  const [x, centerY] = labelPosition(points);
  let y = centerY;
  for (let tries = 0; tries < 30; tries++) {
    if (
      !used.some(
        (label) =>
          Math.abs(label.x - x) < (label.width + width) / 2 + 0.6 &&
          Math.abs(label.y - y) < (label.height + height) / 2 + 0.6,
      )
    )
      break;
    y += height + 1;
  }
  used.push({ x, y, width, height });
  return [x, y];
}
export function tileLayout(width: number, height: number, paper: 'A4' | 'Letter') {
  const [pw, ph] = PAPER[paper],
    cw = pw - 20,
    ch = ph - 56,
    overlap = 5;
  const cols = Math.max(1, Math.ceil((width - overlap) / (cw - overlap))),
    rows = Math.max(1, Math.ceil((height - overlap) / (ch - overlap)));
  return {
    cw,
    ch,
    cols,
    rows,
    tiles: Array.from({ length: rows * cols }, (_, i) => ({
      x: (i % cols) * (cw - overlap),
      y: Math.floor(i / cols) * (ch - overlap),
      column: (i % cols) + 1,
      row: Math.floor(i / cols) + 1,
    })),
  };
}
export function assemblyInstructions(entries: TemplatePart[], ids: Map<string, string>): string[] {
  return entries
    .filter((e) => e.part.role !== 'page')
    .map((entry) => {
      const p = entry.part,
        id = ids.get(p.id),
        target = p.parentIds.map((id) => ids.get(id) ?? id).join(', ');
      if (p.role === 'strip')
        return `${id} ${p.name}: place between the two guides on ${target}. Keep the widened end stops intact; do not glue the moving strip.`;
      if (p.role === 'cover')
        return `${id} ${p.name}: cut out the viewing window. Glue only the two outer 6 mm feet to ${target}, over the assembled guides and strip. Keep the channel clear.`;
      if (p.role.startsWith('guide'))
        return `${id} ${p.name}: wrap over the sliding strip first. Glue only the two 6 mm feet to the marked areas on ${target}. Keep the central channel free.`;
      if (p.role === 'decoration')
        return entry.reverseGlue.length
          ? `${id} ${p.name}: keep the illustrated face outward. Apply glue on the reverse only, using the mirrored assembly inset; align with the matching ${id} guide on ${target}. The inset is a reference, not another piece to cut.`
          : `${id} ${p.name}: attach flat to ${target} at its authored position.`;
      const ridge = entry.tabs.find((t) => t.fold.kind === 'mountain');
      return `${id} ${p.name}: score the marked creases; glue base tabs to matching areas on ${target}.${ridge ? ` Join the ridge tab to ${ids.get(ridge.match!) ?? ridge.match}.` : ''} Follow the 3D preview for assembly direction.`;
    });
}
export function exportSVG(compiled: CompiledSpread, diagnostics: Diagnostic[]): string {
  const pose = evaluateSpread(compiled, 180),
    entries = templateParts(compiled, pose),
    ids = new Map(entries.map((e, i) => [e.part.id, `P${String(i + 1).padStart(2, '0')}`]));
  let y = 48,
    width = Math.max(210, ...entries.map((e) => layout(e).width + 20));
  const body: string[] = [];
  for (const [index, entry] of entries.entries()) {
    const l = layout(entry),
      p = entry.part,
      key = `part${index}`,
      glueLabels: GlueLabel[] = [];
    body.push(
      `<g transform="translate(10 ${y})"><text x="0" y="0" font-size="5" font-weight="600">${ids.get(p.id)} — ${esc(p.name)}</text><g transform="translate(${l.x} ${l.y + 6})"><defs><clipPath id="${key}"><path d="${[svgPath(p.polygon), ...p.holes.map(svgPath)].join(' ')}" clip-rule="evenodd"/></clipPath></defs><path d="${svgPath(entry.outline)}" fill="${esc(p.color)}" fill-opacity=".16"/>`,
    );
    for (const a of compiled.spread.artwork.filter((a) => a.partId === p.id)) {
      const asset = compiled.project.assets[a.assetId];
      if (asset?.data)
        body.push(
          `<image href="${esc(asset.data)}" x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" preserveAspectRatio="none" clip-path="url(#${key})"/>`,
        );
    }
    body.push(
      `<path d="${[svgPath(entry.outline), ...p.holes.map(svgPath)].join(' ')}" fill="none" stroke="#bc553d" stroke-width=".25"/>`,
    );
    for (const fold of [...p.folds, ...entry.tabs.map((t) => t.fold)])
      body.push(
        `<path d="M${fold.a.join(',')}L${fold.b.join(',')}" fill="none" stroke="${fold.kind === 'mountain' ? '#7561a8' : '#3d86a1'}" stroke-width=".25" stroke-dasharray="${fold.kind === 'mountain' ? '3 1 .5 1' : '2 1'}"/>`,
      );
    for (const tab of entry.tabs) {
      const label = `GLUE ${ids.get(tab.match ?? '') ?? ''}`,
        [x, y] = glueLabelPosition(tab.polygon, label.length * 1.4, 2.3, glueLabels);
      body.push(
        `<path d="${svgPath(tab.polygon)}" fill="url(#hatch)"/><text x="${x}" y="${y}" font-size="2.3" text-anchor="middle" fill="#3d754f">${esc(label)}</text>`,
      );
    }
    for (const f of entry.footprints) {
      const label = ids.get(f.match) ?? f.match,
        center = glueLabelPosition(f.points, label.length * 1.5, 2.5, glueLabels);
      body.push(
        `<path d="${regionPath(f.points, f.holes)}" fill-rule="evenodd" fill="url(#hatch)" stroke="#568664" stroke-width=".2" stroke-dasharray="1 1"/><text x="${center[0]}" y="${center[1]}" font-size="2.5" text-anchor="middle">${esc(label)}</text>`,
      );
    }
    body.push('</g>');
    if (l.inset) {
      const inset = l.inset,
        reverse = (points: Vec2[]): Vec2[] =>
          points.map(([x, y]) => [
            inset.x + (inset.b.maxX - x) * inset.scale,
            inset.y + (y - inset.b.minY) * inset.scale,
          ]);
      body.push(
        `<g data-reverse-glue="${esc(p.id)}" transform="translate(0 6)"><text x="5" y="${inset.y - 6}" font-size="3.1">REVERSE GLUE GUIDE — assembly reference only</text><text x="5" y="${inset.y - 2}" font-size="2.5">Mirrored back · ${Math.round(inset.scale * 100)}% diagram · do not cut</text><path d="${regionPath(reverse(p.polygon), p.holes.map(reverse))}" fill="#f7f7f2" fill-rule="evenodd" stroke="#7a827a" stroke-width=".2"/>`,
      );
      for (const f of entry.reverseGlue)
        body.push(
          `<path d="${regionPath(reverse(f.points), f.holes.map(reverse))}" fill="url(#hatch)" fill-rule="evenodd" stroke="#568664" stroke-width=".2"/>`,
        );
      body.push('</g>');
    }
    body.push('</g>');
    y += l.height + 24;
  }
  const notes = [
    ...assemblyInstructions(entries, ids),
    ...diagnostics.map((d) => `${d.severity.toUpperCase()}: ${d.message}`),
  ];
  for (const note of notes) {
    // Preserve all assembly text in the exported vector document.
    const words = note.split(' ');
    let line = '';
    for (const word of words) {
      if ((line + word).length > 100) {
        body.push(`<text x="10" y="${y}" font-size="3.2">${esc(line)}</text>`);
        y += 5;
        line = '';
      }
      line += `${word} `;
    }
    body.push(`<text x="10" y="${y}" font-size="3.2">${esc(line)}</text>`);
    y += 8;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${y + 10}mm" viewBox="0 0 ${width} ${y + 10}"><title>${esc(compiled.project.name)} — fabrication templates</title><defs><pattern id="hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="#659370" stroke-width=".3"/></pattern></defs><g font-family="sans-serif" fill="#283c2d"><text x="10" y="12" font-size="6">${esc(compiled.spread.name)} — ${diagnostics.length ? 'DRAFT: UNRESOLVED CHECKS' : 'GEOMETRICALLY CHECKED / NOT PHYSICALLY TESTED'}</text><text x="10" y="20" font-size="3.5">Full scale in millimetres. Red: cut · Blue dashed: valley · Purple dash-dot: mountain · Green: glue</text><rect x="10" y="25" width="20" height="20" fill="none" stroke="#283c2d" stroke-width=".2"/><text x="34" y="36" font-size="3.5">20 × 20 mm scale check — print at 100%</text>${body.join('')}</g></svg>`;
}

export async function exportPDF(
  compiled: CompiledSpread,
  diagnostics: Diagnostic[],
  paper: 'A4' | 'Letter',
): Promise<Uint8Array> {
  const pose = evaluateSpread(compiled, 180),
    entries = templateParts(compiled, pose),
    ids = new Map(entries.map((e, i) => [e.part.id, `P${String(i + 1).padStart(2, '0')}`]));
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [pw, ph] = PAPER[paper];
  pdf.setTitle(`${compiled.project.name}: ${compiled.spread.name}`);
  pdf.setCreator('Fold Studio');
  pdf.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  let instructions = pdf.addPage([pw * MM, ph * MM]),
    lineY = ph - 18;
  const write = (value: string, size = 10, isBold = false) => {
    const usedFont = isBold ? bold : font,
      words = printable(value).split(' ');
    let line = '';
    const draw = () => {
      if (lineY < 20) {
        instructions = pdf.addPage([pw * MM, ph * MM]);
        lineY = ph - 18;
      }
      instructions.drawText(line, {
        x: 12 * MM,
        y: lineY * MM,
        font: usedFont,
        size,
        color: rgb(0.17, 0.24, 0.18),
      });
      lineY -= (size / MM) * 1.45;
    };
    for (const word of words) {
      if (usedFont.widthOfTextAtSize(`${line}${word} `, size) > (pw - 24) * MM) {
        draw();
        line = '';
      }
      line += `${word} `;
    }
    if (line) draw();
    lineY -= 2;
  };
  write(compiled.project.name, 20, true);
  write(compiled.spread.name, 14, true);
  write(
    diagnostics.length ? 'DRAFT - unresolved geometric checks' : 'Sampled geometry check completed',
    12,
    true,
  );
  write(
    'These templates have not been physically tested. Use a paper prototype to assess material thickness, glue tolerance and assembly. Print at 100% / actual size. Measure the 20 mm square on each sheet.',
  );
  write(
    'Line key: solid red = cut; dashed blue = valley fold; purple dash-dot = mountain fold; green = glue. Each piece has a stable matching P-number. Leave slider channels unglued.',
  );
  if (entries.some((entry) => entry.reverseGlue.length))
    write(
      'Illustrated cut-outs print single-sided. Keep glue off the illustration. Their mirrored reverse-side diagrams show where to apply glue on the back; diagrams are assembly references only. Match the glue guide printed on the support.',
    );
  write(
    'Large pieces span overlapping tiles. Match the printed tile coordinates and alignment marks; overlap adjacent sheets by 5 mm. Do not fit to page.',
  );
  write('Assembly order', 12, true);
  for (const instruction of assemblyInstructions(entries, ids)) write(instruction);
  if (diagnostics.length) {
    write('Unresolved checks', 12, true);
    for (const d of diagnostics) write(`${d.severity.toUpperCase()}: ${d.message}`);
  }
  const represented = new Set(pose.parts.map((p) => p.mechanismId));
  for (const m of compiled.order)
    if (!represented.has(m.id))
      write(
        `MISSING TEMPLATE: ${m.name} could not be solved. Repair it in the editor before fabrication.`,
        11,
        true,
      );
  const master = await PDFDocument.create(),
    masterFont = await master.embedFont(StandardFonts.Helvetica),
    imageCache = new Map<string, PDFImage>();
  for (const entry of entries) {
    const l = layout(entry),
      p = entry.part,
      source = master.addPage([l.width * MM, l.height * MM]),
      glueLabels: GlueLabel[] = [];
    const path = (points: Vec2[], color: [number, number, number], fill = false) =>
      source.drawSvgPath(svgPath(points), {
        x: l.x * MM,
        y: (l.height - l.y) * MM,
        scale: MM,
        borderColor: fill ? undefined : rgb(...color),
        borderWidth: fill ? 0 : 0.25,
        color: fill ? rgb(...color) : undefined,
        opacity: fill ? 0.13 : 1,
      });
    if (!compiled.spread.decorations.some((d) => d.id === p.id && d.cutout))
      path(entry.outline, [0.62, 0.64, 0.56], true);
    for (const a of compiled.spread.artwork.filter((a) => a.partId === p.id)) {
      const asset = compiled.project.assets[a.assetId];
      if (!asset?.data) continue;
      let image = imageCache.get(asset.id);
      if (!image) {
        image =
          asset.mime === 'image/png'
            ? await master.embedPng(bytesFromData(asset.data))
            : await master.embedJpg(bytesFromData(asset.data));
        imageCache.set(asset.id, image);
      }
      source.pushOperators(pushGraphicsState());
      for (const poly of [p.polygon, ...p.holes]) {
        source.pushOperators(moveTo((poly[0][0] + l.x) * MM, (l.height - l.y - poly[0][1]) * MM));
        for (const v of poly.slice(1))
          source.pushOperators(lineTo((v[0] + l.x) * MM, (l.height - l.y - v[1]) * MM));
        source.pushOperators(closePath());
      }
      source.pushOperators(clipEvenOdd(), endPath());
      source.drawImage(image, {
        x: (l.x + a.x) * MM,
        y: (l.height - l.y - a.y - a.height) * MM,
        width: a.width * MM,
        height: a.height * MM,
      });
      source.pushOperators(popGraphicsState());
    }
    path(entry.outline, [0.73, 0.33, 0.24]);
    for (const hole of p.holes) path(hole, [0.73, 0.33, 0.24]);
    const glue = (points: Vec2[], holes: Vec2[][] = [], border = true) => {
      // PDF's even-odd clip preserves openings inside irregular glue regions.
      source.pushOperators(pushGraphicsState());
      for (const poly of [points, ...holes]) {
        if (!poly.length) continue;
        source.pushOperators(moveTo((poly[0][0] + l.x) * MM, (l.height - l.y - poly[0][1]) * MM));
        for (const v of poly.slice(1))
          source.pushOperators(lineTo((v[0] + l.x) * MM, (l.height - l.y - v[1]) * MM));
        source.pushOperators(closePath());
      }
      source.pushOperators(clipEvenOdd(), endPath());
      const b = polygonBounds(points);
      source.drawRectangle({
        x: (b.minX + l.x) * MM,
        y: (l.height - l.y - b.maxY) * MM,
        width: (b.maxX - b.minX) * MM,
        height: (b.maxY - b.minY) * MM,
        color: rgb(0.3, 0.53, 0.38),
        opacity: 0.18,
      });
      source.pushOperators(popGraphicsState());
      if (border) {
        path(points, [0.3, 0.53, 0.38]);
        for (const hole of holes) path(hole, [0.3, 0.53, 0.38]);
      }
    };
    const labelGlue = (points: Vec2[], text: string, holes: Vec2[][] = [], border = true) => {
      glue(points, holes, border);
      const label = printable(text),
        [x, y] = glueLabelPosition(
          points,
          masterFont.widthOfTextAtSize(label, 6) / MM,
          6 / MM,
          glueLabels,
        );
      source.drawText(label, {
        x: (x + l.x) * MM - masterFont.widthOfTextAtSize(label, 6) / 2,
        y: (l.height - l.y - y) * MM,
        size: 6,
        font: masterFont,
        color: rgb(0.2, 0.4, 0.27),
      });
    };
    for (const tab of entry.tabs)
      labelGlue(tab.polygon, `GLUE ${ids.get(tab.match ?? '') ?? ''}`, [], false);
    for (const f of entry.footprints) labelGlue(f.points, ids.get(f.match) ?? 'MATCH', f.holes);
    // Glue outlines must not obscure the required fold pattern along their shared edge.
    const folds = [...p.folds, ...entry.tabs.map((t) => t.fold)];
    for (const fold of folds)
      source.drawLine({
        start: { x: (fold.a[0] + l.x) * MM, y: (l.height - fold.a[1] - l.y) * MM },
        end: { x: (fold.b[0] + l.x) * MM, y: (l.height - fold.b[1] - l.y) * MM },
        thickness: 0.25 * MM,
        color: fold.kind === 'mountain' ? rgb(0.46, 0.38, 0.66) : rgb(0.24, 0.52, 0.63),
        dashArray: (fold.kind === 'mountain' ? [3, 1, 0.5, 1] : [2, 1]).map((n) => n * MM),
      });
    if (l.inset) {
      const inset = l.inset,
        reverse = (points: Vec2[]): Vec2[] =>
          points.map(([x, y]) => [
            inset.x + (inset.b.maxX - x) * inset.scale - l.x,
            inset.y + (y - inset.b.minY) * inset.scale - l.y,
          ]);
      source.drawText('REVERSE GLUE GUIDE - assembly reference only', {
        x: 5 * MM,
        y: (l.height - inset.y + 6) * MM,
        size: 8,
        color: rgb(0.25, 0.35, 0.27),
      });
      source.drawText(`Mirrored back / ${Math.round(inset.scale * 100)}% diagram / do not cut`, {
        x: 5 * MM,
        y: (l.height - inset.y + 2) * MM,
        size: 7,
        color: rgb(0.4, 0.4, 0.4),
      });
      path(reverse(p.polygon), [0.48, 0.51, 0.48]);
      for (const hole of p.holes) path(reverse(hole), [0.48, 0.51, 0.48]);
      for (const f of entry.reverseGlue) glue(reverse(f.points), f.holes.map(reverse));
    }
    await master.flush(); // Resolve source font/image objects before the page is copied into the output PDF.
    const tiles = tileLayout(l.width, l.height, paper);
    for (const tile of tiles.tiles) {
      const page = pdf.addPage([pw * MM, ph * MM]);
      page.drawText(printable(`${ids.get(p.id)}  ${p.name}`).slice(0, 75), {
        x: 10 * MM,
        y: (ph - 12) * MM,
        size: 12,
        font: bold,
      });
      page.drawText(
        `${paper} / 100% / tile ${tile.column},${tile.row} of ${tiles.cols} x ${tiles.rows}${diagnostics.length ? ' / DRAFT' : ' / untested in paper'}`,
        { x: 10 * MM, y: (ph - 19) * MM, size: 8, font },
      );
      const embedded = await pdf.embedPage(source, {
        left: tile.x * MM,
        right: Math.min(l.width, tile.x + tiles.cw) * MM,
        bottom: (l.height - Math.min(l.height, tile.y + tiles.ch)) * MM,
        top: (l.height - tile.y) * MM,
      });
      page.drawPage(embedded, {
        x: 10 * MM,
        y: (ph - 28) * MM - embedded.height,
        xScale: 1,
        yScale: 1,
      });
      registration(page, pw, ph, tiles.cw, tiles.ch, tile.x, tile.y);
      page.drawRectangle({
        x: (pw - 30) * MM,
        y: 5 * MM,
        width: 20 * MM,
        height: 20 * MM,
        borderWidth: 0.25 * MM,
        borderColor: rgb(0.2, 0.3, 0.2),
      });
      page.drawText('20 mm', { x: (pw - 28) * MM, y: 13 * MM, size: 8, font });
      page.drawText('Red: cut / Blue: valley / Purple: mountain / Green: glue', {
        x: 10 * MM,
        y: 14 * MM,
        size: 7,
        font,
      });
      page.drawText('Match P-numbers. Align overlapping tiles. No automatic scaling.', {
        x: 10 * MM,
        y: 9 * MM,
        size: 7,
        font,
      });
    }
  }
  return pdf.save();
}
export function registrationPoints(cw: number, ch: number, tileX: number, tileY: number) {
  // Centre marks in each 5 mm overlap represent the same master coordinates on neighbouring sheets.
  return [2.5, cw - 2.5].flatMap((x) =>
    [2.5, ch - 2.5].map((y) => ({ x, y, sourceX: x + tileX, sourceY: y + tileY })),
  );
}
function registration(
  page: PDFPage,
  width: number,
  height: number,
  cw: number,
  ch: number,
  tileX: number,
  tileY: number,
) {
  for (const mark of registrationPoints(cw, ch, tileX, tileY)) {
    const x = 10 + mark.x,
      y = height - 28 - mark.y;
    page.drawLine({
      start: { x: (x - 2) * MM, y: y * MM },
      end: { x: (x + 2) * MM, y: y * MM },
      thickness: 0.2 * MM,
      color: rgb(0.5, 0.5, 0.5),
    });
    page.drawLine({
      start: { x: x * MM, y: (y - 2) * MM },
      end: { x: x * MM, y: (y + 2) * MM },
      thickness: 0.2 * MM,
      color: rgb(0.5, 0.5, 0.5),
    });
    page.drawText(`${mark.sourceX.toFixed(1)},${mark.sourceY.toFixed(1)}`, {
      x: (x - (mark.x > cw / 2 ? 19 : 0)) * MM,
      y: (y - 3.6) * MM,
      size: 5,
      color: rgb(0.5, 0.5, 0.5),
    });
  }
}
