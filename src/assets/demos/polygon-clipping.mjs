// Match the browser's CommonJS named-export interop when running the generator in Node.
import clipping from 'polygon-clipping/dist/polygon-clipping.cjs.js';
export const { union, intersection, difference, xor } = clipping;
