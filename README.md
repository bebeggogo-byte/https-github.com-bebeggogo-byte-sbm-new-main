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

## 🚀 GitHub Pages 배포 방법

### 1. GitHub 저장소 생성

1. GitHub에 로그인
2. 새 저장소 생성 (예: `nedabaway-website`)
3. Public으로 설정

### 2. 파일 업로드

**방법 A: GitHub 웹 인터페이스 사용**
1. 저장소 페이지에서 "Add file" > "Upload files" 클릭
2. `index.html`, `styles.css`, `script.js` 파일을 드래그 앤 드롭
3. "Commit changes" 클릭

**방법 B: Git 명령어 사용**
```bash
git init
git add .
git commit -m "Initial commit: Nedabaway website"
git branch -M main
git remote add origin https://github.com/사용자명/저장소명.git
git push -u origin main
```

### 3. GitHub Pages 활성화

1. 저장소 Settings 이동
2. 왼쪽 메뉴에서 "Pages" 선택
3. Source에서 "Deploy from a branch" 선택
4. Branch를 "main"으로 설정하고 폴더는 "/ (root)" 선택
5. "Save" 클릭

### 4. 웹사이트 접속

- 약 1-2분 후 `https://사용자명.github.io/저장소명/` 에서 웹사이트 확인 가능
- Settings > Pages에서 배포된 URL 확인 가능

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
