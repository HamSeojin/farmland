# 우리 땅 앱 (farmland-app)

어머니(디지털 소외, 안드로이드)용 농지 조회 웹앱. 순수 HTML/CSS/JS, 빌드 없음.
배포: https://hamseojin.github.io/farmland/ (GitHub Pages)

## 핵심 구조: 설정식 우리 땅 + 가족 코드

**앱 코드에는 지번이 하나도 없음.** 우리 땅 정보는 각자 폰의 localStorage에만 저장되고,
가족끼리는 "가족 코드"로 공유한다.

- `localStorage farmland_parcels`: 우리 땅 목록 (JSON 배열)
  스키마: `{jibun, jimok("답"|"전"), area(㎡, 지분반영), share("전부"|"1/2"|"1/3"),
  price(원/㎡|null), addr}`
- `localStorage farmland_family_code`: 마지막으로 쓴 가족 코드
- `localStorage farmland_pending`: 지도에서 고른 땅 임시 보관 (settings.html에서 이어서 등록)
- 가족 코드 API (중계 Worker `farmland-relay`):
  - `POST /api/family` `{"parcels":[...]}` → `{"code":"XXXXXXXX"}` (8자리)
  - `GET /api/family?code=XXXXXXXX` → `{"parcels":[...],"updated":"ISO"}`

## 서진님이 해야 할 3가지

### ① js/config.js에 VWorld 키 입력
`js/config.js` 파일을 열어 `여기에_VWorld_키_입력` 부분에 vworld.kr에서 발급받은
인증키를 입력하세요. (한 줄 교체, 약 30초)
- 키는 Referer(hamseojin.github.io) 잠금이라 페이지 소스에 보여도 다른 사이트에서 못 씀 (VWorld 정상 패턴)
- 키가 없어도 앱 대부분은 동작. 지도 필지 탭 선택만 안 됨 (그 경우 설정 화면의 "직접 입력" 사용)

### ② farmland/ 로 배포
이 폴더 내용을 GitHub Pages에 올리세요. (예: hamseojin.github.io 저장소에
`farmland/` 디렉토리로 푸시)

### ③ 첫 실행 시 우리 땅 등록 (서진님이 어머니 폰에서 1회)
1. 앱 첫 화면 → "우리 땅 등록하기" → settings.html
2. "지도에서 고르기" (VWorld 키 필요) 또는 "직접 입력"으로 땅 추가
3. "가족 코드 만들기" → 8자리 코드 표시
4. 어머니 폰에서 settings.html → "코드로 불러오기"에 코드 입력 → 끝

이후 땅이 바뀌면 서진님이 수정 후 가족 코드 다시 만들고, 어머니 폰에서 "다시 불러오기"

## 파일 구조

| 파일 | 설명 |
|---|---|
| index.html | 첫 화면 대시보드 (우리 토지 / 거래내역 / 경매·공매 / 전수조사) |
| settings.html | 우리 땅 설정 (목록·추가·삭제, 가족 코드 만들기/불러오기) — 서진님용 |
| map.html | 지도에서 찾기 (Leaflet + VWorld, 경매·공매 핀). `?mode=register`면 필지 탭 시 "이 땅 등록하기" 버튼 |
| trades.html | 인근 거래내역 목록 (최신순, 89건) |
| auctions.html | 인근 경매·공매 목록 (법원경매 / 온비드공매) + 다른 지역 실시간 검색 |
| census.html | 농지 전수조사 소식 (쉬운 우리말) |
| css/style.css | 공용 스타일 (rem 단위, 기본 20px) |
| js/config.js | VWorld API 키 (①에서 입력) |
| js/data.js | 지역 데이터 스냅샷 (실거래·경매·공매) — **자동 생성, 직접 수정 금지**. 우리 땅은 없음 |
| js/app.js | 면적 단위 토글(평/m²) + 우리 땅 localStorage 헬퍼 + 가족 코드 API + 금액 포맷 |
| js/map.js | 지도 로직 (WFS 필지 조회, 하단 시트, 등록 모드) |
| tools/build_data.py | js/data.js 재생성 스크립트 (월 1회 데이터 갱신용) |

## 데이터 갱신 (월 1회)

```bash
# 1. 실거래가 수집 (매월)
python3 ~/workspace/farmland-watch/bin/fetch_land_trades.py --deal_ymd 202610
# 2. 온비드 공매 수집 (data.go.kr 활용신청 승인 후)
python3 ~/workspace/farmland-watch/bin/fetch_onbid.py
# 3. 법원경매 수집 (매일 자동 수집 중: cron farmland-court-auction-daily)
python3 ~/workspace/farmland-watch/bin/fetch_court_auction.py
# 4. 앱 데이터 재생성
python3 tools/build_data.py   # history_5y.json + onbid_*.json + court_auction_*.json → js/data.js
```
생성 후 farmland/ 에 다시 배포. (전수조사 소식은 census.html 직접 수정)

수집 스크립트 상세:
- `fetch_onbid.py`: 온비드 공매정보 Open API (data.go.kr 활용신청 필요). 강릉·동해·삼척 토지, 재산유형 5종 순회.
  회차 선택: 입찰종료일 ≥ 오늘 중 가장 이른 회차를 현재가로, 더 낮은 후속 회차는 nextLowManwon/nextPeriod로 별도 기록
- `fetch_court_auction.py`: 법원경매정보 비공식 XHR. 춘천지방법원 강릉지원(B000261) 토지 → 강릉·동해·삼척 추림.
  호출 간 2초+ 간격, 10회 budget, 차단 감지 시 즉시 중단(exit 1). 실패하면 기존 JSON을 덮어쓰지 않음

## 면적 단위 토글
- 각 페이지 헤더에 "m²로 보기 / 평으로 보기" 큰 버튼
- 면적 표시는 `<span class="area" data-m2="7279"></span>` 형태, js/app.js가 렌더링
- 선택은 localStorage 저장, 기본값 **평**

## 주의사항
- VWorld API는 해외 IP를 차단함 → 이 VM에서 테스트 불가. **한국 폰 브라우저에서 첫 실행 시 확인 필수**
  (js/map.js 상단에 미검증 항목 주석으로 표시: 지오코딩 응답 구조, WFS 속성명, CORS/JSONP)
- 토지특성정보(ned) API는 경로 미확인으로 미구현. 임의 필지 공시지가는 "준비 중" 폴백
- 전 페이지 `<meta name="robots" content="noindex">` 적용됨, 개인 이름 표기 없음
- 앱 코드에 지번 하드코딩 금지 (이번 구조 변경의 핵심). 예시 문구의 "641-45" 같은 플레이스홀더만 허용
