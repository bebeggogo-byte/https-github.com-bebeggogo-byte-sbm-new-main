// 제안 슬라이드, 팝업 이미지, 공유 이미지 다시 만들기
// 실행: node tools/proposal/render.js (저장소 루트에서)
const path=require('path');const {chromium}=require('playwright');
const og=path.join(__dirname,'..','..','og');
const OUT=[['s01','proposal/01.png'],['s02','proposal/02.png'],['s03','proposal/03.png'],['s04','proposal/04.png'],['s05','proposal/05.png'],['s06','proposal/06.png'],
 ['promo','promo-1080x1350.png'],['afterexam-v','after-exam-1080x1350.png'],['og-consulting','consulting.png'],['og-afterexam','after-exam.png']];
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1700,height:1500}});
await p.goto('file://'+path.join(__dirname,'slides.html'));await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(1500);
for(const [id,f] of OUT){await p.locator('#'+id).screenshot({path:path.join(og,f)});console.log('저장: og/'+f);}
await b.close()})();
