#!/usr/bin/env python3
"""tools/exam-data.json → exams.js 데이터와 calendar/index.html의 일정 표를 다시 만든다.
사용: python3 tools/build-calendar.py"""
import json,re,datetime,html
d=json.load(open('tools/exam-data.json',encoding='utf-8')); items=d['items']
today=datetime.date.fromisoformat(d['updated'])
s=open('exams.js',encoding='utf-8').read()
s=re.sub(r'window\.NW_EXAMS=\[.*?\];',lambda m:'window.NW_EXAMS='+json.dumps(items,ensure_ascii=False,indent=1)+';',s,count=1,flags=re.S)
open('exams.js','w',encoding='utf-8').write(s)
def f(x):
    y,m,dd=x.split('-'); return '%s. %d. %d.'%(y,int(m),int(dd))
def start(x):
    t=datetime.date.fromisoformat(x)
    if t<today: return '지금 시작 가능'
    t+=datetime.timedelta(days=1); return '%d. %d. %d.'%(t.year,t.month,t.day)
months={}
for e in items:
    if e['exam']: months.setdefault(e['exam'][:7],[]).append(e)
rows=''
for ym in sorted(months):
    y,m=ym.split('-')
    rows+='<h3 class="rg" style="font-size:1.15rem;color:var(--ink);margin-top:1.6rem">%s년 %d월</h3>\n<table class="cmp"><thead><tr><th>시험</th><th>시험일</th><th>합격 발표·다음 일정</th><th>컨설팅 시작 가능일</th><th>준비 내용</th></tr></thead><tbody>\n'%(y,int(m))
    for e in sorted(months[ym],key=lambda x:x['exam']):
        nxt=(f(e['result'])+(' · '+e['season'] if e['season'] else '')) if e['result'] else (e['season'] or '공고 확인 후 안내')
        rows+='<tr><td><b>%s</b><br><span style="font-size:.82rem;color:var(--mut)">%s</span></td><td>%s</td><td>%s</td><td class="us">%s</td><td>%s</td></tr>\n'%(html.escape(e['job']),e['cat'],f(e['exam']),nxt,start(e['exam']),html.escape(e['focus']))
    rows+='</tbody></table>\n'
und='<table class="cmp"><thead><tr><th>시험</th><th>시기</th><th>준비 내용</th><th>일정 근거</th></tr></thead><tbody>\n'
for e in items:
    if not e['exam']:
        und+='<tr><td><b>%s</b><br><span style="font-size:.82rem;color:var(--mut)">%s</span></td><td>%s</td><td>%s</td><td>%s</td></tr>\n'%(html.escape(e['job']),e['cat'],e['season'],html.escape(e['focus']),e['src'])
und+='</tbody></table>'
c=open('calendar/index.html',encoding='utf-8').read()
c,n1=re.subn(r'<h3 class="rg" style="font-size:1\.15rem.*?(?=\s*<p class="src">출처:)',lambda m:rows.rstrip('\n'),c,count=1,flags=re.S)
c,n2=re.subn(r'(사전예약은 지금 할 수 있습니다\.</p>\n)<table class="cmp">.*?</table>',lambda m:m.group(1)+und,c,count=1,flags=re.S)
assert n1==1 and n2==1,(n1,n2)
open('calendar/index.html','w',encoding='utf-8').write(c)
print('갱신: 시험 %d건, 확정 %d건, 확인 중 %d건'%(len(items),sum(1 for e in items if e['exam']),sum(1 for e in items if not e['exam'])))
