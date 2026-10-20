import { DEFAULT_SETTINGS } from './palette.js';
import { listProjects, getProject, putProject, putSample, getSamples } from './storage.js';
import { VERSION, timeKey, formatTime, displayPalette, validateImport } from './model.js';
import { drawHueRing } from './hue-ring.js';

const $=id=>document.getElementById(id);
const player=$('player'), still=$('still'), decoder=document.createElement('video');
decoder.preload='auto'; decoder.muted=true; decoder.playsInline=true;
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
const worker=new Worker(new URL('./palette-worker.js',import.meta.url),{type:'module'});
let jobs=new Map(),serial=0,project=null,samples=new Map(),sourceFile=null,sourceHandle=null,sourceUrl=null,stream=null;
let scanController=null,generation=0,liveBusy=false,callbackId=null,captureStart=null,storageOK=true,sourceReady=false;
let selectedTime=0,drawQueued=false,projectSave=Promise.resolve();
const MAX_DIAGNOSTIC_EVENTS=60;
let diagnostics={active:false,startedAt:0,file:null,events:[],failure:null,awaited:null};
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function fail(error){console.error(error);status(error.message||String(error),true);}
function shortText(value,max=1000){const text=String(value??'');return text.length>max?text.slice(0,max)+'…':text;}
function mediaErrorSnapshot(media){const error=media.error;if(!error)return null;const code=error.code??null,codeNames={1:'MEDIA_ERR_ABORTED',2:'MEDIA_ERR_NETWORK',3:'MEDIA_ERR_DECODE',4:'MEDIA_ERR_SRC_NOT_SUPPORTED'};return {code,codeName:codeNames[code]||'',name:shortText(error.name||''),message:shortText(error.message||'')};}
function finiteValue(value){return Number.isFinite(value)?value:String(value);}
function mediaSnapshot(media){return {readyState:media.readyState,networkState:media.networkState,error:mediaErrorSnapshot(media),videoWidth:media.videoWidth,videoHeight:media.videoHeight,duration:finiteValue(media.duration),currentTime:finiteValue(media.currentTime)};}
function diagnosticReport(){return {browser:{userAgent:navigator.userAgent,secureContext:Boolean(window.isSecureContext)},file:diagnostics.file,awaited:diagnostics.awaited,failure:diagnostics.failure,snapshot:{player:mediaSnapshot(player),decoder:mediaSnapshot(decoder)},events:diagnostics.events};}
function renderDiagnostics(){
  if(!diagnostics.active)return;
  $('diagnosticsPanel').hidden=false;$('diagnosticsSummary').textContent=diagnostics.failure?'メディア診断（読み込みに失敗しました）':'メディア診断';
  $('diagnosticsIntro').textContent=diagnostics.failure?'読み込み失敗時の状態とブラウザーイベントを記録しました。ファイル名や保存場所は含みません。':'ブラウザー内のメディア読み込み状態を記録しています。ファイル名や保存場所は含みません。';
  $('diagnosticsOutput').textContent=JSON.stringify(diagnosticReport(),null,2);
}
function resetDiagnostics(){diagnostics={active:false,startedAt:0,file:null,events:[],failure:null,awaited:null};$('diagnosticsPanel').hidden=true;$('diagnosticsDetails').open=false;$('diagnosticsOutput').textContent='';$('copyDiagnosticsStatus').textContent='';}
function beginDiagnostics(file){diagnostics={active:true,startedAt:performance.now(),file:{mimeType:file.type||'',sizeBytes:file.size},events:[],failure:null,awaited:null};renderDiagnostics();}
function recordMediaEvent(element,event){
  if(!diagnostics.active)return;
  diagnostics.events.push({elapsedMs:Math.round(performance.now()-diagnostics.startedAt),element,event,readyState:(element==='player'?player:decoder).readyState,networkState:(element==='player'?player:decoder).networkState,error:mediaErrorSnapshot(element==='player'?player:decoder)});
  if(diagnostics.events.length>MAX_DIAGNOSTIC_EVENTS)diagnostics.events.splice(0,diagnostics.events.length-MAX_DIAGNOSTIC_EVENTS);
  renderDiagnostics();
}
function captureDiagnosticFailure(error,{element='player',stage='media load',awaitedEvent=null}={}){
  if(!diagnostics.active)return;
  diagnostics.failure={element,stage:shortText(stage,160),awaitedEvent:awaitedEvent?shortText(awaitedEvent,80):null,message:shortText(error?.message||error,1000),player:mediaSnapshot(player),decoder:mediaSnapshot(decoder)};
  diagnostics.awaited=null;$('diagnosticsDetails').open=true;renderDiagnostics();
}
for(const [media,label] of [[player,'player'],[decoder,'decoder']])for(const name of ['loadstart','loadedmetadata','loadeddata','canplay','canplaythrough','durationchange','error','abort','emptied','stalled','suspend','waiting'])media.addEventListener(name,()=>recordMediaEvent(label,name));
async function copyDiagnostics(){
  const output=$('diagnosticsOutput'),selection=window.getSelection(),range=document.createRange();
  try{await navigator.clipboard.writeText(output.textContent);$('copyDiagnosticsStatus').textContent='診断情報をコピーしました。';}
  catch{range.selectNodeContents(output);selection.removeAllRanges();selection.addRange(range);output.focus();$('copyDiagnosticsStatus').textContent='テキストを選択しました。Ctrl+C でコピーしてください。';}
}
worker.onmessage=({data})=>{const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data.result);};
worker.onerror=event=>{for(const job of jobs.values())job.reject(Error(event.message||'解析ワーカーエラー'));jobs.clear();status('解析ワーカーでエラーが発生しました。ページを再読み込みしてください。',true);};
function settings(){return {...DEFAULT_SETTINGS,hueMerge:+$('hueMerge').value,neutralSat:+$('neutralSat').value,accentSat:+$('accentSat').value,accentMinArea:+$('accentMinArea').value/100,interval:+$('sampleInterval').value,sampleSize:+$('sampleSize').value};}
function applyInputs(s){for(const key of ['hueMerge','neutralSat','accentSat','sampleSize'])$(key).value=s[key];$('accentMinArea').value=s.accentMinArea*100;$('sampleInterval').value=s.interval;syncOutputs();}
function syncOutputs(){for(const key of ['hueMerge','neutralSat','accentSat','accentMinArea'])$(key+'Out').textContent=$(key).value+(key==='hueMerge'?'°':key==='accentMinArea'?'%':'');}
async function persistProject(){
  if(!project)return;
  const snapshot={...project,updatedAt:new Date().toISOString(),sampleCount:samples.size};
  projectSave=projectSave.catch(()=>{}).then(()=>putProject(snapshot));
  try{await projectSave;}catch(e){storageOK=false;$('storageStatus').textContent='保存できません。JSONを書き出して保管してください。';throw e;}
}
async function refreshProjects(){
  const rows=await listProjects();$('projectSelect').replaceChildren(new Option('保存済みの解析を選択',''));
  rows.sort((a,b)=>(b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||''));
  for(const p of rows)$('projectSelect').add(new Option(`${p.name} · ${p.sampleCount||0}点`,p.id));
  if(project)$('projectSelect').value=project.id;
}
function cancelScan(){scanController?.abort();scanController=null;$('pauseBtn').disabled=true;$('startBtn').disabled=!(sourceReady&&sourceFile&&project?.kind==='video');}
function detachSource(){
  sourceReady=false;cancelScan();generation++;player.pause();
  if(callbackId!==null&&player.cancelVideoFrameCallback)player.cancelVideoFrameCallback(callbackId);callbackId=null;
  if(stream){for(const track of stream.getTracks())track.stop();stream=null;}
  player.srcObject=null;player.removeAttribute('src');player.load();decoder.removeAttribute('src');decoder.load();
  still.removeAttribute('src');if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=null;sourceFile=null;sourceHandle=null;captureStart=null;resetDiagnostics();
}
function waitEvent(element,name,signal,timeout=20000,stage=name){return new Promise((resolve,reject)=>{
  const label=element===player?'player':'decoder';if(diagnostics.active){diagnostics.awaited={element:label,event:name,stage};renderDiagnostics();}
  const timer=setTimeout(()=>{const err=Error('映像の読み込みがタイムアウトしました');captureDiagnosticFailure(err,{element:label,stage,awaitedEvent:name});end(err);},timeout);
  function clean(){clearTimeout(timer);element.removeEventListener(name,ready);element.removeEventListener('error',error);signal?.removeEventListener('abort',abort);}
  function end(err){clean();if(diagnostics.active)diagnostics.awaited=null;renderDiagnostics();err?reject(err):resolve();}function ready(){end();}function error(){const err=Error('映像を取得できません');captureDiagnosticFailure(err,{element:label,stage,awaitedEvent:name});end(err);}function abort(){end(new DOMException('停止','AbortError'));}
  element.addEventListener(name,ready,{once:true});element.addEventListener('error',error,{once:true});signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});}
