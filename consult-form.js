// 컨설팅·기관 의뢰 폼 → ① Make 웹훅(시나리오 #8318069) → Notion「강의·코칭 의뢰 접수」DB
//                       ② FormSubmit → 운영자 메일 알림(Make와 별도 경로. 한쪽이 실패해도 다른 쪽이 도착한다)
(function(){
  var ENDPOINT='https://hook.eu1.make.com/y4hn30wkxapmynqh7hdeoocnfvbqcdjr';
  var MAIL='https://formsubmit.co/ajax/nedabah.way@gmail.com';
  document.querySelectorAll('form[data-consult]').forEach(function(f){
    f.addEventListener('submit',function(ev){
      ev.preventDefault();
      var fd=new FormData(f), memo=[];
      f.querySelectorAll('[data-memo]').forEach(function(el){
        if(el.type==='radio'&&!el.checked) return;
        var v=el.type==='checkbox'?(el.checked?'예':'아니오'):el.value;
        if(v) memo.push(el.getAttribute('data-memo')+': '+v);
      });
      var p=new URLSearchParams(location.search);
      ['utm_source','utm_medium','utm_campaign'].forEach(function(k){ if(p.get(k)) memo.push(k+': '+p.get(k)); });
      var data={name:fd.get('name')||'',org:fd.get('org')||'',topic:f.getAttribute('data-consult'),date:fd.get('date')||'',contact:fd.get('contact')||'',memo:memo.join('\n'),page:location.pathname+(document.referrer?' ← '+document.referrer:'')};
      try{ fetch(ENDPOINT,{method:'POST',mode:'no-cors',body:new URLSearchParams(data)}); }catch(e){}
      try{ var m=new URLSearchParams({_subject:'[아우라토 신청] '+data.name+' / '+data.topic,_template:'table',_captcha:'false','이름':data.name,'연락처':data.contact,'주제':data.topic,'소속':data.org,'희망 일정':data.date,'메모':data.memo,'페이지':data.page});
        fetch(MAIL,{method:'POST',mode:'no-cors',body:m}); }catch(e){}
      f.reset();
      var done=f.parentNode.querySelector('.done'); if(done){ done.hidden=false; done.scrollIntoView({block:'center'}); }
    });
  });
  // 프로모션 마감 카운트다운
  document.querySelectorAll('[data-share]').forEach(function(b){ b.addEventListener('click',function(){
    var u=location.origin+'/?utm_source=share&utm_medium=share&utm_campaign=yearend2026', t='아우라토 병원 취업 1:1 컨설팅. 화상 1:1 2회와 보고서, 1인 15만원(12월 31일 신청분까지).';
    if(navigator.share){ navigator.share({title:'아우라토 AURATO',text:t,url:u}).catch(function(){}); }
    else if(navigator.clipboard){ navigator.clipboard.writeText(t+' '+u).then(function(){ var d=b.parentNode.querySelector('[data-share-done]'); if(d) d.hidden=false; }); }
  }); });
  var END=new Date('2026-12-31T23:59:59+09:00');
  var el=document.getElementById('promoLeft');
  if(el){ var d=Math.ceil((END-new Date())/864e5); el.textContent=d>0?('마감까지 '+d+'일'):'프로모션 종료'; }
  var cd=document.querySelector('[data-countdown]');
  if(cd){ var tick=function(){ var t=Math.max(0,END-new Date()), v={d:Math.floor(t/864e5),h:Math.floor(t/36e5)%24,m:Math.floor(t/6e4)%60,s:Math.floor(t/1e3)%60};
    for(var k in v){ var e=cd.querySelector('[data-'+k+']'); if(e) e.textContent=(v[k]<10&&k!=='d'?'0':'')+v[k]; } };
    tick(); setInterval(tick,1000); }
})();
// 접힌 영역: 주소의 #id나 페이지 안 링크가 접힌 영역을 가리키면 펼친다
(function(){
  function openFor(id){ if(!id) return; var el=document.getElementById(id); if(!el) return;
    var d=el.matches('details')?el:(el.querySelector('details.acc.big')||el.closest('details'));
    while(d){ d.open=true; d=d.parentElement&&d.parentElement.closest('details'); }
    setTimeout(function(){ el.scrollIntoView({block:'start'}); },30); }
  window.addEventListener('hashchange',function(){ openFor(location.hash.slice(1)); });
  if(location.hash) openFor(location.hash.slice(1));
})();
