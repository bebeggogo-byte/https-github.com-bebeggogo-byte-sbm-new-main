# 실제 카톡/이메일 물리기 — 쉬운 안내

복잡한 설정 없이, 카톡 대화를 파일로 내보내서 넣기만 하면 됩니다.

## 1단계 — 카톡 대화 내보내기 (파일로 저장)

**컴퓨터 카카오톡**
1. 강의 얘기가 오간 채팅방 열기
2. 오른쪽 위 메뉴(≡) → **대화 내용** → **대화 내용 저장(내보내기)** → 텍스트 파일(.txt)로 저장

**휴대폰 카카오톡**
1. 채팅방 → 오른쪽 위 메뉴 → **대화 내용 내보내기** → **텍스트 메시지만 내보내기**
2. 나에게 메일/메모로 보내서 .txt 파일을 컴퓨터로 옮기기

## 2단계 — 파일 넣고 한 줄 실행

저장한 파일이 예: `KakaoTalkChats.txt` 라면:

```bash
cd automation
python connectors/kakao_ingest.py KakaoTalkChats.txt -o inputs/messages.txt
python workflow.py init inputs/messages.txt
python workflow.py status
```

→ 강의 일정이 자동으로 잡히고, 진행판에 뜹니다. 잡담은 자동으로 걸러집니다.

## 3단계 — 진행 (검수만 눌러주면 됩니다)

```bash
python workflow.py run                 # 검수 지점까지 자동 진행
python workflow.py approve <강의id>     # 내용 확인 후 통과
python workflow.py run                 # 다음으로
```

바쁘면 무인 모드:
```bash
python workflow.py run --auto          # 검수 자동통과(경고 있는 일정만 멈춤), 발송은 안 함
```

## 이메일로 받는 경우 (선택)

Gmail 기준: 설정에서 **IMAP 사용** 켜고 **앱 비밀번호** 발급 후
```bash
export IMAP_HOST=imap.gmail.com EMAIL_USER=내메일 EMAIL_PASS=앱비밀번호
python connectors/email_ingest.py -o inputs/messages.txt
python workflow.py init inputs/messages.txt
```

## 막히면
- 파일이 안 열리거나 일정이 안 잡히면, 그 .txt 내용을 그대로 붙여넣어 주셔도 됩니다.
- 전체 단계 설명은 [PLAN.md](PLAN.md) 참고.
