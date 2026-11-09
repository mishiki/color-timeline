import { analyzeRGBA } from "./palette.js";
import { summarizeHue } from "./hue-ring.js";
import { analyzeMunsellDistribution } from "./munsell-distribution.js";

self.onmessage = (event) => {
  const { id, rgba, width, height, settings, regions } = event.data ?? {};
  try {
    const result = analyzeRGBA(rgba, width, height, settings, regions);
    result.hue = summarizeHue(rgba);
    result.munsellDistribution = analyzeMunsellDistribution(rgba, width, height);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
