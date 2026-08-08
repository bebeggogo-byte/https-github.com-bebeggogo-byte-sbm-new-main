# Nedabah Way 웹사이트

자발성으로 시작되는 거룩을 향한 공동체의 길

## 🌐 소개

네다바웨이(Nedabah Way)는 제주 기반 비영리 신앙 공동체입니다. 모임·교육·콘텐츠·실행 도구를 통해 삶의 방향과 리듬을 함께 세웁니다. 이 저장소는 정적 웹사이트(`nedabah.org`)의 소스입니다.

## 📁 프로젝트 구조

원페이지였던 사이트를 **카테고리별 개별 페이지**로 분리해, 각 프로그램을 독립된 검색·AI 노출 단위로 운영합니다.

```
/
├── index.html                 # 홈(브랜드 필러)
├── styles.css                 # 공용 스타일
├── category.css               # 카테고리 페이지 전용 스타일
├── script.js                  # 인터랙션
├── favicon.svg                # 파비콘(새싹 심볼)
├── sitemap.xml / robots.txt   # 검색 색인용
├── programs/
│   ├── index.html             # 프로그램 허브(카테고리 필러)
│   ├── sbm/                    # SBM 말씀묵상 모임
│   ├── leadership/            # 청소년 리더십 프로젝트
│   ├── iden/                  # IDEN 정체성 습관 설계
│   ├── perspective-notes/     # 관점 노트
│   ├── study-notes/           # 학습 노트
│   ├── ai-lab/                # AI 작업실
│   ├── automation/            # 자동화
│   ├── coaching/              # 강의·코칭
│   └── workshop/              # 기관 교육·워크숍
├── support/                   # 후원·참여·협력
└── docs/
    └── 네다바웨이-홍보전략-실행로드맵.md   # 마케팅 전략·실행 로드맵
```

각 카테고리 페이지 공통 요소: 고유 title/메타/canonical/OG, BreadcrumbList + FAQPage 구조화데이터, 타깃 페르소나, 단계형 흐름, FAQ, CTA, 형제 카테고리 교차 링크.

## 🚀 배포 (GitHub Pages + nedabah.org)

`main` 브랜치에 푸시되면 GitHub Actions(`.github/workflows/pages.yml`)가 자동으로 GitHub Pages에 배포합니다. 저장소 루트 전체가 그대로 정적 호스팅되므로, `programs/<카테고리>/index.html` 구조가 `nedabah.org/programs/<카테고리>/` 클린 URL로 서비스됩니다.

### 최초 1회 설정

1. Settings → Pages → Source: **GitHub Actions**
2. Settings → Pages → Custom domain: `nedabah.org`, Enforce HTTPS
3. DNS A 레코드 4개(`185.199.108~111.153`), `www` CNAME → `<username>.github.io`

### 평소 업데이트 흐름

1. 해당 파일 수정 → 커밋 → `main` push
2. 약 1~2분 후 자동 반영

## ✏️ 카테고리 추가 방법

1. `programs/<slug>/index.html`을 기존 카테고리 페이지를 템플릿 삼아 생성
2. `sitemap.xml`에 URL 추가
3. `programs/index.html` 허브와 홈 프로그램 그리드에 링크 추가
4. 커밋·푸시

## 📈 마케팅 전략

검색·AI 노출, 9단계 심리 흐름, 24단계 실행 로드맵, 전략/실행 평가 루브릭은
`docs/네다바웨이-홍보전략-실행로드맵.md`를 참고하세요.

## 🔧 기술 스택

HTML5 · CSS3(Grid/Flexbox) · Vanilla JS · Google Fonts(Noto Serif KR, Crimson Pro) · 구조화데이터(JSON-LD)

## 📄 라이선스 / 문의

© 2026 Nedabah Way. All rights reserved. · [email protected]
