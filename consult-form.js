// 컨설팅·기관 의뢰 폼 → Make 웹훅(시나리오 #8318069) → Notion「강의·코칭 의뢰 접수」DB
(function(){
  var ENDPOINT='https://hook.eu1.make.com/y4hn30wkxapmynqh7hdeoocnfvbqcdjr';
  document.querySelectorAll('form[data-consult]').forEach(function(f){
    f.addEventListener('submit',function(ev){
      ev.preventDefault();
      var fd=new FormData(f), memo=[];
      f.querySelectorAll('[data-memo]').forEach(function(el){
        var v=el.type==='checkbox'?(el.checked?'예':'아니오'):el.value;
        if(v) memo.push(el.getAttribute('data-memo')+': '+v);
      });
      var p=new URLSearchParams(location.search);
      ['utm_source','utm_medium','utm_campaign'].forEach(function(k){ if(p.get(k)) memo.push(k+': '+p.get(k)); });
      var data={name:fd.get('name')||'',org:fd.get('org')||'',topic:f.getAttribute('data-consult'),date:fd.get('date')||'',contact:fd.get('contact')||'',memo:memo.join('\n'),page:location.pathname+(document.referrer?' ← '+document.referrer:'')};
      try{ fetch(ENDPOINT,{method:'POST',mode:'no-cors',body:new URLSearchParams(data)}); }catch(e){}
      f.reset();
      var done=f.parentNode.querySelector('.done'); if(done){ done.hidden=false; done.scrollIntoView({block:'center'}); }
    });
  });
  // 프로모션 마감 카운트다운
  var END=new Date('2026-12-31T23:59:59+09:00');
  var el=document.getElementById('promoLeft');
  if(el){ var d=Math.ceil((END-new Date())/864e5); el.textContent=d>0?('마감까지 '+d+'일'):'프로모션 종료'; }
  var cd=document.querySelector('[data-countdown]');
  if(cd){ var tick=function(){ var t=Math.max(0,END-new Date()), v={d:Math.floor(t/864e5),h:Math.floor(t/36e5)%24,m:Math.floor(t/6e4)%60,s:Math.floor(t/1e3)%60};
    for(var k in v){ var e=cd.querySelector('[data-'+k+']'); if(e) e.textContent=(v[k]<10&&k!=='d'?'0':'')+v[k]; } };
    tick(); setInterval(tick,1000); }
})();
