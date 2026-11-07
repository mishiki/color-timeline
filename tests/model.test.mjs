import test from 'node:test';
import assert from 'node:assert/strict';
import { timeKey, validateImport, displayPalette, VERSION, LEGACY_VERSION } from '../dist/model.js';

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
test('presentation keeps hidden widths as OTHER and does not mutate saved colors',()=>{
  const palette=[{rgb:[255,0,0],share:.6},{rgb:[0,255,0],share:.3},{rgb:[0,0,255],share:.1}];const before=JSON.stringify(palette);
  const shown=displayPalette(palette,2,'hue',10),all=displayPalette(palette,3,'hue',10);assert.equal(JSON.stringify(palette),before);assert.equal(shown.length,3);assert.equal(shown.at(-1).isOther,true);assert.ok(Math.abs(shown.reduce((s,c)=>s+c.width,0)-1)<1e-10);assert.equal(shown[0].width,all[0].width);
});
test('new analysis import preserves category, merge trace and coordinates without relabeling legacy data',()=>{
  assert.equal(validateImport(fixture()).project.algorithm,LEGACY_VERSION);
  const x=fixture();x.project.algorithm=VERSION;x.project.settings={interval:1,sampleSize:192,mergeDelta:.035,chromaTopPercent:20,logStrength:10};
  x.samples[0].palette[0]={rgb:[100,110,120],share:1,rawShare:1,categoryId:'9+12',categoryName:'Blue + Gray',munsell:{h:65,v:4,c:2,approximate:true},members:[{id:9,name:'Blue',rgb:[100,110,120],share:.6,rawShare:.6},{id:12,name:'Gray',rgb:[110,110,110],share:.4,rawShare:.4}]};
  const y=validateImport(x);assert.equal(y.project.algorithm,VERSION);assert.equal(y.samples[0].palette[0].members.length,2);assert.equal(y.samples[0].palette[0].munsell.v,4);
  x.samples[0].palette[0].munsell.v=NaN;assert.throws(()=>validateImport(x));
});
