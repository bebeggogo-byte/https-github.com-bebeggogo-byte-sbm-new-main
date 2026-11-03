# IndexNow — Bing·AI검색에 즉시 색인 요청 (무료, 계정 불필요)

IndexNow는 새 URL을 Bing·Yandex 등에 **즉시 알려** 색인을 앞당기는 무료 프로토콜입니다.
Bing 색인은 ChatGPT·Copilot 같은 AI 검색 인용의 토대라 GEO에 직접 도움이 됩니다.

## 설정 (이미 완료)

- 인증 키 파일: `https://nedabah.org/b38915ecec8d382d6267bcf1d19326e3.txt`
  (파일 내용 = 키값 `b38915ecec8d382d6267bcf1d19326e3`)
- 이 파일이 라이브여야 제출이 인증됩니다. → **main 배포 후** 아래를 실행하세요.

## 제출 방법 1 — 한 번에 전체 (권장)

배포 완료 후, 인터넷 되는 곳에서 아래 명령 한 줄을 실행하면 전 URL이 제출됩니다.

```bash
curl -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json" \
  -d '{
    "host": "nedabah.org",
    "key": "b38915ecec8d382d6267bcf1d19326e3",
    "keyLocation": "https://nedabah.org/b38915ecec8d382d6267bcf1d19326e3.txt",
    "urlList": [
      "https://nedabah.org/",
      "https://nedabah.org/faq/",
      "https://nedabah.org/notes/",
      "https://nedabah.org/notes/references/",
      "https://nedabah.org/programs/",
      "https://nedabah.org/programs/sbm/",
      "https://nedabah.org/programs/sbm/read-together/",
      "https://nedabah.org/programs/sbm/honest-sharing/",
      "https://nedabah.org/programs/leadership/",
      "https://nedabah.org/programs/leadership/finish-what-you-start/",
      "https://nedabah.org/programs/leadership/praise-the-process/",
      "https://nedabah.org/programs/iden/",
      "https://nedabah.org/programs/iden/identity-habits/",
      "https://nedabah.org/programs/iden/environment-design/",
      "https://nedabah.org/programs/perspective-notes/",
      "https://nedabah.org/programs/perspective-notes/reframing/",
      "https://nedabah.org/programs/perspective-notes/confirmation-bias/",
      "https://nedabah.org/programs/study-notes/",
      "https://nedabah.org/programs/study-notes/remember-what-you-learn/",
      "https://nedabah.org/programs/study-notes/one-line-summary/",
      "https://nedabah.org/programs/ai-lab/",
      "https://nedabah.org/programs/ai-lab/first-ai-task/",
      "https://nedabah.org/programs/ai-lab/how-to-prompt/",
      "https://nedabah.org/programs/automation/",
      "https://nedabah.org/programs/automation/start-automation/",
      "https://nedabah.org/programs/automation/what-to-automate/",
      "https://nedabah.org/programs/coaching/",
      "https://nedabah.org/programs/coaching/power-of-questions/",
      "https://nedabah.org/programs/coaching/active-listening/",
      "https://nedabah.org/programs/workshop/",
      "https://nedabah.org/programs/workshop/why-workshops-stick/",
      "https://nedabah.org/programs/workshop/make-it-stick/",
      "https://nedabah.org/support/"
    ]
  }'
```

성공 시 HTTP 200 또는 202가 돌아옵니다.

## 제출 방법 2 — 브라우저로 한 개씩 (가장 쉬움)

아래 주소를 브라우저 주소창에 붙여넣으면 홈이 제출됩니다. URL만 바꿔 반복하세요.

```
https://www.bing.com/indexnow?url=https://nedabah.org/&key=b38915ecec8d382d6267bcf1d19326e3
```

> 한 번 제출하면 끝이 아니라, 새 글을 올릴 때마다 그 URL을 제출하면 색인이 빨라집니다.
