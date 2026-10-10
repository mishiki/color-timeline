import { analyzeRGBA } from "./palette.js";

self.onmessage = (event) => {
  const { id, rgba, width, height, settings } = event.data ?? {};
  try {
    const result = analyzeRGBA(rgba, width, height, settings);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