async function fingerprint(file){
  const n=1024*1024,head=await file.slice(0,n).arrayBuffer(),tail=await file.slice(Math.max(n,file.size-n)).arrayBuffer();
  const prefix=new TextEncoder().encode(String(file.size)+':'),buf=new Uint8Array(prefix.length+head.byteLength+tail.byteLength);
  buf.set(prefix);buf.set(new Uint8Array(head),prefix.length);buf.set(new Uint8Array(tail),prefix.length+head.byteLength);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buf)),x=>x.toString(16).padStart(2,'0')).join('');
}
async function loadFile(file,handle=null,reconnect=false){
  if(!file)return;
  const previouslyReady=sourceReady;$('startBtn').disabled=true;
  let fp;
  try{fp=await fingerprint(file);if(reconnect&&project&&project.fingerprint!==fp)throw Error('保存済み解析と元ファイルが一致しません。新しく開く場合は「動画・画像を開く」を使ってください。');}
  catch(error){$('startBtn').disabled=!(previouslyReady&&sourceFile&&project?.kind==='video');throw error;}
  const previous=reconnect?project:null;
  detachSource();const gen=generation;sourceFile=file;sourceHandle=handle;sourceUrl=URL.createObjectURL(file);player.muted=false;$('startBtn').disabled=true;
  const kind=file.type.startsWith('image/')?'image':'video';
  if(kind==='video')beginDiagnostics(file);
  $('mediaPlaceholder').hidden=true;player.hidden=kind==='image';still.hidden=kind!=='image';
  let duration=0;
  if(kind==='image'){const loaded=waitEvent(still,'load');still.src=sourceUrl;await loaded;}
  else {
    try{
      const loaded=waitEvent(player,'loadeddata',null,20000,'player loadeddata');player.src=sourceUrl;await loaded;
      if(!player.videoWidth||!player.videoHeight){const error=Error('映像を取得できません');captureDiagnosticFailure(error,{element:'player',stage:'player loadeddata dimension check',awaitedEvent:'loadeddata'});throw error;}
      // Some locally recorded WebM files omit a duration header. Seeking to their
      // end lets the browser discover the finite duration without copying them.
      if(!Number.isFinite(player.duration)){
        const end=waitEvent(player,'seeked',null,20000,'duration discovery seek to end');player.currentTime=1e10;await end;
        const beginning=waitEvent(player,'seeked',null,20000,'duration discovery seek to start');player.currentTime=0;await beginning;
      }
      if(!Number.isFinite(player.duration)||player.duration<=0){const error=Error('長さを取得できない動画です');captureDiagnosticFailure(error,{element:'player',stage:'duration validation'});throw error;}duration=player.duration;
      const ready=waitEvent(decoder,'loadeddata',null,20000,'decoder loadeddata');decoder.src=sourceUrl;await ready;
      if(!decoder.videoWidth||!decoder.videoHeight){const error=Error('映像を取得できません');captureDiagnosticFailure(error,{element:'decoder',stage:'decoder loadeddata dimension check',awaitedEvent:'loadeddata'});throw error;}
    }catch(error){if(error.name!=='AbortError'&&!diagnostics.failure)captureDiagnosticFailure(error,{element:diagnostics.awaited?.element||'player',stage:diagnostics.awaited?.stage||'opening video',awaitedEvent:diagnostics.awaited?.event||null});throw error;}
  }
  if(gen!==generation)return;
  const s=previous?.settings||settings();
  let existing=previous;
  if(!existing)existing=(await listProjects()).find(p=>p.fingerprint===fp&&p.algorithm===VERSION&&JSON.stringify(p.settings)===JSON.stringify(s));
  project=existing||{id:crypto.randomUUID(),name:file.name,kind,duration,fingerprint:fp,settings:s,algorithm:VERSION,createdAt:new Date().toISOString()};
  if(handle)project.handle=handle;
  samples=new Map((existing?await getSamples(existing.id):[]).map(x=>[x.timeKey,x]));applyInputs(project.settings);
  selectedTime=0;$('scrub').disabled=kind==='image';$('scrub').max=duration;$('scrub').value=0;$('startBtn').disabled=true;
  await persistProject();await refreshProjects();render();sourceReady=kind==='video';$('startBtn').disabled=!(sourceReady&&sourceFile&&project?.kind==='video');
  status(existing?'元ファイルを接続しました。保存済みの解析を再利用します。':'元ファイルを開きました。動画本体は保存しません。');
  if(kind==='image')await analyzeSource(still,0,gen);else {scheduleLive();await analyzeSource(player,0,gen);}
}
async function chooseFile(reconnect=false){
  try{
    if(window.showOpenFilePicker){const [handle]=await window.showOpenFilePicker({multiple:false});await loadFile(await handle.getFile(),handle,reconnect);}
    else {$('fileInput').dataset.reconnect=String(reconnect);$('fileInput').click();}
  }catch(e){if(e.name!=='AbortError')fail(e);}
}
async function selectProject(id){
  if(!id)return;await persistProject();detachSource();project=await getProject(id);samples=new Map((await getSamples(id)).map(s=>[s.timeKey,s]));
  applyInputs(project.settings);selectedTime=0;player.hidden=true;still.hidden=true;$('mediaPlaceholder').hidden=false;$('mediaPlaceholder').textContent='解析結果を表示中。映像を見るには元ファイルを再接続してください。';
  $('scrub').disabled=project.kind==='image';$('scrub').max=project.duration;$('scrub').value=0;$('startBtn').disabled=true;render();status('保存済みの解析を読み込みました。');
}
async function reconnect(){
  if(!project){await chooseFile();return;}
  if(project.kind==='capture'){status('画面キャプチャは再接続できません。新しいキャプチャとして開始してください。');return;}
  try{if(project.handle){let permission=await project.handle.queryPermission({mode:'read'});if(permission!=='granted')permission=await project.handle.requestPermission({mode:'read'});if(permission==='granted'){await loadFile(await project.handle.getFile(),project.handle,true);return;}}}catch(e){status('保存した参照を開けません。元ファイルを選び直してください。');}
  await chooseFile(true);
}
async function analyzeSource(media,t,gen=generation,signal=null){
  if(!project||gen!==generation)return;
  if(project.kind==='video')t=Math.min(t,Math.max(0,project.duration-.001));
  const key=timeKey(t,project.settings.interval);if(samples.get(key)?.hue)return;
  const width=media.videoWidth||media.naturalWidth,height=media.videoHeight||media.naturalHeight;if(!width||!height)return;
  const scale=Math.min(1,project.settings.sampleSize/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  ctx.drawImage(media,0,0,canvas.width,canvas.height);const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const id=++serial,projectId=project.id;
  const result=await new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject});worker.postMessage({id,rgba:rgba.buffer,width:canvas.width,height:canvas.height,settings:project.settings},[rgba.buffer]);});
  if(gen!==generation||project?.id!==projectId||signal?.aborted)return;
  if(!result.palette.length)return;
  const sample={timeKey:key,t,palette:result.palette,hue:result.hue};samples.set(key,sample);
  if(project.kind==='capture')project.duration=Math.max(project.duration,t+project.settings.interval);
  try{await putSample(projectId,sample);if(samples.size%20===0||project.kind==='image')await persistProject();}
  catch(e){storageOK=false;$('storageStatus').textContent='保存失敗。JSONで解析データを保管してください。';status('保存エラー: '+e.message,true);}
  render();
}
function scheduleLive(){
  if(callbackId!==null)return;
  const tick=async(_,meta)=>{
    callbackId=null;if(!sourceFile&&!stream)return;
    const gen=generation;
    let t=meta?.mediaTime??player.currentTime;
    if(stream){if(captureStart===null)captureStart=t;t=Math.max(0,t-captureStart);}
    selectedTime=t;$('scrub').value=t;
    if(stream&&project){project.duration=Math.max(project.duration,t);$('scrub').max=project.duration;}
    render();
    if(!liveBusy){liveBusy=true;try{await analyzeSource(player,t,gen);}catch(e){fail(e);}finally{liveBusy=false;}}
    if(gen===generation)scheduleLive();
  };
  if(player.requestVideoFrameCallback)callbackId=player.requestVideoFrameCallback(tick);
}
player.addEventListener('timeupdate',()=>{if(!stream){selectedTime=player.currentTime;$('scrub').value=selectedTime;render();}if(!player.requestVideoFrameCallback&&!liveBusy&&!player.paused){liveBusy=true;analyzeSource(player,player.currentTime).catch(fail).finally(()=>{liveBusy=false;});}});
player.addEventListener('seeked',()=>{if(!stream&&!liveBusy){liveBusy=true;analyzeSource(player,player.currentTime).catch(fail).finally(()=>{liveBusy=false;});}});
player.addEventListener('pause',()=>persistProject().catch(fail));
async function seek(t,signal){
  if(signal.aborted)throw new DOMException('停止','AbortError');
  const target=Math.min(t,Math.max(0,decoder.duration-.001));
  if(Math.abs(decoder.currentTime-target)<.0001&&decoder.readyState>=2)return;
  const done=waitEvent(decoder,'seeked',signal);decoder.currentTime=target;await done;
}
async function scan(){
  if(!sourceReady||!sourceFile||project?.kind!=='video')return;
  cancelScan();const control=new AbortController();scanController=control;const gen=generation;
  $('startBtn').disabled=true;$('pauseBtn').disabled=false;status('先読み解析中。再生位置とは独立して、未解析の時刻を埋めています。');
  try{const count=Math.ceil(project.duration/project.settings.interval);
    for(let i=0;i<count;i++){
      if(control.signal.aborted||gen!==generation)break;
      const t=i*project.settings.interval;if(samples.get(timeKey(t,project.settings.interval))?.hue)continue;
      await seek(t,control.signal);if(control.signal.aborted||gen!==generation)break;await analyzeSource(decoder,t,gen,control.signal);
      if(i%10===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(gen===generation){await persistProject();await refreshProjects();status(control.signal.aborted?'解析を停止しました。記録済みの時刻は保持しています。':'先読み解析が完了しました。');}
  }catch(e){if(e.name!=='AbortError')fail(e);else status('解析を停止しました。');}
  finally{if(scanController===control){scanController=null;$('startBtn').disabled=!(sourceReady&&sourceFile&&project?.kind==='video');$('pauseBtn').disabled=true;}}
}
async function capture(){
  let chosen=null,managed=false;
  try{
    if(!navigator.mediaDevices?.getDisplayMedia)throw Error('このブラウザーはタブ・画面キャプチャに対応していません');
    chosen=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
    await persistProject();detachSource();stream=chosen;const gen=generation;
    project={id:crypto.randomUUID(),name:'画面キャプチャ '+new Date().toLocaleString('ja-JP'),kind:'capture',duration:0,settings:settings(),algorithm:VERSION,createdAt:new Date().toISOString()};samples=new Map();selectedTime=0;
    player.hidden=false;still.hidden=true;$('mediaPlaceholder').hidden=true;player.srcObject=stream;player.muted=true;await player.play();
    $('scrub').disabled=true;$('startBtn').disabled=true;$('pauseBtn').disabled=false;await persistProject();await refreshProjects();render();scheduleLive();managed=true;status('共有中の映像を解析しています。先読みはできません。');
    chosen.getVideoTracks()[0].addEventListener('ended',async()=>{if(gen!==generation)return;stream=null;await persistProject();await refreshProjects();$('pauseBtn').disabled=true;status('画面キャプチャを終了しました。解析結果は保存済みです。');});
  }catch(e){if(chosen&&!managed){for(const track of chosen.getTracks())track.stop();if(stream===chosen){stream=null;player.srcObject=null;$('pauseBtn').disabled=true;}}if(e.name!=='NotAllowedError'&&e.name!=='AbortError')fail(e);}
}
function viewRange(){
  const duration=Math.max(project?.duration||1,.001),zoom=$('zoom').value;if(zoom==='full')return[0,duration];
  const length=Math.min(+zoom,duration),start=Math.min(Math.max(0,selectedTime-length/2),duration-length);return[start,start+length];
}
function drawTimeline(target,range,withPlayhead=true){
  const c=target.getContext('2d'),w=target.width,h=target.height;c.fillStyle='#131b28';c.fillRect(0,0,w,h);if(!project)return;
  const [start,end]=range,span=end-start;const count=+$('topN').value,order=$('paletteOrder').value;
  // Draw actual sample coverage, never fill missing timestamps with adjacent colors.
  // At overview scale choose one sample per pixel; export can use a wider canvas.
  const columns=new Map();
  for(const sample of samples.values()){
    const t=sample.timeKey/1000;if(t+project.settings.interval<=start||t>=end)continue;
    const x=Math.max(0,Math.floor((t-start)/span*w));const existing=columns.get(x);if(!existing||sample.timeKey<existing.timeKey)columns.set(x,sample);
  }
  for(const [x,sample] of columns){const endX=Math.min(w,Math.ceil((sample.timeKey/1000+project.settings.interval-start)/span*w));let y=0;
    for(const color of displayPalette(sample.palette,count,order)){const height=color.width*h;c.fillStyle=color.hex;c.fillRect(x,y,Math.max(1,endX-x),height+.3);y+=height;}
  }
  if(withPlayhead&&selectedTime>=start&&selectedTime<=end){const x=(selectedTime-start)/span*w;c.fillStyle='#fff';c.fillRect(Math.max(0,x-1),0,2,h);}
}
function render(){
  if(drawQueued)return;drawQueued=true;requestAnimationFrame(()=>{drawQueued=false;
    $('currentTime').textContent=formatTime(selectedTime)+'.'+String(Math.floor((selectedTime%1)*1000)).padStart(3,'0');
    $('timelineEmptyHint').hidden=samples.size>0;
    const sample=project?samples.get(timeKey(selectedTime,project.settings.interval)):null;
    const hs=+$('hueSaturation').value,hv=+$('hueBrightness').value,sigma=+$('hueSmoothing').value;
    $('hueSaturationOut').textContent=hs.toFixed(2);$('hueBrightnessOut').textContent=hv.toFixed(2);$('hueSmoothingOut').textContent=sigma+'°';
    const ring=drawHueRing($('hueRing'),sample?.hue,{saturation:hs,brightness:hv,smoothing:sigma,scale:$('hueScale').value});
    $('hueInfo').textContent=sample?.hue?`加重票の合計 ${(ring.mass*100).toFixed(1)}% · 無彩色 ${(sample.hue.achromatic/Math.max(1,sample.hue.total)*100).toFixed(1)}%`+(ring.clipped?' · 目盛り上限を超える部分があります':'') : sample?'旧データには色相分布がありません。元ファイルを開き、先読み解析すると追加できます。':'この時刻の色相分布は未解析です。';
    $('currentPalette').replaceChildren();$('paletteLegend').replaceChildren();
    if(sample){for(const p of displayPalette(sample.palette,+$('topN').value,$('paletteOrder').value)){
      const bar=document.createElement('span');bar.style.width=(p.width*100)+'%';bar.style.background=p.hex;bar.title=p.hex;$('currentPalette').append(bar);
      const li=document.createElement('div');li.className='palette-item';const sw=document.createElement('i');sw.style.background=p.hex;const hex=document.createElement('code');hex.textContent=p.hex;const ratio=document.createElement('span');ratio.textContent=(p.share*100).toFixed(1)+'%';li.append(sw,hex,ratio);$('paletteLegend').append(li);
    }}else $('paletteLegend').textContent=project?'この時刻は未解析':'動画または画像を開いてください';
    const total=project?project.kind==='image'?1:Math.ceil(project.duration/project.settings.interval):0;
    $('analysisProgress').value=total?Math.min(100,samples.size/total*100):0;$('progressLabel').textContent=`${samples.size.toLocaleString()} / ${total.toLocaleString()} 点`;
    const range=viewRange();$('timelineStart').textContent=formatTime(range[0]);$('timelineEnd').textContent=formatTime(range[1]);
    const plot=$('timeline'),width=Math.max(320,Math.round(plot.getBoundingClientRect().width*devicePixelRatio));if(plot.width!==width)plot.width=width;
    drawTimeline(plot,range);
  });
}
function seekPlayer(t){selectedTime=Math.max(0,Math.min(project?.duration||0,t));$('scrub').value=selectedTime;if(sourceFile&&project.kind==='video')player.currentTime=selectedTime;render();}
function download(name,type,data){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportJSON(){if(!project)return;const {handle,...meta}=project;download('color-timeline.json','application/json',JSON.stringify({format:'color-timeline',version:1,project:meta,samples:[...samples.values()].sort((a,b)=>a.timeKey-b.timeKey)},null,2));}
function exportCSV(){if(!project)return;const lines=[['seconds','sample_key_ms','rank','hex','share']];for(const s of [...samples.values()].sort((a,b)=>a.timeKey-b.timeKey))s.palette.forEach((p,i)=>lines.push([s.t,s.timeKey,i+1,p.hex,p.share]));download('color-timeline.csv','text/csv;charset=utf-8','\uFEFF'+lines.map(row=>row.join(',')).join('\r\n'));}
function exportPNG(){
  if(!project||!samples.size)return;
  const image=document.createElement('canvas');image.width=Math.min(16000,Math.max(1200,Math.ceil(project.duration/project.settings.interval)));image.height=280;
  const band=document.createElement('canvas');band.width=image.width;band.height=200;drawTimeline(band,[0,Math.max(.001,project.duration)],false);
  const c=image.getContext('2d');c.fillStyle='#131b28';c.fillRect(0,0,image.width,image.height);c.drawImage(band,0,40);c.fillStyle='#e8eef6';c.font='16px sans-serif';c.fillText(project.name,12,26);c.fillText('00:00',12,267);c.textAlign='right';c.fillText(formatTime(project.duration),image.width-12,267);
  image.toBlob(blob=>{if(blob)download('color-timeline.png','image/png',blob);},'image/png');
}
async function importJSON(file){
  if(file.size>150*1024*1024)throw Error('JSONが大きすぎます（上限150MB）');const data=validateImport(JSON.parse(await file.text()));
  await persistProject();detachSource();project=data.project;samples=new Map(data.samples.map(s=>[s.timeKey,s]));
  status('解析データを保存しています…');await putProject(project);for(const s of data.samples)await putSample(project.id,s);await persistProject();await refreshProjects();await selectProject(project.id);status('解析データを読み込みました。動画本体は含まれていません。');
}
$('openBtn').onclick=()=>chooseFile();$('reconnectBtn').onclick=reconnect;$('captureBtn').onclick=capture;
let fileDragDepth=0;
const isFileDrag=e=>Array.from(e.dataTransfer?.types||[]).includes('Files');
function clearFileDrag(){fileDragDepth=0;$('fileDropOverlay').hidden=true;}
window.addEventListener('dragenter',e=>{if(!isFileDrag(e))return;e.preventDefault();fileDragDepth++;$('fileDropOverlay').hidden=false;});
window.addEventListener('dragover',e=>{if(!isFileDrag(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
window.addEventListener('dragleave',e=>{if(!isFileDrag(e))return;if(--fileDragDepth<=0)clearFileDrag();});
window.addEventListener('dragend',clearFileDrag);
window.addEventListener('drop',e=>{
  if(!isFileDrag(e))return;
  e.preventDefault();clearFileDrag();
  const files=Array.from(e.dataTransfer.files);
  if(files.length!==1){status('動画または画像を1ファイルずつドロップしてください。',true);return;}
  const file=files[0];
  if(!/^(video|image)\//.test(file.type)){status('動画または画像のファイルをドロップしてください。',true);return;}
  persistProject().then(()=>loadFile(file)).catch(fail);
});
$('fileInput').onchange=e=>loadFile(e.target.files[0],null,e.target.dataset.reconnect==='true').catch(fail).finally(()=>{e.target.value='';});
window.addEventListener('paste',e=>{
  // Leave ordinary text editing and non-media clipboard contents untouched.
  if(e.target instanceof Element && e.target.closest('input,textarea,[contenteditable]:not([contenteditable="false"])'))return;
  const files=Array.from(e.clipboardData?.items||[])
    .filter(item=>item.kind==='file' && /^(image|video)\//.test(item.type))
    .map(item=>item.getAsFile()).filter(Boolean);
  if(!files.length)return;
  e.preventDefault();
  if(files.length!==1){status('画像または動画を1ファイルずつ貼り付けてください。',true);return;}
  status('クリップボードから読み込んでいます…');
  persistProject().then(()=>loadFile(files[0])).catch(fail);
});
$('projectSelect').onchange=e=>selectProject(e.target.value).catch(fail);$('startBtn').onclick=scan;
$('pauseBtn').onclick=()=>{if(stream){for(const track of stream.getTracks())track.stop();stream=null;persistProject().then(refreshProjects).catch(fail);$('pauseBtn').disabled=true;status('キャプチャを停止しました。');}else{cancelScan();persistProject().catch(fail);}};
$('scrub').oninput=e=>seekPlayer(+e.target.value);$('timeline').onclick=e=>{const r=e.currentTarget.getBoundingClientRect(),[start,end]=viewRange();seekPlayer(start+(e.clientX-r.left)/r.width*(end-start));};
for(const id of ['paletteOrder','topN','zoom'])$(id).onchange=render;
for(const id of ['hueMerge','neutralSat','accentSat','accentMinArea'])$(id).oninput=syncOutputs;
for(const id of ['hueMerge','neutralSat','accentSat','accentMinArea','sampleInterval','sampleSize'])$(id).addEventListener('change',()=>{if(project)status('設定変更は「設定を適用して別解析」で反映します。');});
$('applySettingsBtn').onclick=async()=>{if(!sourceFile){status('設定を適用するには元ファイルを開いてください。');return;}try{const file=sourceFile,handle=sourceHandle;await persistProject();await loadFile(file,handle);}catch(e){fail(e);}};
$('exportJsonBtn').onclick=exportJSON;$('exportCsvBtn').onclick=exportCSV;$('exportPngBtn').onclick=exportPNG;
$('copyDiagnosticsBtn').onclick=copyDiagnostics;
for(const id of ['hueSaturation','hueBrightness','hueSmoothing','hueScale'])$(id).addEventListener('input',render);
$('exportHueBtn').onclick=()=>$('hueRing').toBlob(blob=>{if(blob)download('hue-ring.png','image/png',blob);},'image/png');
$('importJsonBtn').onclick=()=>$('importJsonFile').click();$('importJsonFile').onchange=e=>{const file=e.target.files[0];if(file)importJSON(file).catch(fail).finally(()=>{e.target.value='';});};
window.addEventListener('resize',render);window.addEventListener('pagehide',()=>{persistProject().catch(()=>{});});
$('startBtn').disabled=true;syncOutputs();render();
refreshProjects().then(()=>{$('storageStatus').textContent='解析結果はこのブラウザーのIndexedDBに保存。元動画は保存しません。';}).catch(e=>{storageOK=false;$('storageStatus').textContent='ブラウザー保存を使用できません。';fail(e);});
