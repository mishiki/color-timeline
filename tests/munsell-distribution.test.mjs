import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMunsellDistribution, validateMunsellDistribution } from '../dist/munsell-distribution.js';
import { validateImport } from '../dist/model.js';

test('Munsell distribution counts visible pixels and excludes transparent pixels', () => {
  const rgba = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 0,
    255, 255, 255, 23,
  ]);
  const result = analyzeMunsellDistribution(rgba, 2, 2);
  assert.equal(result.total, 2);
  assert.equal(result.missing, 0);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.count, 0), 2);
  assert.ok(result.bins.every((bin) => bin.count >= 1 && bin.rgb.every((v) => Number.isInteger(v))));
});

test('hue bins average around the circular seam', () => {
  const rgba = new Uint8Array([
    255, 2, 0, 255,
    255, 0, 8, 255,
  ]);
  const result = analyzeMunsellDistribution(rgba, 2, 1);
  assert.equal(result.total, 2);
  assert.equal(result.bins.length, 1);
  assert.ok(result.bins[0].h < 10 || result.bins[0].h > 90);
});

test('distribution validates count conservation and survives JSON import', () => {
  const distribution = analyzeMunsellDistribution(new Uint8Array([255, 0, 0, 255]), 1, 1);
  assert.deepEqual(validateMunsellDistribution(distribution), distribution);
  const input = {
    format: 'color-timeline', version: 1,
    project: { name: 'dist', kind: 'image', duration: 0, algorithm: 'iscc-nbs-13-chroma-v3', settings: { interval: 1, sampleSize: 192, mergeDelta: .035, chromaTopPercent: 20, logStrength: 10 } },
    samples: [{ timeKey: 0, t: 0, palette: [{ rgb: [255, 0, 0], share: 1 }], munsellDistribution: distribution }],
  };
  const imported = validateImport(input);
  assert.equal(imported.samples[0].munsellDistribution.total, 1);
});
