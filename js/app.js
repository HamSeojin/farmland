/* 공용 헬퍼: 면적 단위 토글(평/m²) + 하단 내비 활성화
   - 면적 표시는 <span class="area" data-m2="7279"></span> 형태로 마크업
   - 데이터는 항상 m² 기준으로 보관, 표기만 현재 단위로 렌더링
   - 선택은 localStorage('farmland_unit')에 저장, 기본값 'pyong'(평) */
(function () {
  "use strict";
  var UNIT_KEY = "farmland_unit";
  var M2_PER_PYONG = 3.3058;

  function getUnit() {
    try {
      return localStorage.getItem(UNIT_KEY) || "pyong";
    } catch (e) {
      return "pyong";
    }
  }
  function setUnit(u) {
    try { localStorage.setItem(UNIT_KEY, u); } catch (e) {}
    renderAreas();
    renderToggles();
    try { document.dispatchEvent(new CustomEvent("farmland:unitchange")); } catch (e) {}
  }
  function formatArea(m2) {
    m2 = Number(m2);
    if (getUnit() === "pyong") {
      return Math.round(m2 / M2_PER_PYONG).toLocaleString("ko-KR") + "평";
    }
    return Math.round(m2).toLocaleString("ko-KR") + "㎡";
  }
  function renderAreas() {
    var els = document.querySelectorAll("[data-m2]");
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = formatArea(els[i].getAttribute("data-m2"));
    }
  }
  function renderToggles() {
    // 버튼 문구는 "바꿀 대상"을 보여줌: 지금 평이면 "m²로 보기"
    var label = getUnit() === "pyong" ? "m²로 보기" : "평으로 보기";
    var btns = document.querySelectorAll(".unit-toggle");
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = label;
      btns[i].setAttribute("aria-label", "면적 단위 바꾸기: " + label);
    }
  }
  function toggleUnit() {
    setUnit(getUnit() === "pyong" ? "m2" : "pyong");
  }

  /* 우리 땅 (설정식): 각자 폰 localStorage에 저장, 가족 코드는 서버 공유
     스키마: {jibun, jimok("답"|"전"), area(㎡, 지분반영), share("전부"|"1/2"|"1/3"),
              price(원/㎡|null), addr} */
  var PARCELS_KEY = "farmland_parcels";
  var FAMILY_CODE_KEY = "farmland_family_code";
  var PENDING_KEY = "farmland_pending";

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function validParcel(p) {
    return p && typeof p.jibun === "string" && p.jibun.trim() !== ""
      && (p.jimok === "답" || p.jimok === "전")
      && Number(p.area) > 0;
  }
  function getParcels() {
    var arr = readJson(PARCELS_KEY, []);
    if (!Array.isArray(arr)) return [];
    return arr.filter(validParcel);
  }
  function saveParcels(arr) {
    writeJson(PARCELS_KEY, (arr || []).filter(validParcel));
  }
  function getFamilyCode() {
    try { return localStorage.getItem(FAMILY_CODE_KEY) || ""; } catch (e) { return ""; }
  }
  function saveFamilyCode(code) {
    try {
      if (code) localStorage.setItem(FAMILY_CODE_KEY, code);
      else localStorage.removeItem(FAMILY_CODE_KEY);
    } catch (e) {}
  }
  // 지도에서 고른 땅 임시 보관 (settings.html에서 이어서 등록)
  function getPendingParcel() { return readJson(PENDING_KEY, null); }
  function savePendingParcel(p) { writeJson(PENDING_KEY, p); }
  function clearPendingParcel() { try { localStorage.removeItem(PENDING_KEY); } catch (e) {} }

  // 지목 쉬운 말: 답→논, 전→밭
  function jimokLabel(j) {
    if (j === "답") return "논";
    if (j === "전") return "밭";
    return j || "";
  }
  // 만원 → "약 1억 8,830만원" 형식
  function moneyManwon(manwon) {
    manwon = Math.round(Number(manwon) || 0);
    if (manwon <= 0) return "–";
    if (manwon >= 10000) {
      var eok = Math.floor(manwon / 10000), rest = manwon % 10000;
      return "약 " + eok.toLocaleString("ko-KR") + "억" +
        (rest ? " " + rest.toLocaleString("ko-KR") + "만원" : "");
    }
    return "약 " + manwon.toLocaleString("ko-KR") + "만원";
  }
  // 필지 땅값(만원) = 면적 × 공시지가(원/㎡) / 10000, 공시지가 모르면 null
  function parcelTotalManwon(p) {
    var area = Number(p.area) || 0, price = Number(p.price) || 0;
    if (area <= 0 || price <= 0) return null;
    return Math.round(area * price / 10000);
  }

  /* 가족 코드 공유 (중계 서버) */
  var RELAY_BASE = "https://farmland-relay.813nanalove.workers.dev";
  function familyError(status, bodyText) {
    if (status === 404) return "코드를 다시 확인해주세요.";
    if (status === 400) {
      try {
        var b = JSON.parse(bodyText || "{}");
        if (b.error) return b.error;
      } catch (e) {}
      return "입력한 내용을 다시 확인해주세요.";
    }
    if (status === 503) return "지금은 서버 준비 중이에요. 잠시 후 다시 시도해주세요.";
    return "인터넷 연결을 확인하고 다시 시도해주세요.";
  }
  // 우리 땅을 서버에 올리고 8자리 가족 코드 받기
  function familyCreate(parcels) {
    return fetch(RELAY_BASE + "/api/family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parcels: parcels })
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error(familyError(r.status, t));
        var b = JSON.parse(t);
        if (!b.code) throw new Error("코드를 만들지 못했어요. 다시 시도해주세요.");
        return b.code;
      });
    }).catch(function (e) {
      if (e instanceof TypeError) throw new Error("인터넷 연결을 확인하고 다시 시도해주세요.");
      throw e;
    });
  }
  // 가족 코드로 땅 정보 불러오기
  function familyFetch(code) {
    code = String(code || "").trim().toUpperCase();
    return fetch(RELAY_BASE + "/api/family?code=" + encodeURIComponent(code))
      .then(function (r) {
        return r.text().then(function (t) {
          if (!r.ok) throw new Error(familyError(r.status, t));
          var b = JSON.parse(t);
          var parcels = Array.isArray(b.parcels) ? b.parcels.filter(validParcel) : [];
          if (!parcels.length) throw new Error("코드를 다시 확인해주세요.");
          return parcels;
        });
      }).catch(function (e) {
        if (e instanceof TypeError) throw new Error("인터넷 연결을 확인하고 다시 시도해주세요.");
        throw e;
      });
  }

  // 전역 노출 (map.js 등 페이지 스크립트에서 사용)
  window.FarmlandApp = {
    getUnit: getUnit,
    setUnit: setUnit,
    toggleUnit: toggleUnit,
    formatArea: formatArea,
    renderAreas: renderAreas,
    getParcels: getParcels,
    saveParcels: saveParcels,
    getFamilyCode: getFamilyCode,
    saveFamilyCode: saveFamilyCode,
    getPendingParcel: getPendingParcel,
    savePendingParcel: savePendingParcel,
    clearPendingParcel: clearPendingParcel,
    jimokLabel: jimokLabel,
    moneyManwon: moneyManwon,
    parcelTotalManwon: parcelTotalManwon,
    familyCreate: familyCreate,
    familyFetch: familyFetch,
    RELAY_BASE: RELAY_BASE
  };

  document.addEventListener("DOMContentLoaded", function () {
    renderAreas();
    renderToggles();
    var btns = document.querySelectorAll(".unit-toggle");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", toggleUnit);
    }
    // 하단 내비 활성 탭 표시
    var path = location.pathname.split("/").pop() || "index.html";
    var links = document.querySelectorAll(".bottom-nav a");
    for (var j = 0; j < links.length; j++) {
      if (links[j].getAttribute("href") === path) {
        links[j].classList.add("active");
      }
    }
  });
})();
