import test from 'node:test';
import assert from 'node:assert/strict';
import { timeKey, validateImport, displayPalette } from '../dist/model.js';

test('30 Hz sampling uses stable millisecond keys without boundary drift',()=>{
  for(let i=0;i<10000;i++)assert.equal(timeKey(i/30,1/30),Math.round(i/30*1000));
  assert.equal(timeKey(.999,1),0);
  assert.equal(timeKey(1,1),1000);
});
function fixture(){return {format:'color-timeline',version:1,project:{name:'fixture',kind:'video',duration:4,settings:{interval:1,sampleSize:192,hueMerge:18,neutralSat:.08,accentSat:.58,accentMinArea:.004}},samples:[{t:0,timeKey:0,palette:[{rgb:[1,2,3],hex:'untrusted',share:1}]}]};}
test('JSON import strips source handles and regenerates hex values',()=>{
  const input=fixture();input.project.handle='ignored';input.project.video='ignored';const result=validateImport(input);
  assert.equal(result.project.handle,undefined);assert.equal(result.project.video,undefined);assert.equal(result.samples[0].palette[0].hex,'#010203');
});
test('JSON import rejects duplicate timestamps and invalid palette totals',()=>{
  const duplicate=fixture();duplicate.samples.push(duplicate.samples[0]);assert.throws(()=>validateImport(duplicate));
  const invalid=fixture();invalid.samples[0].palette[0].share=.2;assert.throws(()=>validateImport(invalid));
});
test('presentation reordering does not mutate saved colors and normalizes only displayed subset',()=>{
  const palette=[{rgb:[255,0,0],share:.6},{rgb:[0,255,0],share:.3},{rgb:[0,0,255],share:.1}];const before=JSON.stringify(palette);
  const shown=displayPalette(palette,2,'hue');assert.equal(JSON.stringify(palette),before);assert.equal(shown.length,2);assert.ok(Math.abs(shown.reduce((s,c)=>s+c.width,0)-1)<1e-10);
});
