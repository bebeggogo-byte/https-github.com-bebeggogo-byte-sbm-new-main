// 제안 슬라이드 6장을 PDF 한 파일로 만들기
// 실행: node tools/proposal/pdf.js (저장소 루트에서) → og/proposal/aurato-proposal.pdf
const path=require('path');const fs=require('fs');const {chromium}=require('playwright');
const dir=path.join(__dirname,'..','..','og','proposal');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
const imgs=['01','02','03','04','05','06'].map(n=>'data:image/png;base64,'+fs.readFileSync(path.join(dir,n+'.png')).toString('base64'));
await p.setContent('<style>@page{size:1600px 900px;margin:0}body{margin:0}img{display:block;width:1600px;height:900px;page-break-after:always}</style>'+imgs.map(s=>'<img src="'+s+'">').join(''));
await p.pdf({path:path.join(dir,'aurato-proposal.pdf'),width:'1600px',height:'900px',printBackground:true});
await b.close();console.log('저장: og/proposal/aurato-proposal.pdf')})();
