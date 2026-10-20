import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeHue,drawHueRing} from '../dist/hue-ring.js';
const canvas={width:480,height:480,getContext:()=>new Proxy({},{get:()=>()=>{}})};
test('Hue mass preserves visible denominator and weighting excludes achromatic pixels',()=>{
 const h=summarizeHue(new Uint8ClampedArray([255,0,0,255,128,0,0,255,128,128,128,255,0,255,0,0]));
 assert.equal(h.total,3);assert.equal(h.achromatic,1);assert.equal(h.count[0],2);
 assert.ok(Math.abs(drawHueRing(canvas,h,{saturation:1,brightness:1,smoothing:6}).mass-(1+128/255)/3)<1e-12);
 assert.ok(Math.abs(drawHueRing(canvas,h,{saturation:0,brightness:0,smoothing:0}).mass-2/3)<1e-12);
});
test('Circular smoothing combines hue near 359 and 0 without losing votes',()=>{
 const h=summarizeHue(new Uint8ClampedArray([255,0,1,255,255,1,0,255]));
 assert.equal(h.count[359],1);assert.equal(h.count[0],1);
 const result=drawHueRing(canvas,h,{saturation:0,brightness:0,smoothing:6});
 assert.ok(Math.abs(result.mass-1)<1e-12);assert.ok(result.peak>.06&&result.peak<.07);
});
