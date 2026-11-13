// 기업·임용 캠페인 카드 다시 만들기
// 실행: node tools/campaign-fields/render.js (저장소 루트에서) → og/campaign-fields/*.png (1080x1350)
const path=require('path');const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1200,height:1500}});
await p.goto('file://'+path.join(__dirname,'cards.html'));await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(1500);
for(const id of ['corp-01','corp-02','teach-01','teach-02'])await p.locator('#'+id).screenshot({path:path.join(__dirname,'..','..','og','campaign-fields',id+'.png')});
await b.close()})();
