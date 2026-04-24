# Nedabah Way 웹사이트

자발성으로 시작되는 거룩을 향한 공동체의 길

## 🌐 웹사이트 정보

네다바웨이는 제주에서 활동하는 비영리 단체로, 신앙 공동체를 위한 교육·모임·콘텐츠를 제공합니다.

## 📋 프로젝트 구조

```
nedabaway/
├── index.html          # 메인 HTML 파일
├── styles.css          # 스타일시트
├── script.js           # JavaScript 기능
└── README.md          # 프로젝트 문서
```

## 🚀 배포 (GitHub Pages + nedabah.org)

이 저장소는 **`main` 브랜치에 푸시되는 즉시** GitHub Actions(`.github/workflows/pages.yml`)가 자동으로 GitHub Pages에 배포합니다. 별도 명령 불필요.

### 최초 1회 설정 (이미 했다면 건너뛰기)

1. **저장소 Settings → Pages**
   - Source: **GitHub Actions** 선택 (Deploy from a branch 아님)
2. **저장소 Settings → Pages → Custom domain**
   - `nedabah.org` 입력 → Save
   - "Enforce HTTPS" 체크
   - 저장소 루트의 `CNAME` 파일이 자동 인식됩니다
3. **DNS 레코드** (도메인 등록업체 관리 페이지에서 한 번만)
   - `A` 레코드 4개 → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `www` 서브도메인 → `CNAME` → `<github-username>.github.io`
4. 첫 배포 후 `Settings → Pages`에서 "Your site is published at https://nedabah.org" 확인

### 평소 업데이트 흐름

1. `index.html` (텍스트/프로그램/로드맵), `styles.css`, `script.js` 중 필요한 파일 수정
2. 커밋 + `main` 브랜치에 push
3. **약 1~2분 후 nedabah.org에 자동 반영** (Actions 탭에서 진행 상황 확인 가능)

### Drip Lines 구독 폼 연결 (선택)

`#drip-subscribe` 폼은 기본적으로 `mailto:` 로 동작합니다(사용자 메일 클라이언트가 열림). 진짜 자동 구독 접수를 원하면:

1. [Formspree](https://formspree.io) 등에서 무료 폼 엔드포인트 발급 (예: `https://formspree.io/f/xxxxxx`)
2. `index.html`에서 해당 폼의 `data-endpoint` 값에 붙여넣기:
   ```html
   <form id="drip-subscribe" ... data-endpoint="https://formspree.io/f/xxxxxx">
   ```
3. 커밋·푸시 후 자동 반영. 스크립트가 fetch POST로 전송하고, 성공 시 "구독 접수" UI로 바뀝니다.

### 업데이트가 안 보일 때 체크리스트

- [ ] Actions 탭에서 워크플로우가 **success**인지
- [ ] Settings → Pages 의 Source가 **GitHub Actions**로 설정돼 있는지
- [ ] 도메인이 다른 호스팅(Wix/Imweb/Cargo 등)을 가리키고 있지는 않은지 (DNS 점검)
- [ ] 브라우저 강제 새로고침 (Ctrl+Shift+R) 또는 시크릿 창에서 확인

## 🎨 디자인 특징

- **색상 팔레트**: 따뜻한 earth tone (모래색, 점토색, 돌색)
- **타이포그래피**: Noto Serif KR & Crimson Pro (세리프 폰트)
- **애니메이션**: 부드러운 fade-in, hover 효과
- **반응형**: 모바일, 태블릿, 데스크톱 대응

## ✏️ 내용 수정 방법

### 연락처 정보 업데이트
`index.html` 파일에서 다음 부분을 찾아 수정하세요:

```html
<!-- Footer 섹션의 연락처 정보 -->
<div class="footer-info">
    <h4>CONTACT</h4>
    <p>010-XXXX-XXXX<br>[email protected]</p>
</div>
<div class="footer-info">
    <h4>BANK ACCOUNT</h4>
    <p>OO은행<br>XXX-XXXXXX-XXXX</p>
</div>
```

### 프로그램 추가/수정
`index.html`의 `<section id="programs">` 부분에서 프로그램 카드를 추가/수정할 수 있습니다.

### 로드맵 변경
`<section id="roadmap">` 부분에서 분기별 계획을 업데이트할 수 있습니다.

## 🎯 향후 개선 사항

- [ ] 이미지 추가 (프로그램 사진, 활동 모습)
- [ ] 블로그/소식 섹션 추가
- [ ] 참여 신청 폼 연동
- [ ] 다국어 지원 (영어)
- [ ] SEO 최적화
- [ ] 소셜 미디어 링크 추가

## 📱 반응형 디자인

웹사이트는 다양한 화면 크기에 최적화되어 있습니다:
- 데스크톱: 1200px 이상
- 태블릿: 768px - 1199px
- 모바일: 767px 이하

## 🔧 기술 스택

- HTML5
- CSS3 (Grid, Flexbox, Animations)
- Vanilla JavaScript
- Google Fonts (Noto Serif KR, Crimson Pro)

## 📄 라이선스

© 2026 Nedabah Way. All rights reserved.

## 📞 문의

웹사이트 관련 문의사항이 있으시면 [email protected]으로 연락주세요.

---

Made with ❤️ for Nedabah Way Community
