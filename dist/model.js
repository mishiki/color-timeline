export const VERSION = 'b-family-1';
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
export function displayPalette(palette, count=5, order='area') {
  const selected=[...palette].sort((a,b)=>b.share-a.share).slice(0,count);
  if(order==='hue')selected.sort((a,b)=>hue(a.rgb)-hue(b.rgb));
  const total=selected.reduce((sum,p)=>sum+p.share,0);
  return selected.map(p=>({...p,width:total?p.share/total:1/selected.length}));
}
export function validateImport(data) {
  if(data?.format!=='color-timeline' || data.version!==1 || !data.project || !Array.isArray(data.samples))throw Error('Color Timeline のJSONではありません');
  const p=data.project,s=p.settings;
  if(!['video','image','capture'].includes(p.kind)||typeof p.name!=='string'||!s)throw Error('作品情報が不正です');
  for(const [key,min,max] of [['interval',1/120,60],['sampleSize',32,1024],['hueMerge',0,45],['neutralSat',0,.16],['accentSat',.3,.9],['accentMinArea',0,.03]])if(!Number.isFinite(s[key])||s[key]<min||s[key]>max)throw Error(`設定 ${key} が不正です`);
  if(!Number.isFinite(p.duration)||p.duration<0)throw Error('動画の長さが不正です');
  if(data.samples.length>1000000)throw Error('記録点が多すぎます');
  const seen=new Set();
  const samples=data.samples.map(row=>{
    if(!Number.isInteger(row.timeKey)||row.timeKey<0||seen.has(row.timeKey)||!Number.isFinite(row.t)||row.t<0||row.t>p.duration+1||!Array.isArray(row.palette)||row.palette.length<1||row.palette.length>5)throw Error('時刻または色数が不正です');
    seen.add(row.timeKey);
    if(row.timeKey>Math.round((p.duration+s.interval)*1000))throw Error('記録時刻が動画の長さを超えています');
    const palette=row.palette.map(c=>{
      if(!Array.isArray(c.rgb)||c.rgb.length!==3||!c.rgb.every(x=>Number.isInteger(x)&&x>=0&&x<=255)||!Number.isFinite(c.share)||c.share<0||c.share>1)throw Error('色情報が不正です');
      return {rgb:c.rgb.slice(),hex:'#'+c.rgb.map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase(),share:c.share};
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
    return {timeKey:row.timeKey,t:row.t,palette,...(hue?{hue}:{})};
  });
  return {project:{id:crypto.randomUUID(),name:p.name.slice(0,250),kind:p.kind,duration:p.duration,settings:{...s},fingerprint:typeof p.fingerprint==='string'?p.fingerprint:null,createdAt:new Date().toISOString(),algorithm:p.algorithm||VERSION},samples};
}
