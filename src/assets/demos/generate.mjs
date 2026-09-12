import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  resolve: {
    alias: [
      {
        find: /^polygon-clipping$/,
        replacement: fileURLToPath(new URL('./polygon-clipping.mjs', import.meta.url)),
      },
    ],
  },
});
try {
  const { generateDemoThumbnails } = await server.ssrLoadModule('/src/assets/demos/generate.ts');
  await generateDemoThumbnails();
} finally {
  await server.close();
}
