/* Original vector artwork for Paperfold Studio. Regenerate with:
 * node src/assets/scenery/generate.cjs /absolute/path/to/sharp
 * All contour coordinates are millimetres in the original image rectangle.
 */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
const out = __dirname;
const pathData = (points) => `M${points.map((p) => p.join(',')).join('L')}Z`;
const rectangle = (x, y, width, height) => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height],
];
const circle = (x, y, radius, steps = 32) =>
  Array.from({ length: steps }, (_, i) => [
    x + Math.cos((i * 2 * Math.PI) / steps) * radius,
    y + Math.sin((i * 2 * Math.PI) / steps) * radius,
  ]);
const round = (points) => points.map((p) => p.map((v) => Math.round(v * 10000) / 10000));
function curvedOutline(start, segments) {
  const points = [start];
  let from = start;
  for (const segment of segments) {
    if (segment.length === 2) points.push(segment);
    else
      for (let i = 1; i <= 12; i++) {
        const t = i / 12,
          s = 1 - t;
        points.push([
          s * s * s * from[0] +
            3 * s * s * t * segment[0] +
            3 * s * t * t * segment[2] +
            t * t * t * segment[4],
          s * s * s * from[1] +
            3 * s * s * t * segment[1] +
            3 * s * t * t * segment[3] +
            t * t * t * segment[5],
        ]);
      }
    from = points.at(-1);
  }
  return round(points);
}
function flecks(width, height, color = '#fff6dc') {
  let result = '';
  for (let i = 0; i < 78; i++) {
    const x = 3 + ((i * 19.37) % (width - 6)),
      y = 3 + ((i * 31.71) % (height - 6));
    result += `<ellipse cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx=".17" ry=".48" fill="${color}" opacity=".19" transform="rotate(-24 ${x} ${y})"/>`;
  }
  return result;
}
const oak = curvedOutline(
  [25, 78],
  [
    [25, 62],
    [16, 66, 8, 59, 10, 53],
    [1, 53, 1, 43, 7, 38],
    [1, 30, 7, 20, 16, 22],
    [16, 11, 27, 8, 33, 15],
    [40, 7, 51, 13, 49, 23],
    [59, 24, 61, 35, 54, 41],
    [62, 47, 54, 59, 47, 57],
    [42, 65, 37, 65, 34, 61],
    [34, 78],
  ],
);
const pine = [
  [21, 83],
  [21, 67],
  [10, 65],
  [2, 61],
  [15, 41],
  [7, 41],
  [19, 23],
  [10, 23],
  [26, 3],
  [42, 23],
  [35, 23],
  [47, 41],
  [39, 41],
  [50, 61],
  [42, 65],
  [31, 67],
  [31, 83],
];
const castle = [
  [3, 73],
  [3, 20],
  [8, 20],
  [8, 12],
  [12, 12],
  [12, 20],
  [18, 20],
  [18, 12],
  [22, 12],
  [22, 20],
  [27, 20],
  [27, 34],
  [34, 34],
  [34, 26],
  [40, 26],
  [40, 34],
  [48, 34],
  [48, 26],
  [54, 26],
  [54, 34],
  [61, 34],
  [61, 20],
  [66, 20],
  [66, 12],
  [70, 12],
  [70, 20],
  [76, 20],
  [76, 12],
  [80, 12],
  [80, 20],
  [85, 20],
  [85, 73],
];
const archedWindow = (cx, y, width, height) => [
  [cx - width / 2, y + height],
  [cx - width / 2, y + width / 2],
  [cx - width * 0.35, y + width * 0.15],
  [cx, y],
  [cx + width * 0.35, y + width * 0.15],
  [cx + width / 2, y + width / 2],
  [cx + width / 2, y + height],
];
const castleHoles = [archedWindow(15, 29, 9, 17), archedWindow(73, 29, 9, 17), circle(44, 43, 4.4)];
const tower = [
  [7, 88],
  [7, 38],
  [3, 38],
  [23, 3],
  [43, 38],
  [39, 38],
  [39, 88],
];
const towerHoles = [archedWindow(23, 44, 10, 18)];
const items = [
  {
    id: 'oak',
    name: 'Orchard oak',
    description: 'A rounded woodland tree with a warm, branching trunk.',
    width: 60,
    height: 82,
    outline: oak,
    holes: [],
    glue: rectangle(26, 68, 7, 8),
    supportWidth: 24,
    color: '#758f65',
    art: `<rect width="60" height="82" fill="#758f65"/>
      <path d="M4 44C8 31 13 43 21 31S39 21 47 30S56 39 58 46V69H4Z" fill="#577b64"/>
      <path d="M8 28C16 13 20 31 31 19S47 17 51 25C41 24 41 36 30 37S15 31 8 39Z" fill="#9bb180"/>
      <path d="M25 82L26 51L17 40L19 38L28 46L29 27L32 26L32 43L42 32L44 34L33 49L34 82Z" fill="#bc865d"/>
      <path d="M29 80L30 49L22 41M31 52L41 43M30 47L32 32" fill="none" stroke="#805f49" stroke-width=".8" stroke-linecap="round"/>
      <g fill="none" stroke="#d3d7a6" stroke-width=".75" stroke-linecap="round" opacity=".7"><path d="M13 30l3-3m23-6l3 2M9 47l3 1m30 6l3-2M46 39l3 1m-27 15l-3-1M23 20l2 2"/></g>
      <g fill="#d9ae69"><circle cx="16" cy="38" r="1.4"/><circle cx="42" cy="28" r="1.4"/><circle cx="44" cy="49" r="1.1"/><circle cx="19" cy="52" r="1.1"/></g>
      ${flecks(60, 65)}<path d="M26 77h7" stroke="#725c45" stroke-width=".5"/>`,
  },
  {
    id: 'pine',
    name: 'Mountain pine',
    description: 'A layered evergreen with ochre cones and a sturdy trunk.',
    width: 52,
    height: 88,
    outline: pine,
    holes: [],
    glue: rectangle(22.5, 72, 7, 9),
    supportWidth: 24,
    color: '#527461',
    art: `<rect width="52" height="88" fill="#527461"/>
      <path d="M21 64h10v23H21Z" fill="#b27b55"/>
      <path d="M26 3L10 23C17 24 24 21 28 17L42 23Z" fill="#93aa79"/>
      <path d="M26 24L7 41C19 44 30 37 34 33L47 41Z" fill="#769766"/>
      <path d="M25 43L2 61C18 67 34 60 40 54L50 61Z" fill="#678b64"/>
      <path d="M26 14v50M26 27l-7 6m7 6l10 7m-10 5l-12 8m12-6l11 6" fill="none" stroke="#385e53" stroke-width=".8" stroke-linecap="round"/>
      <g stroke="#c9d3a0" stroke-width=".7" stroke-linecap="round"><path d="M21 19l-2 2m14 15l3 2m-23 20l3-2m20-9l3 2m-10 11l3-2M16 37l2-2"/></g>
      <g fill="#d0a363"><ellipse cx="20" cy="33" rx="1.1" ry="1.8" transform="rotate(-20 20 33)"/><ellipse cx="34" cy="52" rx="1.2" ry="2" transform="rotate(24 34 52)"/></g>
      <path d="M25 70v11m3-12v8" stroke="#805d46" stroke-width=".6"/>${flecks(52, 67)}`,
  },
  {
    id: 'castle',
    name: 'Rosewood castle',
    description: 'A warm stone façade with two arched windows and a round cut-through oculus.',
    width: 88,
    height: 76,
    outline: castle,
    holes: castleHoles,
    glue: rectangle(22, 64, 44, 7),
    supportWidth: 60,
    color: '#d8b48c',
    art: `<rect width="88" height="76" fill="#ead5af"/>
      <path d="M3 19h24v54H3zm58 0h24v54H61z" fill="#d4ad88"/>
      <path d="M3 20h24v5H3zm58 0h24v5H61zM27 34h34v5H27z" fill="#bc7f68"/>
      <path d="M3 68h82v8H3zM22 25h5v43h-5zm58 0h5v43h-5z" fill="#c99975"/>
      <g fill="#b47a60"><path d="M8 12h4v8H8zm10 0h4v8h-4zm48 0h4v8h-4zm10 0h4v8h-4zM34 26h6v8h-6zm14 0h6v8h-6z"/></g>
      <path d="M34 69V59C34 45 54 45 54 59V69Z" fill="#a56e52" stroke="#be9974" stroke-width="2"/>
      <path d="M38 69V58m4 11V54m4 15V54m4 15V58" stroke="#805b48" stroke-width=".8"/>
      <circle cx="47.5" cy="62" r=".75" fill="#ead0a0"/>
      <g fill="none" stroke="#b3896c" stroke-width=".45" opacity=".7"><path d="M5 29h6m9 0h5M6 49h10m3 0h6M5 56h8m5 0h7M7 63h10m4 0h4M63 29h5m11 0h4M63 49h8m4 0h8M64 57h11m3 0h5M64 64h6m6 0h7M30 44h6m16 0h6M28 50h7m18 0h6"/></g>
      <g fill="none" stroke="#f3e3bd" stroke-width="1.2">${castleHoles.map((h) => `<path d="${pathData(h)}"/>`).join('')}</g>
      <path d="M5 68c3-4 1-8 5-12m-4 7l4-1m-2-3l4-1M80 69c-2-3-1-6-4-9" fill="none" stroke="#718c69" stroke-width=".8" stroke-linecap="round"/>
      ${flecks(88, 76, '#fff3d4')}`,
  },
  {
    id: 'tower',
    name: 'Blue-roof tower',
    description: 'A slender storybook tower with a slate roof and an open arched window.',
    width: 46,
    height: 92,
    outline: tower,
    holes: towerHoles,
    glue: rectangle(13, 80, 20, 6),
    supportWidth: 30,
    color: '#c69b7b',
    art: `<rect width="46" height="92" fill="#dec09c"/>
      <path d="M30 37h10v52H30Z" fill="#c99778"/>
      <path d="M3 38L23 3L43 38Z" fill="#547d83"/>
      <path d="M23 3L43 38H24Z" fill="#3d626d"/>
      <path d="M8 30h30M12 22h22M17 14h12" fill="none" stroke="#96b1a4" stroke-width=".6"/>
      <path d="M7 38h32v5H7zM7 84h32v8H7z" fill="#b88469"/>
      <path d="M16 85V77C16 67 30 67 30 77V85Z" fill="#a46c54"/>
      <path d="M20 84V75m5 9V74" stroke="#775446" stroke-width=".7"/><circle cx="27" cy="79" r=".65" fill="#e0bd81"/>
      <path d="${pathData(towerHoles[0])}" fill="none" stroke="#f0dfb9" stroke-width="1.5"/>
      <g fill="none" stroke="#b1886d" stroke-width=".45"><path d="M10 49h5m16 0h5M9 64h10m5 0h12M11 69h8m12 0h5M10 77h4m18 0h4"/></g>
      <path d="M9 83c1-6 4-5 3-10m-1 5l4-2" fill="none" stroke="#7d926e" stroke-width=".8"/>
      ${flecks(46, 92)}`,
  },
];
(async () => {
  const library = [];
  for (const item of items) {
    const outline = round(item.outline),
      holes = item.holes.map(round),
      contours = [outline, ...holes].map(pathData).join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${item.width * 10}" height="${item.height * 10}" viewBox="0 0 ${item.width} ${item.height}"><title>${item.name}</title><defs><clipPath id="paper"><path d="${contours}" clip-rule="evenodd"/></clipPath></defs><g clip-path="url(#paper)">${item.art}<path d="${pathData(outline)}" fill="none" stroke="#5b6250" stroke-opacity=".44" stroke-width=".45" stroke-linejoin="round"/></g></svg>`;
    fs.writeFileSync(path.join(out, `${item.id}.svg`), svg);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    fs.writeFileSync(path.join(out, `${item.id}.png`), png);
    library.push({
      id: item.id,
      name: item.name,
      description: item.description,
      width: item.width,
      height: item.height,
      imageWidth: item.width * 10,
      imageHeight: item.height * 10,
      outline,
      holes,
      glueRegion: [{ outline: item.glue, holes: [] }],
      supportWidth: item.supportWidth,
      color: item.color,
      data: `data:image/png;base64,${png.toString('base64')}`,
    });
  }
  fs.writeFileSync(path.join(out, 'library.json'), JSON.stringify(library));
  console.log(`Generated ${library.length} original illustrated cut-outs.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
