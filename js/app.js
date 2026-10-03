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
    // 세그먼트 컨트롤: 현재 단위 버튼에 .on 표시
    var unit = getUnit();
    var btns = document.querySelectorAll(".unit-seg button");
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute("data-unit") === unit) btns[i].classList.add("on");
      else btns[i].classList.remove("on");
    }
  }

  /* 우리 땅 (설정식): 각자 폰 localStorage에 저장, 가족 코드는 서버 공유
     스키마: {jibun, jimok("답"|"전"), area(㎡, 지분반영), share("전부"|"1/2"|"1/3"),
              price(원/㎡|null), addr, sido, sigungu, dong,
              acqType("inherit"|"buy"|"gift"|""), acqYear(숫자|null),
              useStatus("rent"|"self"|"idle"|"bank"|"")} */
  var PARCELS_KEY = "farmland_parcels";
  var FAMILY_CODE_KEY = "farmland_family_code";
  var PENDING_KEY = "farmland_pending";
  var PROFILE_KEY = "farmland_profile";

  var ACQ_LABEL = { inherit: "상속", buy: "매매", gift: "증여" };
  var USE_LABEL = { rent: "남에게 빌려줌", self: "직접 농사짓고 있음", idle: "놀고 있음(휴경)", bank: "농지은행에 맡김" };
  function acqTypeLabel(t) { return ACQ_LABEL[t] || ""; }
  function useStatusLabel(s) { return USE_LABEL[s] || ""; }

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
  /* 우리 집 상황 (전수조사 판단용): {registry("yes"|"no"|"unknown"|""), jikbul("owner"|"farmer"|"")} */
  function getProfile() {
    var p = readJson(PROFILE_KEY, {});
    if (!p || typeof p !== "object") p = {};
    return {
      registry: (p.registry === "yes" || p.registry === "no" || p.registry === "unknown") ? p.registry : "",
      jikbul: (p.jikbul === "owner" || p.jikbul === "farmer") ? p.jikbul : ""
    };
  }
  function saveProfile(p) {
    p = p || {};
    writeJson(PROFILE_KEY, {
      registry: (p.registry === "yes" || p.registry === "no" || p.registry === "unknown") ? p.registry : "",
      jikbul: (p.jikbul === "owner" || p.jikbul === "farmer") ? p.jikbul : ""
    });
  }
  /* 등록된 땅의 지역 모음: [{sido, sigungu, dong}] */
  function parcelRegions() {
    var seen = {}, out = [];
    getParcels().forEach(function (p) {
      var key = [p.sido || "", p.sigungu || "", p.dong || ""].join("|");
      if (!seen[key] && (p.sido || p.sigungu)) {
        seen[key] = 1;
        out.push({ sido: p.sido || "", sigungu: p.sigungu || "", dong: p.dong || "" });
      }
    });
    return out;
  }
  /* 가장 많은 필지가 있는 지역 (페이지별 기본 지역) */
  function mainRegion() {
    var counts = {}, order = [];
    getParcels().forEach(function (p) {
      if (!p.sigungu) return;
      var key = [p.sido || "", p.sigungu || "", p.dong || ""].join("|");
      if (!counts[key]) { counts[key] = 0; order.push(key); }
      counts[key]++;
    });
    if (!order.length) return null;
    order.sort(function (a, b) { return counts[b] - counts[a]; });
    var parts = order[0].split("|");
    return { sido: parts[0], sigungu: parts[1], dong: parts[2] };
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

  /* 전수조사 자가점검
     반환: {level: "empty"|"ok"|"info"|"warn"|"alert", totalArea, inheritArea, notes:[{level,text}]}
     - 법적 확정이 아니라 "적어주신 내용 기준" 자가점검임을 화면에서 명시할 것 */
  function judgeCensus() {
    var parcels = getParcels();
    var profile = getProfile();
    if (!parcels.length) return { level: "empty", parcels: [], totalArea: 0, inheritArea: 0, notes: [] };

    var totalArea = 0, inheritArea = 0;
    var allPre1996 = true, hasYearInfo = false;
    parcels.forEach(function (p) {
      var a = Number(p.area) || 0;
      totalArea += a;
      if (p.acqType === "inherit") inheritArea += a;
      var y = Number(p.acqYear) || 0;
      if (y > 0) { hasYearInfo = true; if (y >= 1996) allPre1996 = false; }
      else allPre1996 = false;
    });

    var notes = [];
    var level = "ok";
    function add(lv, text) {
      notes.push({ level: lv, text: text });
      if (lv === "alert") level = "alert";
      else if (lv === "warn" && level !== "alert") level = "warn";
      else if (lv === "info" && level === "ok") level = "info";
    }

    // 1996년 이전 취득분은 농지법 부칙으로 소유·임대 규정이 적용되지 않음
    if (hasYearInfo && allPre1996) {
      add("info", "1996년보다 전에 갖게 된 땅이라 이번(1단계) 조사 대상이 아니에요. 1996년 이전에 가진 땅은 2027년 2단계 조사 때 봐요.");
      return { level: level, parcels: parcels, totalArea: totalArea, inheritArea: inheritArea, notes: notes };
    }
    if (!hasYearInfo) {
      add("info", "땅을 갖게 된 해를 적어주면 조사 대상인지 바로 알려드려요. 설정에서 입력해주세요.");
    }

    if (inheritArea > 10000) {
      add("warn", "상속받은 땅이 1만㎡를 넘어요(" + formatArea(inheritArea) + "). 넘은 부분은 농지은행에 맡기거나 처분해야 할 수 있어요.");
    }

    parcels.forEach(function (p) {
      var name = p.jibun + "(" + jimokLabel(p.jimok) + ")";
      if (p.useStatus === "idle") {
        add("warn", name + ": 지금 놀고 있는 땅이에요. 정당한 사유 없이 방치하면 조사 대상이에요.");
      } else if (p.useStatus === "rent") {
        if (p.acqType === "buy" || p.acqType === "gift") {
          add("alert", name + ": 사거나 증여받은 땅을 남에게 빌려주는 건 원칙적으로 안 돼요. 농지은행 위탁을 알아보세요.");
        }
        if (profile.jikbul === "owner") {
          add("alert", name + ": 빌려줬는데 직불금을 땅 주인이 받고 있어요. 실제로 농사짓는 분이 받아야 해요.");
        }
        if (profile.registry === "no") {
          add("warn", name + ": 농지대장에 빌린 사람 이름이 안 올라가 있어요. 읍·면사무소에서 확인하세요.");
        } else if (!profile.registry) {
          add("info", name + ": 농지대장에 빌린 사람 이름이 올라가 있는지 한 번 확인해보세요.");
        }
      }
    });

    if (!notes.length) {
      add("ok", "적어주신 내용으로는 특별히 문제될 게 없어 보여요.");
    }
    return { level: level, parcels: parcels, totalArea: totalArea, inheritArea: inheritArea, notes: notes };
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
  // 우리 땅 + 우리 집 상황을 서버에 올리고 8자리 가족 코드 받기
  function familyCreate(parcels, profile) {
    return fetch(RELAY_BASE + "/api/family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parcels: parcels, profile: profile || {} })
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
  // 가족 코드로 땅 정보 + 우리 집 상황 불러오기 → {parcels, profile}
  function familyFetch(code) {
    code = String(code || "").trim().toUpperCase();
    return fetch(RELAY_BASE + "/api/family?code=" + encodeURIComponent(code))
      .then(function (r) {
        return r.text().then(function (t) {
          if (!r.ok) throw new Error(familyError(r.status, t));
          var b = JSON.parse(t);
          var parcels = Array.isArray(b.parcels) ? b.parcels.filter(validParcel) : [];
          if (!parcels.length) throw new Error("코드를 다시 확인해주세요.");
          return { parcels: parcels, profile: normalizeProfile(b.profile) };
        });
      }).catch(function (e) {
        if (e instanceof TypeError) throw new Error("인터넷 연결을 확인하고 다시 시도해주세요.");
        throw e;
      });
  }
  function normalizeProfile(p) {
    p = p || {};
    return {
      registry: (p.registry === "yes" || p.registry === "no" || p.registry === "unknown") ? p.registry : "",
      jikbul: (p.jikbul === "owner" || p.jikbul === "farmer") ? p.jikbul : ""
    };
  }

  // 전역 노출 (map.js 등 페이지 스크립트에서 사용)
  window.FarmlandApp = {
    getUnit: getUnit,
    setUnit: setUnit,
    formatArea: formatArea,
    renderAreas: renderAreas,
    getParcels: getParcels,
    saveParcels: saveParcels,
    getProfile: getProfile,
    saveProfile: saveProfile,
    parcelRegions: parcelRegions,
    mainRegion: mainRegion,
    acqTypeLabel: acqTypeLabel,
    useStatusLabel: useStatusLabel,
    judgeCensus: judgeCensus,
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
    var btns = document.querySelectorAll(".unit-seg button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        setUnit(this.getAttribute("data-unit"));
      });
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
