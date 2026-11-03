export function editRegions(image,initial,onSave){
 const dialog=document.createElement('dialog');dialog.className='region-dialog';
 dialog.innerHTML=`<h2>目を引く領域を囲む</h2><p>画像をクリックして頂点を追加し、3点以上で「領域を確定」。複数の領域を追加できます。重なっても重みは増えません。</p><canvas></canvas><div class="region-actions"><button data-action="undo">頂点を戻す</button><button data-action="finish">領域を確定</button><button data-action="remove">最後の領域を削除</button><button data-action="clear">全領域を消去</button></div><label>内側の重み <output></output><input type="range" min="1" max="8" step="0.5"></label><p class="region-message" role="status"></p><div class="region-actions"><button data-action="cancel">キャンセル</button><button data-action="save">保存して再解析</button></div>`;
 document.body.append(dialog);let polygons=structuredClone(initial?.polygons||[]),draft=[];
 const canvas=dialog.querySelector('canvas'),ctx=canvas.getContext('2d'),slider=dialog.querySelector('input'),message=dialog.querySelector('.region-message');slider.value=initial?.weight||3;
 const scale=Math.min(1,900/image.naturalWidth,650/image.naturalHeight);canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
 function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);for(const [points,closed] of [...polygons.map(p=>[p,true]),[draft,false]]){if(!points.length)continue;ctx.beginPath();points.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x*canvas.width,y*canvas.height));if(closed){ctx.closePath();ctx.fillStyle='#70e0bd40';ctx.fill();}ctx.strokeStyle=closed?'#70e0bd':'#ffcb65';ctx.lineWidth=2;ctx.stroke();for(const [x,y] of points){ctx.beginPath();ctx.arc(x*canvas.width,y*canvas.height,3,0,7);ctx.fillStyle='#ffcb65';ctx.fill();}}dialog.querySelector('output').textContent=slider.value+'倍';message.textContent=`確定済み ${polygons.length}領域 · 描画中 ${draft.length}点。外側は1倍。5色の選定と表示比率に適用（色相リングは全画面のまま）。`;}
 canvas.onclick=e=>{const r=canvas.getBoundingClientRect();draft.push([Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))]);draw();};slider.oninput=draw;
 dialog.addEventListener('close',()=>dialog.remove());
 dialog.onclick=e=>{const action=e.target.dataset.action;if(!action)return;
 if(action==='cancel'){dialog.close();return;}if(action==='undo')draft.pop();if(action==='remove')polygons.pop();if(action==='clear'){polygons=[];draft=[];}
 if(action==='finish'){if(draft.length<3){message.textContent='3点以上を指定してください。';return;}polygons.push(draft);draft=[];}
 if(action==='save'){if(draft.length){message.textContent='描画中の領域を確定するか、頂点を戻してください。';return;}onSave({polygons,weight:+slider.value});dialog.close();return;}draw();};
 dialog.showModal();draw();
}
