import test from 'node:test';
import assert from 'node:assert/strict';
import {rgbToMunsell} from '../dist/munsell-data.js';
test('Munsell coordinate lookup has a neutral axis and nonlinear Value',()=>{
  assert.deepEqual(rgbToMunsell([0,0,0]),{h:0,v:0,c:0,approximate:true});
  assert.equal(rgbToMunsell([255,255,255]).v,10);
  const gray=rgbToMunsell([128,128,128]);assert.equal(gray.c,0);assert(gray.v>5.2&&gray.v<5.3);
  const blue=rgbToMunsell([0,0,255]);assert(blue.h>70&&blue.h<80&&blue.c>20);
  assert.equal(rgbToMunsell([NaN,0,0]),null);
});
