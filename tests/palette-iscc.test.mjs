import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRGBA, DEFAULT_SETTINGS } from '../dist/palette.js';
import { ISCC_DATA, classifyRGB } from '../dist/iscc-data.js';

function rgba(colors) {
  return new Uint8Array(colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
}

function level1Id(rgb) {
  const classified = classifyRGB(rgb);
  return ISCC_DATA.categories.find((category) => String(category.id) === String(classified?.id))?.level1Id ?? 0;
}

test('gray pixels keep their weighted and raw mass in the 13-group palette', () => {
  const colors = [
    [128, 128, 128], [128, 128, 128], [128, 128, 128], [128, 128, 128],
    [255, 0, 0], [255, 0, 0],
  ];
  const pixels = rgba(colors);
  const result = analyzeRGBA(pixels, colors.length, 1);
  const grayId = String(level1Id([128, 128, 128]));
  const gray = result.palette.find((item) => String(item.categoryId) === grayId);

  assert.ok(gray, 'gray category remains in the extracted palette');
  assert.equal(gray.pixelCount, 4);
  assert.equal(gray.share, 4 / 6);
  assert.equal(gray.rawShare, 4 / 6);
  assert.equal(gray.munsell?.approximate, true);
  assert.ok(Math.abs(result.palette.reduce((sum, item) => sum + item.share, 0) - 1) < 1e-12);

  // logStrength belongs to display formatting and does not transform extraction shares.
  const noLog = analyzeRGBA(pixels, colors.length, 1, { ...DEFAULT_SETTINGS, logStrength: 0 });
  assert.deepEqual(noLog.palette.map(({ categoryId, share, rawShare }) => [categoryId, share, rawShare]),
    result.palette.map(({ categoryId, share, rawShare }) => [categoryId, share, rawShare]));
});

test('nearby category representatives merge by complete-link distance and retain member traces', () => {
  // These adjacent reds fall on the Brown / Black category boundary in the atlas.
  const pixels = rgba([[26, 0, 0], [27, 0, 0]]);
  const separate = analyzeRGBA(pixels, 2, 1, { mergeDelta: 0 });
  const merged = analyzeRGBA(pixels, 2, 1);

  assert.equal(separate.palette.length, 2);
  assert.equal(merged.palette.length, 1);
  assert.equal(merged.palette[0].members.length, 2);
  assert.equal(merged.palette[0].share, 1);
  assert.equal(merged.palette[0].rawShare, 1);
  assert.ok(merged.palette[0].munsell?.approximate);
  assert.deepEqual(merged.palette[0].members.map((member) => member.id).sort((a, b) => a - b), [4, 13]);
});

test('chromaTopPercent 100 uses all category pixels as the representative baseline', () => {
  const colors = Array.from({ length: 10 }, (_, index) => [255, index * 10, 0]);
  const pixels = rgba(colors);
  const chromaFiltered = analyzeRGBA(pixels, colors.length, 1, { mergeDelta: 0, chromaTopPercent: 20 });
  const fullPopulation = analyzeRGBA(pixels, colors.length, 1, { mergeDelta: 0, chromaTopPercent: 100 });

  assert.equal(chromaFiltered.palette.length, 1);
  assert.equal(fullPopulation.palette.length, 1);
  assert.deepEqual(chromaFiltered.palette[0].rgb, [255, 0, 0]);
  assert.deepEqual(fullPopulation.palette[0].rgb, [255, 50, 0]);
  assert.equal(DEFAULT_SETTINGS.chromaTopPercent, 20);
});
