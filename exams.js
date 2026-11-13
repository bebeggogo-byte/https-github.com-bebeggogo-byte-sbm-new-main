// 국가시험 직후 컨설팅 일정표 — 국시원 공고가 나오면 end(시험 종료일)만 채우면 페이지가 자동 갱신된다.
// end: 'YYYY-MM-DD' 또는 null(미공고). season: 미공고일 때 보여줄 예년 시기.
window.NW_EXAMS=[
  {job:'간호사',season:'예년 1월 하순 (2026년은 1월 23일 시행, 2월 12일 발표)',end:null},
  {job:'임상병리사',season:'예년 12월',end:null},
  {job:'방사선사',season:'예년 12월',end:null},
  {job:'물리치료사',season:'예년 12월',end:null},
  {job:'작업치료사',season:'예년 12월',end:null},
  {job:'치과위생사',season:'예년 12월',end:null},
  {job:'보건의료정보관리사',season:'예년 12월',end:null},
  {job:'응급구조사',season:'국시원 공고 확인 후 안내',end:null}
];
(function(){
  var box=document.getElementById('examList'); if(!box) return;
  var now=new Date();
  box.innerHTML=window.NW_EXAMS.map(function(e){
    var when=e.season, badge='사전예약 중';
    if(e.end){
      var end=new Date(e.end+'T18:00:00+09:00'), d=Math.ceil((end-now)/864e5);
      when=e.end.replace(/-/g,'.')+' 시험';
      badge=d>0?('시험까지 D-'+d):(d>-21?'지금 바로 시작 가능':'상시 진행');
    }
    return '<div class="card exam"><span class="tagb">'+badge+'</span><h3>'+e.job+'</h3><p>'+when+'</p><a class="btn g" href="#reserve" data-job="'+e.job+'">시험 끝나고 바로 시작 예약</a></div>';
  }).join('');
  box.addEventListener('click',function(ev){
    var a=ev.target.closest('[data-job]'); if(!a) return;
    var s=document.getElementById('r-job'); if(s){ for(var i=0;i<s.options.length;i++) if(s.options[i].text===a.getAttribute('data-job')) s.selectedIndex=i; }
  });
})();
