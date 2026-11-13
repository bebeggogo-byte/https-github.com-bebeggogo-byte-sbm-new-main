#!/usr/bin/env python3
"""tools/exam-data.json을 고친 뒤 실행하면 exams.js의 데이터 부분을 갱신한다.
달력 페이지(calendar/index.html)의 표는 같은 데이터로 다시 만들어야 하므로, 날짜를 바꾸면 담당 작업자에게 페이지 재생성을 요청한다."""
import json,re
items=json.load(open('tools/exam-data.json',encoding='utf-8'))['items']
s=open('exams.js',encoding='utf-8').read()
s=re.sub(r'window\.NW_EXAMS=\[.*?\];',lambda m:'window.NW_EXAMS='+json.dumps(items,ensure_ascii=False,indent=1)+';',s,count=1,flags=re.S)
open('exams.js','w',encoding='utf-8').write(s)
print('exams.js 갱신:',len(items),'건')
