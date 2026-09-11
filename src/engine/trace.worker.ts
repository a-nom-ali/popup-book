import { traceAlpha } from './trace';
import type { TraceOptions } from './trace';

self.onmessage = (
  event: MessageEvent<{
    alpha: Uint8Array;
    imageWidth: number;
    imageHeight: number;
    options: TraceOptions;
  }>,
) => {
  try {
    const { alpha, imageWidth, imageHeight, options } = event.data;
    self.postMessage({ result: traceAlpha(alpha, imageWidth, imageHeight, options) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'The image could not be traced.',
    });
  }
};
