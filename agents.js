/* =======================================================================
   내 AI 직원 명단  ──  이 파일만 고치면 대시보드가 자동으로 바뀝니다.
   네이밍 규칙:  김OO = 그 분야 현재 1등 도구
   mode:  "api"    → 클로드/코드 등 자동 연동 가능
          "manual" → 아직 손으로 쓰는 도구 (대시보드는 사용법 카드로 안내)
   status: "작업중" | "대기" | "완료"
   ======================================================================= */

const TEAM = [
  {
    name:"김클로드", tool:"Claude", role:"팀장 · 총괄/기획",
    zone:"PM", color:"#d97757", mode:"api",
    best:["전략·기획","긴 글·카피라이팅","일 쪼개고 결과 취합","판단·의사결정"],
    use:"막막할 때 제일 먼저. 일을 나누고, 다른 직원 결과물을 합쳐 최종본으로.",
    status:"작업중", task:"이번 주 콘텐츠 캘린더 기획"
  },
  {
    name:"김클코", tool:"Claude Code", role:"개발자",
    zone:"개발", color:"#5b8def", mode:"api",
    best:["웹사이트·앱 코드","버그 수정","자동화 스크립트","이 대시보드 유지보수"],
    use:"코드가 필요한 모든 것. 페이지 제작, 결제 버그, 데이터 처리.",
    status:"작업중", task:"리뷰 이벤트 페이지 제작"
  },
  {
    name:"김구글", tool:"Gemini · Google", role:"리서치 · SEO",
    zone:"마케팅", color:"#3aa564", mode:"api",
    best:["실시간 검색","사실 확인","SEO 키워드","경쟁사 조사"],
    use:"최신 정보·근거가 필요할 때. 키워드 리서치, 트렌드 파악.",
    status:"작업중", task:"블로그 SEO 키워드 리서치"
  },
  {
    name:"김노엘", tool:"NotebookLM", role:"자료 정리 담당",
    zone:"문서", color:"#c79bf0", mode:"manual",
    best:["내 문서 수십 개 → 요약","출처 기반 Q&A","대본·개요 추출","팟캐스트화"],
    use:"자료 더미를 던지면 요약·정리. 회의록·논문·기존 글 종합.",
    status:"대기", task:null
  },
  {
    name:"김감마", tool:"Gamma", role:"문서 · 발표자료",
    zone:"문서", color:"#f0b24a", mode:"manual",
    best:["제안서","발표 슬라이드","원페이저","랜딩 초안"],
    use:"보여줄 자료가 필요할 때. 한 줄 주제 → 슬라이드 한 벌.",
    status:"대기", task:null
  },
  {
    name:"김미드", tool:"Midjourney", role:"이미지 디자이너",
    zone:"마케팅", color:"#e57aa0", mode:"manual",
    best:["썸네일","포스터","비주얼 컨셉","무드보드"],
    use:"그림·이미지가 필요할 때. 블로그 대표이미지, 광고 비주얼.",
    status:"완료", task:null
  },
  {
    name:"김엔에잇", tool:"n8n", role:"자동화 엔지니어",
    zone:"개발", color:"#5ec9c9", mode:"manual",
    best:["도구 사이 연결","반복작업 자동화","폼 접수 → 알림","스케줄 실행"],
    use:"손이 자꾸 가는 반복일. 새 신청 오면 시트 기록+메일 발송 같은 흐름.",
    status:"대기", task:null
  }
];

/* 필요할 때 채용하는 대기 인력 (＋직원 채용 버튼으로 투입) */
const BENCH = [
  { name:"김런웨", tool:"Runway", role:"영상 제작", zone:"마케팅", color:"#9aa6f0", mode:"manual",
    best:["짧은 영상 생성","이미지→영상","광고 영상"], use:"영상 클립이 필요할 때.", status:"대기", task:null },
  { name:"김일레븐", tool:"ElevenLabs", role:"성우 · 더빙", zone:"마케팅", color:"#e08a5a", mode:"manual",
    best:["내레이션","더빙","음성 클로닝"], use:"목소리·내레이션이 필요할 때.", status:"대기", task:null },
  { name:"김퍼플", tool:"Perplexity", role:"출처 리서치", zone:"마케팅", color:"#5ec9c9", mode:"api",
    best:["출처 박힌 답","논문·뉴스 조사"], use:"근거 링크가 꼭 필요할 때.", status:"대기", task:null },
  { name:"김캡컷", tool:"CapCut", role:"숏폼 편집", zone:"마케팅", color:"#7bc47f", mode:"manual",
    best:["릴스·쇼츠 편집","자막","템플릿"], use:"숏폼 편집이 필요할 때.", status:"대기", task:null },
  { name:"김피그마", tool:"Figma", role:"UI 디자이너", zone:"개발", color:"#c79bf0", mode:"manual",
    best:["UI 시안","디자인 시스템","프로토타입"], use:"화면 디자인을 정밀하게.", status:"대기", task:null }
];
