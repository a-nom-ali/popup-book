import type { Asset } from '../model';
import type { TraceOptions, TraceResult } from '../engine/trace';

/** Decode the original asset once, then move contour work off the editor thread. */
export async function traceImage(asset: Asset, options: TraceOptions = {}): Promise<TraceResult> {
  if (asset.mime !== 'image/png') throw new Error('Choose a transparent PNG for a paper cut-out.');
  const image = new Image();
  image.src = asset.data;
  await image.decode().catch(() => {
    throw new Error('This PNG could not be decoded.');
  });
  const width = image.naturalWidth,
    height = image.naturalHeight;
  if (width * height > 16_777_216)
    throw new Error('Choose an image of 16 megapixels or less for tracing.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image tracing needs a working Canvas 2D context.');
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, width, height).data,
    alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../engine/trace.worker.ts', import.meta.url), {
      type: 'module',
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('The image trace took too long. Try a smaller image.'));
    }, 30000);
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<{ result?: TraceResult; error?: string }>) => {
      finish();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? 'Image tracing failed.'));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('The tracing worker could not run. Reload the studio and try again.'));
    };
    worker.postMessage({ alpha, imageWidth: width, imageHeight: height, options }, [alpha.buffer]);
  });
}
