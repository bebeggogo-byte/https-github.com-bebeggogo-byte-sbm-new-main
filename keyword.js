// 아우라토 키워드 자가 테스트. 입력 내용은 브라우저 안에서만 계산하고 서버로 보내지 않는다.
(function(){
  var app=document.getElementById('kwApp'); if(!app) return;
  var VAL=['책임','존중','협력','소통','정확성','공감','성실','도전','배려','공정','안전','신뢰','끈기','주도성','나눔','성장'];
  var STR=['설명력','관찰력','경청','조율력','꼼꼼함','실행력','분석력','침착함','체계성','친화력','학습력','기록력','판단력','인내력','리더십','문제해결력'];
  var MAX=5, MIN=3, n=0;
  function chips(name,list,i){ return list.map(function(w){ return '<label><input type="checkbox" name="'+name+i+'" value="'+w+'"><span>'+w+'</span></label>'; }).join(''); }
  function addRow(){
    if(n>=MAX) return; var i=n++;
    var d=document.createElement('fieldset'); d.className='kwrow';
    d.innerHTML='<legend>경험 '+(i+1)+'</legend>'
      +'<label class="kl" for="kx'+i+'">무엇을 했나요(한 줄)</label><input type="text" id="kx'+i+'" maxlength="60" placeholder="예: 병동 실습에서 환자에게 검사 절차를 설명했다">'
      +'<div class="kl">이 경험에서 중요하게 여긴 것(2개까지)</div><div class="pick" data-g="v">'+chips('v',VAL,i)+'</div>'
      +'<div class="kl">이 경험에서 내가 잘한 것(2개까지)</div><div class="pick" data-g="s">'+chips('s',STR,i)+'</div>';
    rows.appendChild(d); addBtn.hidden=n>=MAX;
  }
  app.innerHTML='<div id="kwRows"></div><div class="btns" style="margin-top:1rem"><button type="button" class="btn g" id="kwAdd">경험 추가</button><button type="button" class="btn p" id="kwGo">키워드 집계하기</button></div><p id="kwMsg" role="alert" style="color:#e5484d;font-weight:700"></p>';
  var rows=document.getElementById('kwRows'), addBtn=document.getElementById('kwAdd'), msg=document.getElementById('kwMsg');
  for(var k=0;k<MIN;k++) addRow();
  addBtn.addEventListener('click',addRow);
  rows.addEventListener('change',function(e){
    var p=e.target.closest('.pick'); if(!p) return;
    var on=p.querySelectorAll('input:checked'); if(on.length>2){ e.target.checked=false; }
  });
  function top(map){ return Object.keys(map).sort(function(a,b){ return map[b]-map[a]||a.localeCompare(b,'ko'); }).slice(0,3).map(function(w){ return {w:w,c:map[w]}; }); }
  document.getElementById('kwGo').addEventListener('click',function(){
    var v={}, s={}, exps=[];
    rows.querySelectorAll('.kwrow').forEach(function(r){
      var t=r.querySelector('input[type=text]').value.trim();
      var vs=r.querySelectorAll('[data-g="v"] input:checked'), ss=r.querySelectorAll('[data-g="s"] input:checked');
      if(!t||!vs.length||!ss.length) return;
      exps.push(t); vs.forEach(function(x){ v[x.value]=(v[x.value]||0)+1; }); ss.forEach(function(x){ s[x.value]=(s[x.value]||0)+1; });
    });
    if(exps.length<MIN){ msg.textContent='경험을 3개 이상 적고, 경험마다 단어를 1개 이상 골라 주세요. 지금 완성된 경험은 '+exps.length+'개입니다.'; return; }
    msg.textContent='';
    var tv=top(v), ts=top(s);
    var last=tv[tv.length-1].w, code=last.charCodeAt(last.length-1), josa=((code-0xAC00)%28)?'을':'를';
    var first='저는 '+tv.map(function(x){return x.w;}).join(', ')+josa+' 중요하게 여기는 지원자입니다. 저의 강점은 '+ts[0].w+'입니다. 이 강점은 다음 경험에서 확인했습니다. '+exps[0].replace(/[.。]$/,'')+'.';
    var sec=document.getElementById('result'), out=document.getElementById('kwResult');
    function list(a){ return a.map(function(x){ return '<span class="kwchip">'+x.w+'<small>경험 '+exps.length+'개 중 '+x.c+'개</small></span>'; }).join(''); }
    out.innerHTML='<div class="kwcard"><div class="lab">핵심가치 키워드</div><div class="kwline">'+list(tv)+'</div><div class="lab" style="margin-top:1rem">강점 키워드</div><div class="kwline">'+list(ts)+'</div>'
      +'<div class="lab" style="margin-top:1rem">자기소개 첫 문장(초안)</div><p class="kwfirst">'+first.replace(/</g,'&lt;')+'</p></div>'
      +'<p class="src">집계 기준: 완성한 경험 '+exps.length+'개에서 단어가 선택된 횟수. 횟수가 같으면 가나다순입니다. 초안 문장은 그대로 쓰지 말고 본인의 말로 고쳐 쓰세요.</p>'
      +'<div class="btns"><button type="button" class="btn p" id="kwSave">키워드 카드 이미지 저장</button><button type="button" class="btn g" id="kwShare">테스트 링크 보내기</button><a class="btn g" href="#pro">컨설턴트 분석 사전 신청</a></div><p id="kwShareDone" hidden style="color:var(--ok);font-weight:700">링크를 복사했습니다</p>';
    sec.hidden=false; sec.scrollIntoView({behavior:'smooth'});
    var hid=document.getElementById('k-kw'); if(hid) hid.value='가치 '+tv.map(function(x){return x.w;}).join('·')+' / 강점 '+ts.map(function(x){return x.w;}).join('·');
    document.getElementById('kwSave').addEventListener('click',function(){ card(tv,ts); });
    document.getElementById('kwShare').addEventListener('click',function(){
      var u=location.origin+'/keyword/?utm_source=share&utm_medium=friend&utm_campaign=keyword', t='내 경험에서 나만의 키워드 3개를 뽑는 무료 테스트(3분).';
      if(navigator.share){ navigator.share({title:'아우라토 키워드',text:t,url:u}).catch(function(){}); }
      else if(navigator.clipboard){ navigator.clipboard.writeText(t+' '+u).then(function(){ document.getElementById('kwShareDone').hidden=false; }); }
    });
  });
  function card(tv,ts){
    var c=document.createElement('canvas'); c.width=1080; c.height=1350; var x=c.getContext('2d');
    var F="'Pretendard Variable','Pretendard','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif";
    x.fillStyle='#fff'; x.fillRect(0,0,1080,1350);
    x.fillStyle='#2f6bff'; x.font='700 34px '+F; x.fillText('AURATO 아우라토 · 나의 키워드',80,130);
    x.fillStyle='#2f6bff'; x.fillRect(80,170,72,6);
    x.fillStyle='#8b95a1'; x.font='600 34px '+F; x.fillText('핵심가치',80,290);
    x.fillStyle='#191f28'; x.font='800 92px '+F; tv.forEach(function(k,i){ x.fillText(k.w,80,400+i*118); });
    x.fillStyle='#8b95a1'; x.font='600 34px '+F; x.fillText('강점',80,810);
    x.fillStyle='#2f6bff'; x.font='800 92px '+F; ts.forEach(function(k,i){ x.fillText(k.w,80,920+i*118); });
    x.fillStyle='#e5e8eb'; x.fillRect(80,1230,920,2);
    x.fillStyle='#4e5968'; x.font='500 30px '+F; x.fillText('내 경험에서 뽑은 키워드 · 무료 테스트',80,1290);
    x.fillStyle='#2f6bff'; x.textAlign='right'; x.fillText('nedabah.org/keyword',1000,1290);
    var a=document.createElement('a'); a.download='aurato-keyword.png'; a.href=c.toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove();
  }
})();
