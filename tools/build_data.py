#!/usr/bin/env python3
"""history_5y.json + 경매·공매 JSON -> js/data.js 생성. 월 1회 데이터 갱신 시 재실행."""
import glob
import json
import os
from pathlib import Path

APP = Path.home() / "workspace" / "farmland-app"
SRC = Path.home() / "workspace" / "goals" / "goal-11" / "hidden_files" / "history_5y.json"
WATCH = Path.home() / "workspace" / "goals" / "goal-11" / "hidden_files"

def pyong(m2):
    return round(m2 / 3.305785)

trades = json.load(open(SRC))
# 최신순 정렬
trades.sort(key=lambda x: (x["deal_ymd"], x["date"]), reverse=True)

out = []
for t in trades:
    ymd = t["date"]  # YYYY-MM-DD
    y, m, d = ymd.split("-")
    amount = int(str(t["amount"]).replace(",", ""))  # 만원
    area = t["area"]
    per_m2 = round(amount / area) if area else 0
    out.append({
        "ym": f"{y}년 {int(m)}월",
        "date": f"{y}년 {int(m)}월 {int(d)}일",
        "jibun": t["jibun"],
        "jimok": t["jimok"],
        "area": area,
        "pyong": pyong(area),
        "amount": amount,
        "perM2": per_m2,
    })

def latest(pattern):
    """가장 최신 ym의 JSON 파일 로드. 없으면 빈 리스트."""
    files = sorted(glob.glob(str(WATCH / pattern)))
    if not files:
        return []
    try:
        return json.load(open(files[-1], encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"WARN {files[-1]} 읽기 실패: {exc}")
        return []


js = """/* 자동 생성됨 (tools/build_data.py). 직접 수정 금지. 기준일: 2026년 9월
   우리 땅(PARCELS)은 설정식 구조로 바뀌어 여기 두지 않음 (각자 폰 localStorage + 가족 코드 공유) */
const TRADES = %s;
const TRADE_COUNT = %d;
const AUCTIONS = %s;
""" % (json.dumps(out, ensure_ascii=False),
       len(out), json.dumps({
           "court": latest("court_auction_*.json"),
           "onbid": latest("onbid_*.json"),
       }, ensure_ascii=False))

(APP / "js" / "data.js").write_text(js, encoding="utf-8")
print(f"wrote js/data.js, {len(out)} trades")
auctions = json.loads(js.split("const AUCTIONS = ")[1].rstrip(";\n"))
print(f"auctions: court {len(auctions['court'])}건, onbid {len(auctions['onbid'])}건")
# 대시보드용 최신 정보 출력
print("latest:", out[0]["date"], out[0]["jibun"], out[0]["jimok"], out[0]["area"], out[0]["amount"])
months = sorted(set(t["ym"] for t in out), reverse=True)
print("months:", len(months), "| 2026년 9월 거래:", sum(1 for t in out if t["ym"] == "2026년 9월"))
