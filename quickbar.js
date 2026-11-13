// 아우라토 우측 컨트롤 바: 퍼널 단계 바로가기 + 스크롤 진행 표시
(function(){
  if(document.getElementById('aqb')) return;
  var here=location.pathname;
  var items=[
    {t:'신청',s:'10만원~',h:'/consulting/#apply',k:'apply',p:1},
    {t:'가격',s:'연말 할인',h:'/consulting/#price',k:'price'},
    {t:'진행 과정',s:'순서·가격',h:'/consulting/process/',k:'process'},
    {t:'지원 기관',s:'목록 보기',h:'/references/',k:'refs'},
    {t:'시험 달력',s:'사전예약',h:'/calendar/',k:'exam'},
    {t:'학교·기관',s:'견적 요청',h:'/colleges/#quote',k:'b2b'},
    {t:'DM 문의',s:'인스타',h:'https://instagram.com/nedabah_way',k:'dm',x:1}
  ];
  var css='#aqb{position:fixed;right:14px;top:50%;transform:translateY(-50%);z-index:60;display:flex;flex-direction:column;gap:6px;font-family:inherit}'
  +'#aqb a{display:block;width:76px;padding:9px 4px;border-radius:12px;background:#fff;border:1px solid #e5e8eb;color:#191f28;text-decoration:none;text-align:center;font-weight:800;font-size:13px;line-height:1.25;transition:transform .15s}'
  +'#aqb a small{display:block;font-weight:500;font-size:10.5px;color:#8b95a1;margin-top:2px}'
  +'#aqb a:hover{transform:translateX(-3px)}'
  +'#aqb a.p{background:#2f6bff;border-color:#2f6bff;color:#fff}#aqb a.p small{color:#dbe5fb}'
  +'#aqb button{width:76px;padding:7px 0;border-radius:12px;border:1px solid #e5e8eb;background:#191f28;color:#fff;font-weight:800;font-size:12px;cursor:pointer}'
  +'#aqb .pg{width:76px;height:5px;border-radius:3px;background:#e5e8eb;overflow:hidden}#aqb .pg i{display:block;height:100%;width:0;background:#2f6bff}'
  +'#aqb .d{font-size:10.5px;text-align:center;color:#e5484d;font-weight:800;background:#fff;border-radius:8px;padding:3px 0;border:1px solid #e5e8eb}'
  +'@media(max-width:1100px){#aqb{display:none}}@media print{#aqb{display:none}}';
  var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
  var bar=document.createElement('nav'); bar.id='aqb'; bar.setAttribute('aria-label','바로가기');
  var end=new Date('2026-12-31T23:59:59+09:00'), d=Math.ceil((end-new Date())/864e5);
  var html=d>0?'<div class="d">마감 D-'+d+'</div>':'';
  items.forEach(function(it){
    var same=it.h.split('#')[0]===here && it.h.indexOf('#')>-1;
    var href=same?('#'+it.h.split('#')[1]):it.h;
    html+='<a'+(it.p?' class="p"':'')+' href="'+href+'" data-qb="'+it.k+'"'+(it.x?' target="_blank" rel="noopener"':'')+'>'+it.t+'<small>'+it.s+'</small></a>';
  });
  html+='<div class="pg" aria-hidden="true"><i></i></div><button type="button" aria-label="맨 위로">TOP ↑</button>';
  bar.innerHTML=html; document.body.appendChild(bar);
  bar.querySelector('button').addEventListener('click',function(){ window.scrollTo({top:0,behavior:'smooth'}); });
  var pg=bar.querySelector('.pg i');
  var onS=function(){ var h=document.documentElement, m=h.scrollHeight-h.clientHeight; pg.style.width=(m>0?Math.min(100,h.scrollTop/m*100):0)+'%'; };
  window.addEventListener('scroll',onS,{passive:true}); onS();
})();
