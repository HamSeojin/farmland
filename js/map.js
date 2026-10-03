/* 지도 화면: Leaflet + VWorld WMTS 기본지도 + 지적도 WMS + 탭→WFS 필지 조회
 *
 * [미검증 표시] 이 VM은 해외 IP라 api.vworld.kr 호출이 차단되어 아래를 직접
 * 테스트하지 못했습니다. 한국 IP(어머니 폰) 브라우저에서 첫 실행 시 확인 필요:
 *  1) 지오코딩 응답 경로: json.response.result.point.{x,y} (문서 기준이나 미확인)
 *  2) WFS 속성명: properties.pnu / properties.jibun (LP_PA_CBND_BUBUN 레이어 기준, 미확인)
 *  3) WFS CORS: fetch가 막히면 JSONP(callback=) 방식으로 교체 필요
 *  4) TYPENAME 대소문자: 안 되면 'lp_pa_cbnd_bubun' 소문자로 시도
 * TODO(추후): 토지특성정보(ned 계열) API 경로 확인 후 임의 필지 공시지가 조회 추가.
 *   현재는 우리 땅 3필지(스냅샷)만 공시지가 표시, 그 외는 폴백 문구.
 */
(function () {
  "use strict";

  // ?mode=register: 설정 화면에서 "지도에서 고르기"로 온 경우. 필지 탭 시 등록 버튼 표시
  var REGISTER_MODE = /[?&]mode=register\b/.test(location.search);

  function parcels() {
    return (window.FarmlandApp && FarmlandApp.getParcels()) || [];
  }
  function findParcel(jibun) {
    var list = parcels(), i;
    for (i = 0; i < list.length; i++) {
      if (String(list[i].jibun).replace(/\s/g, "") === String(jibun).replace(/\s/g, "")) return list[i];
    }
    return null;
  }

  function keyMissing() {
    return !window.VWORLD_KEY || VWORLD_KEY.indexOf("여기에") === 0;
  }
  function showError() {
    document.getElementById("map-error").classList.remove("hidden");
  }
  function hideError() {
    document.getElementById("map-error").classList.add("hidden");
  }

  /* VWorld 지오코딩: 주소 -> {lng, lat} (응답 구조 미검증, 방어적으로 파싱) */
  function geocode(address) {
    var url = "https://api.vworld.kr/req/address?service=address&request=getcoord"
      + "&version=2.0&crs=epsg:4326"
      + "&address=" + encodeURIComponent(address)
      + "&format=json&type=parcel&key=" + encodeURIComponent(VWORLD_KEY);
    return fetch(url).then(function (r) { return r.json(); }).then(function (json) {
      var pt = json && json.response && json.response.result && json.response.result.point;
      if (pt && pt.x && pt.y) return { lng: parseFloat(pt.x), lat: parseFloat(pt.y) };
      // 혹시 다른 구조일 때를 대비한 예비 경로
      var pt2 = json && json.response && json.response.result;
      if (pt2 && pt2.x !== undefined) return { lng: parseFloat(pt2.x), lat: parseFloat(pt2.y) };
      throw new Error("geocode parse failed");
    });
  }

  /* 좌표계 정밀도 주의: 한국 경위도(127, 37)는 자릿수가 커서
     면적·内外 판정 시 첫 점을 원점으로 뺀 상대좌표로 계산한다. */
  function pointInRing(px, py, ring) {
    var x0 = ring[0][0], y0 = ring[0][1], inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0] - x0, yi = ring[i][1] - y0;
      var xj = ring[j][0] - x0, yj = ring[j][1] - y0;
      var x = px - x0, y = py - y0;
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }
  function ringAreaM2(ring) {
    var lat0 = ring[0][1];
    var kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    var x0 = ring[0][0] * kx, y0 = ring[0][1] * ky, sum = 0;
    for (var i = 0; i < ring.length; i++) {
      var a = ring[i], b = ring[(i + 1) % ring.length];
      sum += (a[0] * kx - x0) * (b[1] * ky - y0) - (b[0] * kx - x0) * (a[1] * ky - y0);
    }
    return Math.abs(sum / 2);
  }
  function geomRings(geom) {
    if (!geom) return [];
    if (geom.type === "Polygon") return geom.coordinates;
    if (geom.type === "MultiPolygon") {
      var out = [];
      geom.coordinates.forEach(function (poly) { out.push.apply(out, poly); });
      return out;
    }
    return [];
  }
  function featureAt(features, lng, lat) {
    for (var i = 0; i < features.length; i++) {
      var rings = geomRings(features[i].geometry);
      for (var r = 0; r < rings.length; r++) {
        if (rings[r].length > 2 && pointInRing(lng, lat, rings[r])) {
          return { feature: features[i], ring: rings[r] };
        }
      }
    }
    return null;
  }

  /* 탭한 위치의 필지 조회 (WFS, 탭 좌표 주변 작은 BBOX) */
  function lookupParcel(lng, lat) {
    var d = 0.0004; // 약 ±40m
    var bbox = [lng - d, lat - d, lng + d, lat + d].join(",");
    var url = "https://api.vworld.kr/req/wfs?SERVICE=WFS&REQUEST=GetFeature"
      + "&TYPENAME=LP_PA_CBND_BUBUN&SRSNAME=EPSG:4326&OUTPUT=application/json"
      + "&BBOX=" + bbox + "&key=" + encodeURIComponent(VWORLD_KEY);
    // 참고: CORS 차단 시 JSONP(callback=) 방식으로 교체 필요 (미검증)
    return fetch(url).then(function (r) { return r.json(); }).then(function (json) {
      var features = (json && json.features) || [];
      return featureAt(features, lng, lat);
    });
  }

  function propName(props) {
    // 지번 속성명 미검증: 흔한 후보를 순서대로 탐색
    var cands = ["jibun", "JIBUN", "jibunAddr", "addr"];
    for (var i = 0; i < cands.length; i++) {
      if (props[cands[i]]) return String(props[cands[i]]);
    }
    return "";
  }
  function jimokRaw(props) {
    // 등록용 원시 지목 코드 ("답"/"전")
    var cands = ["jimok", "JIMOK", "jimokCode"];
    for (var i = 0; i < cands.length; i++) {
      var v = props[cands[i]];
      if (v) {
        v = String(v);
        if (v.indexOf("답") >= 0) return "답";
        if (v.indexOf("전") >= 0) return "전";
        return v;
      }
    }
    return "";
  }
  function propAddr(props) {
    // 주소 속성명 미검증: 흔한 후보를 순서대로 탐색
    var cands = ["jibunAddr", "addr", "address", "fullAddr", "emdAddr"];
    for (var i = 0; i < cands.length; i++) {
      if (props[cands[i]]) return String(props[cands[i]]);
    }
    return "";
  }
  function jimokEasy(props) {
    // 표시용 쉬운 말 (답→논, 전→밭). 지번 속성명 미검증: 흔한 후보를 순서대로 탐색
    var cands = ["jimok", "JIMOK", "jimokCode"];
    for (var i = 0; i < cands.length; i++) {
      var v = props[cands[i]];
      if (v) {
        v = String(v);
        if (v.indexOf("답") >= 0) return "논";
        if (v.indexOf("전") >= 0) return "밭";
        return v;
      }
    }
    return "";
  }
  function normJibun(jibun) {
    // "123-45", "0123-0045" 등 형식을 "123-45"로 정규화 시도
    return String(jibun).replace(/^0+/, "").replace(/-0+/g, "-");
  }

  function openSheet(html) {
    document.getElementById("sheet-body").innerHTML = html;
    document.getElementById("sheet").classList.remove("hidden");
    if (window.FarmlandApp) window.FarmlandApp.renderAreas();
  }
  function closeSheet() {
    document.getElementById("sheet").classList.add("hidden");
  }

  /* 경매·공매 핀: 지오코딩 결과 localStorage 캐시 */
  var GEO_CACHE_KEY = "farmland_geocache";
  function loadGeoCache() {
    try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveGeoCache(c) {
    try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(c)); } catch (e) {}
  }
  function geocodeCached(addr, cache) {
    if (cache[addr]) return Promise.resolve(cache[addr]);
    return geocode(addr).then(function (p) {
      cache[addr] = p;
      saveGeoCache(cache);
      return p;
    });
  }
  function jimokEasyMap(j) {
    if (j === "답") return "논";
    if (j === "전") return "밭";
    return j || "";
  }
  function moneyFullMap(manwon) {
    manwon = Math.round(Number(manwon) || 0);
    if (manwon <= 0) return "–";
    if (manwon >= 10000) {
      var eok = Math.floor(manwon / 10000), rest = manwon % 10000;
      return "약 " + eok.toLocaleString("ko-KR") + "억" +
        (rest ? " " + rest.toLocaleString("ko-KR") + "만원" : "");
    }
    return "약 " + manwon.toLocaleString("ko-KR") + "만원";
  }
  function auctionSheet(a) {
    var isCourt = a._kind === "court";
    var dateRow = isCourt
      ? '<div class="kv"><span class="k">매각기일</span><span class="v">' + (a.saleDate || "–") + "</span></div>"
      : '<div class="kv"><span class="k">입찰기간</span><span class="v">' + (a.bidPeriod || "–") + "</span></div>";
    return "<h2>" + (isCourt ? "법원경매" : "온비드공매") + "</h2>"
      + '<div class="kv"><span class="k">소재지</span><span class="v">' + (a.addrShort || "") + "</span></div>"
      + '<div class="kv"><span class="k">종류 · 면적</span><span class="v">' + jimokEasyMap(a.kind)
      + ' <span class="area" data-m2="' + (a.areaM2 || 0) + '"></span></span></div>'
      + '<div class="kv"><span class="k">감정가</span><span class="v">' + moneyFullMap(a.apslManwon) + "</span></div>"
      + '<div class="kv"><span class="k">최저가</span><span class="v"><b>' + moneyFullMap(a.lowManwon) + "</b></span></div>"
      + (a.nextLowManwon
          ? '<div class="kv"><span class="k">다음 예정가</span><span class="v">' + moneyFullMap(a.nextLowManwon) + " (이번에 안 팔리면)</span></div>"
          : "")
      + dateRow
      + '<div class="kv"><span class="k">유찰횟수</span><span class="v">' + (a.fails || 0) + "회</span></div>"
      + "<p class='note'>참고용이에요. 입찰 전에는 반드시 원문 공고를 다시 확인하세요.</p>";
  }

  function parcelSheet(jibunLabel, jimokLabel, m2, priceHtml, registerData) {
    var html = "<h2>" + jibunLabel + "</h2>"
      + '<div class="kv"><span class="k">지목</span><span class="v">' + (jimokLabel || "–") + "</span></div>"
      + '<div class="kv"><span class="k">면적</span><span class="v area" data-m2="' + Math.round(m2) + '"></span></div>'
      + priceHtml;
    if (REGISTER_MODE && registerData) {
      html += "<button class='btn btn-primary' type='button' id='btn-register-parcel' style='margin-top:1rem;'>이 땅 등록하기</button>";
    }
    return html;
  }
  function registeredParcelSheet(p) {
    var priceHtml;
    if (p.price) {
      var t = (window.FarmlandApp && FarmlandApp.parcelTotalManwon(p));
      priceHtml = '<div class="kv"><span class="k">공시지가</span><span class="v">'
        + Number(p.price).toLocaleString("ko-KR") + "원/㎡</span></div>"
        + '<div class="kv"><span class="k">땅값 합계</span><span class="big-num">'
        + FarmlandApp.moneyManwon(t) + "</span></div>";
    } else {
      priceHtml = "<p class='note'>이 땅의 공시지가는 입력되지 않았어요.</p>";
    }
    var shareNote = (p.share && p.share !== "전부") ? " (" + p.share + " 지분)" : "";
    return parcelSheet(escHtml(p.jibun) + shareNote, FarmlandApp.jimokLabel(p.jimok), p.area, priceHtml, null);
  }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("sheet-close").addEventListener("click", closeSheet);

    if (keyMissing()) {
      document.getElementById("key-notice").style.display = "block";
      return;
    }

    var map = L.map("map", { zoomControl: false }).setView([36.5, 127.9], 7);
    L.tileLayer(
      "https://api.vworld.kr/req/wmts/1.0.0/" + encodeURIComponent(VWORLD_KEY) + "/Base/{z}/{y}/{x}.png",
      { maxZoom: 19, attribution: "© VWorld" }
    ).addTo(map);
    L.tileLayer.wms("https://api.vworld.kr/req/wms", {
      layers: "lp_pa_cbnd_bubun",
      format: "image/png",
      transparent: true,
      version: "1.1.1",
      key: VWORLD_KEY,
      attribution: "© VWorld"
    }).addTo(map);

    document.getElementById("zoom-in").addEventListener("click", function () { map.zoomIn(); });
    document.getElementById("zoom-out").addEventListener("click", function () { map.zoomOut(); });

    // 처음 화면: 등록된 땅이 있으면 첫 번째 땅으로 이동
    var firstAddr = (function () {
      var ps = parcels();
      return (ps.length && ps[0].addr) ? ps[0].addr : null;
    })();
    if (firstAddr) {
      geocode(firstAddr).then(function (p) {
        map.setView([p.lat, p.lng], 16);
      }).catch(function () { /* 기본 화면 유지 */ });
    }

    /* 경매·공매 핀 (기본 표시, 토글로 on/off) */
    var au = (typeof AUCTIONS !== "undefined") ? AUCTIONS : { court: [], onbid: [] };
    var aucItems = [];
    (au.court || []).forEach(function (a) { a._kind = "court"; aucItems.push(a); });
    (au.onbid || []).forEach(function (a) { a._kind = "onbid"; aucItems.push(a); });
    var aucLayer = L.layerGroup().addTo(map);
    var aucVisible = true;
    var aucToggle = document.getElementById("auction-toggle");
    function renderAucToggle() {
      var label = "경매 " + (au.court || []).length + " · 공매 " + (au.onbid || []).length;
      aucToggle.textContent = (aucVisible ? "경매·공매 숨기기 (" : "경매·공매 보기 (") + label + ")";
      aucToggle.classList.toggle("off", !aucVisible);
    }
    aucToggle.addEventListener("click", function () {
      aucVisible = !aucVisible;
      if (aucVisible) { aucLayer.addTo(map); } else { map.removeLayer(aucLayer); }
      renderAucToggle();
    });
    renderAucToggle();

    // 핀 생성: 지오코딩 순차 처리 + 캐시, 실패한 물건은 핀 생략
    var geoCache = loadGeoCache();
    (function addPins(i) {
      if (i >= aucItems.length) return;
      var a = aucItems[i];
      function next() { addPins(i + 1); }
      if (!a.addr) { next(); return; }
      geocodeCached(a.addr, geoCache).then(function (p) {
        var marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: "auc-pin-wrap",
            html: '<div class="auc-pin ' + a._kind + '">' + (a._kind === "court" ? "경" : "공") + "</div>",
            iconSize: [48, 48],
            iconAnchor: [24, 24]
          }),
          keyboard: false
        });
        marker.on("click", function () { hideError(); openSheet(auctionSheet(a)); });
        marker.addTo(aucLayer);
        next();
      }).catch(function () { next(); });
    })(0);

    // 지도 탭 → 필지 조회
    map.on("click", function (e) {
      hideError();
      lookupParcel(e.latlng.lng, e.latlng.lat).then(function (hit) {
        if (!hit) {
          openSheet("<h2>필지를 찾지 못했어요</h2><p class='muted'>땅 부분을 정확히 눌러보세요.</p>");
          return;
        }
        var props = hit.feature.properties || {};
        var jibun = normJibun(propName(props));
        var reg = jibun ? findParcel(jibun) : null;
        var m2 = Math.round(ringAreaM2(hit.ring));
        var priceHtml;
        if (reg) {
          openSheet(registeredParcelSheet(reg));
          return;
        }
        priceHtml = "<p class='note'>이 땅의 공시지가는 준비 중이에요.</p>";
        var registerData = null;
        if (REGISTER_MODE) {
          registerData = {
            jibun: jibun || "",
            jimok: jimokRaw(props),
            area: m2,
            addr: propAddr(props)
          };
        }
        openSheet(parcelSheet((jibun || "?"), jimokEasy(props), m2, priceHtml, registerData));
        if (registerData) {
          var btn = document.getElementById("btn-register-parcel");
          if (btn) {
            btn.addEventListener("click", function () {
              if (window.FarmlandApp) FarmlandApp.savePendingParcel(registerData);
              location.href = "settings.html";
            });
          }
        }
      }).catch(function () {
        showError();
      });
    });

    // 바로가기 버튼: 등록된 땅
    (function buildShortcuts() {
      var bar = document.getElementById("shortcut-bar");
      if (!bar) return;
      var list = parcels();
      for (var k = 0; k < list.length; k++) {
        (function (p) {
          var b = document.createElement("button");
          b.className = "shortcut-btn our";
          b.type = "button";
          b.innerHTML = "우리 땅<br>" + escHtml(p.jibun);
          b.setAttribute("aria-label", "우리 땅 " + p.jibun + "로 이동");
          b.addEventListener("click", function () {
            hideError(); closeSheet();
            var target = ((p.addr || "") + " " + p.jibun).trim();
            b.disabled = true;
            geocode(target).then(function (pt) {
              map.setView([pt.lat, pt.lng], 18);
              openSheet(registeredParcelSheet(p));
            }).catch(function () {
              showError();
            }).then(function () { b.disabled = false; });
          });
          bar.insertBefore(b, bar.firstChild);
        })(list[k]);
      }
    })();
  });
})();
