export const VERSION = 'iscc-nbs-13-chroma-v3';
export const LEGACY_VERSION = 'b-family-1';
import { validateMunsellDistribution } from './munsell-distribution.js';
export function timeKey(t, interval) { return Math.round(Math.floor((t + 1e-7) / interval) * interval * 1000); }
export function formatTime(t) {
  if (!Number.isFinite(t)) return '—';
  const seconds = Math.max(0, Math.floor(t));
  return `${Math.floor(seconds / 3600) ? Math.floor(seconds / 3600) + ':' : ''}${String(Math.floor(seconds / 60) % 60).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
}
export function hue(rgb) {
  const [r,g,b] = rgb.map(x=>x/255), hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo;
  if(d<.02)return 400+hi;
  return ((hi===r?(g-b)/d:hi===g?(b-r)/d+2:(r-g)/d+4)*60+360)%360;
}
export function displayPalette(palette, count=7, order='area', logStrength=0) {
  const k=Math.max(0,Number(logStrength)||0),response=p=>k>0?Math.log1p(k*p):p;
  const mass=palette.reduce((s,p)=>s+response(p.share),0);
  const sorted=[...palette].sort((a,b)=>b.share-a.share);
  const selected=sorted.slice(0,count),other=sorted.slice(count);
  if(order==='hue')selected.sort((a,b)=>hue(a.rgb)-hue(b.rgb));
  const result=selected.map(p=>({...p,width:mass?response(p.share)/mass:0}));
  if(other.length)result.push({isOther:true,categoryName:'その他',rgb:[83,97,114],hex:'#536172',share:other.reduce((s,p)=>s+p.share,0),rawShare:other.reduce((s,p)=>s+(p.rawShare??p.share),0),width:mass?other.reduce((s,p)=>s+response(p.share),0)/mass:0});
  return result;
}
export function validateImport(data) {
  if(data?.format!=='color-timeline' || data.version!==1 || !data.project || !Array.isArray(data.samples))throw Error('Color Timeline のJSONではありません');
  const p=data.project,s=p.settings;
  if(!['video','image','capture'].includes(p.kind)||typeof p.name!=='string'||!s)throw Error('作品情報が不正です');
  const algorithm=p.algorithm||LEGACY_VERSION,isCurrent=algorithm===VERSION;
  const rules=[['interval',1/120,60],['sampleSize',32,1024],...(isCurrent?[['mergeDelta',0,.15],['chromaTopPercent',1,100],['logStrength',0,100]]:[['hueMerge',0,45],['neutralSat',0,.16],['accentSat',.3,.9],['accentMinArea',0,.03]])];
  for(const [key,min,max] of rules)if(!Number.isFinite(s[key])||s[key]<min||s[key]>max)throw Error(`設定 ${key} が不正です`);
  if(!Number.isFinite(p.duration)||p.duration<0)throw Error('動画の長さが不正です');
  if(data.samples.length>1000000)throw Error('記録点が多すぎます');
  const seen=new Set();
  const samples=data.samples.map(row=>{
    if(!Number.isInteger(row.timeKey)||row.timeKey<0||seen.has(row.timeKey)||!Number.isFinite(row.t)||row.t<0||row.t>p.duration+1||!Array.isArray(row.palette)||row.palette.length<1||row.palette.length>(isCurrent?14:5))throw Error('時刻または色数が不正です');
    seen.add(row.timeKey);
    if(row.timeKey>Math.round((p.duration+s.interval)*1000))throw Error('記録時刻が動画の長さを超えています');
    const palette=row.palette.map(c=>{
      if(!Array.isArray(c.rgb)||c.rgb.length!==3||!c.rgb.every(x=>Number.isInteger(x)&&x>=0&&x<=255)||!Number.isFinite(c.share)||c.share<0||c.share>1)throw Error('色情報が不正です');
      const result={rgb:c.rgb.slice(),hex:'#'+c.rgb.map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase(),share:c.share};
      if(c.rawShare!==undefined){if(!Number.isFinite(c.rawShare)||c.rawShare<0||c.rawShare>1)throw Error('元面積比が不正です');result.rawShare=c.rawShare;}
      if(c.categoryId!==undefined){if(!/^(?:0|[1-9]\d?)(?:\+[1-9]\d?)*$/.test(String(c.categoryId)))throw Error('カテゴリーIDが不正です');result.categoryId=c.categoryId;}
      if(c.categoryName!==undefined){if(typeof c.categoryName!=='string'||c.categoryName.length>250)throw Error('色名が不正です');result.categoryName=c.categoryName;}
      if(c.munsell!=null){const m=c.munsell;if(!Number.isFinite(m.h)||m.h<0||m.h>100||!Number.isFinite(m.v)||m.v<0||m.v>10.01||!Number.isFinite(m.c)||m.c<0||m.c>64)throw Error('マンセル座標が不正です');result.munsell={h:m.h,v:m.v,c:m.c,approximate:true};}
      if(c.isUnknown===true)result.isUnknown=true;
      if(c.members!==undefined){if(!Array.isArray(c.members)||c.members.length>13)throw Error('統合履歴が不正です');result.members=c.members.map(m=>{if(!Number.isInteger(m.id)||m.id<1||m.id>13||typeof m.name!=='string'||m.name.length>60||!Array.isArray(m.rgb)||m.rgb.length!==3||!m.rgb.every(n=>Number.isInteger(n)&&n>=0&&n<=255)||!Number.isFinite(m.share)||m.share<0||m.share>1||!Number.isFinite(m.rawShare)||m.rawShare<0||m.rawShare>1)throw Error('統合履歴が不正です');return{id:m.id,name:m.name,rgb:m.rgb.slice(),share:m.share,rawShare:m.rawShare};});}
      return result;
    });
    if(Math.abs(palette.reduce((sum,c)=>sum+c.share,0)-1)>.02)throw Error('色の面積比の合計が不正です');
    let hue;
    if(row.hue){
      const h=row.hue;
      if(!Number.isInteger(h.total)||h.total<0||h.total>1048576||!Number.isInteger(h.achromatic)||h.achromatic<0||h.achromatic>h.total)throw Error('色相分布の画素数が不正です');
      for(const key of ['count','s','v','sv'])if(!Array.isArray(h[key])||h[key].length!==360||!h[key].every(x=>Number.isFinite(x)&&x>=0&&x<=h.total))throw Error('色相分布が不正です');
      if(h.count.some((n,i)=>!Number.isInteger(n)||h.s[i]>n+1e-7||h.v[i]>n+1e-7||h.sv[i]>Math.min(h.s[i],h.v[i])+1e-7)||h.count.reduce((a,b)=>a+b,0)+h.achromatic!==h.total)throw Error('色相分布の合計が不正です');
      hue={total:h.total,achromatic:h.achromatic,count:h.count.slice(),s:h.s.slice(),v:h.v.slice(),sv:h.sv.slice()};
    }
    let munsellDistribution;
    if(row.munsellDistribution!==undefined)munsellDistribution=validateMunsellDistribution(row.munsellDistribution);
    return {timeKey:row.timeKey,t:row.t,palette,...(hue?{hue}:{}),...(munsellDistribution?{munsellDistribution}:{})};
  });
  let regions;
  if(p.regions){
    const r=p.regions;
    if(p.kind!=='image'||!Number.isFinite(r.weight)||r.weight<1||r.weight>8||!Array.isArray(r.polygons)||r.polygons.length>100||r.polygons.some(poly=>!Array.isArray(poly)||poly.length<3||poly.length>1000||poly.some(pt=>!Array.isArray(pt)||pt.length!==2||pt.some(n=>!Number.isFinite(n)||n<0||n>1))))throw Error('領域指定が不正です');
    regions=structuredClone(r);
  }
  return {project:{id:crypto.randomUUID(),name:p.name.slice(0,250),kind:p.kind,duration:p.duration,settings:Object.fromEntries(rules.map(([key])=>[key,s[key]])),fingerprint:typeof p.fingerprint==='string'?p.fingerprint:null,createdAt:new Date().toISOString(),algorithm,...(regions?{regions}:{})},samples};
}
