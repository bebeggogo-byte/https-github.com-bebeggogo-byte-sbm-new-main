#!/usr/bin/env python3
"""가격·할인 수치 일관성 점검. 배포 전에 실행한다: python3 tools/check-numbers.py"""
import re,sys,glob
PRICE,LIST=150000,800000                 # 1인 금액, 정가
MKT_ITEM,MKT_ITEMS,MKT_INT30=15000,10,40000  # 시중 문항 단가, 예시 문항 수, 모의면접 30분
MKT_ACAD=300000                           # 취업학원 1:1 자소서 과정
combo=MKT_ITEM*MKT_ITEMS+MKT_INT30*2
def pct(a,b): return round((a-b)/a*100)
won=lambda n:format(n,',')
expected={  # (차액, 퍼센트) 허용 조합
 (won(combo-PRICE),pct(combo,PRICE)),(won(MKT_ACAD-PRICE),pct(MKT_ACAD,PRICE))}
must={won(combo):'시중 조합 합계',won(MKT_ITEM*MKT_ITEMS):'문항 첨삭 합계',won(MKT_INT30*2):'모의면접 60분',won(PRICE//2):'시간당 금액'}
ok_pct={'6.0','7.0','9.2','10.2','12.4','13','14.5','18.4','22','22.6','23.4','30.6','31','34','35.0','39.4','42','42.7','54.8','54.9','57.4','66.6','67','67.6','80','80.3','95.4'}|{str(p) for _,p in expected}
pages=['career/index.html','fields/index.html','index.html','consulting/index.html','consulting/process/index.html','consulting/after-exam/index.html','colleges/index.html','references/index.html','calendar/index.html','keyword/index.html','nursing/index.html','fields/civil-service/index.html','fields/public-sector/index.html','fields/social-work/index.html','fields/teacher/index.html','fields/corporate/index.html']
bad=0
for f in pages:
    s=re.sub(r'<style.*?</style>|<script(?! type="application/ld).*?</script>|style="[^"]*"','',open(f,encoding='utf-8').read(),flags=re.S)
    for d,p in re.findall(r'([\d,]+)원(?:이)? 낮(?:음|습니다)\((\d+)%\)',s):
        if (d,int(p)) not in expected: print('불일치',f,d,p); bad+=1
    for p in re.findall(r'(\d+(?:\.\d+)?)%',s):
        if p not in ok_pct: print('미등록 퍼센트',f,p+'%'); bad+=1
    for d,p2 in re.findall(r'([\d,]+)원 차이\((\d+)%\)',s):
        if (d,int(p2)) not in expected: print('불일치',f,d,p2); bad+=1
    for stale in ['79%','87.5','78.75','65% 할인','470,000','370,000','3,846','140,000','160,000','100,000','170,000','280,000','130,000','180,000','110,000','총 3인','총 2인','총 1인','10만원','17만원','28만원','8분의 1']:
        if stale in s: print('옛 수치',f,stale); bad+=1
    if 'class="tickets' in s and won(PRICE) not in s: print('가격 누락',f); bad+=1
p=open('consulting/process/index.html',encoding='utf-8').read()
for k,v in must.items():
    if k not in p: print('진행 과정 페이지 누락',v,k); bad+=1
print('계산 기준: 시중 조합가',won(combo),'/ 차이',sorted(expected))
print('결과:', '일치' if bad==0 else '불일치 %d건'%bad)
sys.exit(1 if bad else 0)
