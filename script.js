(function () {
  "use strict";

  /* ============================================================
   *  海南大学考研真题刷题  ——  前端逻辑
   *  - 容错读取 questions.json（兼容 markdown 包裹 / 多段拼接的非法 JSON）
   *  - 历年套卷（全真模拟 / 背题模式）
   *  - 分类刷题（科目 + 题型卡片式筛选）
   *  - 错题本 / 我的收藏（LocalStorage）
   *  - 上传新卷（追加合并到题库）
   * ============================================================ */

  // ---------- LocalStorage 键 ----------
  var LS = {
    wrong: "hndx_wrong_v1",
    fav: "hndx_favorites_v1",
    uploaded: "hndx_uploaded_v1",
  };

  // ---------- 全局状态 ----------
  var state = {
    base: [], // 来自 questions.json 的题目
    uploaded: [], // 用户上传追加的题目（持久化）
    all: [], // 合并去重后的全部题目
    freq: [], // 高频考点
    wrong: new Set(), // 错题 uid
    fav: new Set(), // 收藏 uid
    view: "home",
    catSubject: "all", // 分类刷题 - 当前科目
    catType: "all", // 分类刷题 - 当前题型
    paperYear: null, // 套卷 - 年份
    paperMode: "mock", // mock=全真模拟, recite=背题模式
    paperIndex: 0, // 套卷 - 当前题号
  };

  // ---------- 工具 ----------
  function $(s, r) {
    return (r || document).querySelector(s);
  }
  function normTitle(t) {
    return String(t == null ? "" : t)
      .replace(/\s+/g, "")
      .toLowerCase();
  }
  function uidOf(q) {
    return (q.year || "") + "_" + normTitle(q.title);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function textToHtml(s) {
    return escapeHtml(s).replace(/\r\n|\r|\n/g, "<br>");
  }
  function starsHtml(n) {
    n = Math.max(0, Math.min(5, Number(n) || 0));
    return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
  }
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      t.classList.remove("show");
    }, 2200);
  }

  // ---------- 存储 ----------
  function loadSet(key) {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch (e) {
      return new Set();
    }
  }
  function saveSet(key, set) {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  }
  function loadUploaded() {
    try {
      return JSON.parse(localStorage.getItem(LS.uploaded) || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveUploaded(arr) {
    localStorage.setItem(LS.uploaded, JSON.stringify(arr));
  }

  /* ============================================================
   *  容错 JSON 解析
   *  从文本中提取所有平衡的 {...} 对象（支持嵌套与多段拼接的非法 JSON）。
   *  这样即便 questions.json 被 markdown 围栏包裹、或多段 JSON 拼接，
   *  也能正确抽取出每道题。
   * ============================================================ */
  function extractObjects(text) {
    var out = [];
    var n = text.length;

    function findClose(openIdx) {
      var depth = 0,
        inStr = false,
        esc = false;
      for (var j = openIdx; j < n; j++) {
        var c = text[j];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') {
          inStr = true;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) return j;
        }
      }
      return -1;
    }

    function scan(start, end) {
      var i = start;
      while (i < end) {
        var c = text[i];
        if (c === '"') {
          // 跳过字符串
          var j = i + 1,
            esc = false;
          while (j < end) {
            var cc = text[j];
            if (esc) esc = false;
            else if (cc === "\\") esc = true;
            else if (cc === '"') {
              j++;
              break;
            }
            j++;
          }
          i = j;
          continue;
        }
        if (c === "{") {
          var close = findClose(i);
          if (close === -1) {
            i++;
            continue;
          }
          var slice = text.slice(i, close + 1);
          try {
            out.push(JSON.parse(slice));
          } catch (e) {}
          scan(i + 1, close); // 递归查找嵌套对象
          i = close + 1;
          continue;
        }
        i++;
      }
    }

    scan(0, n);
    return out;
  }

  function normalizeQuestion(q) {
    var title = String(q.title || "").trim();
    return {
      uid: uidOf({ year: q.year, title: title }),
      id: q.id,
      year: Number(q.year) || 0,
      subject: String(q.subject || "").trim() || "未分类",
      question_type: String(q.question_type || "").trim() || "其他",
      title: title,
      analysis: String(q.analysis || "").trim(),
      frequency_star: Number(q.frequency_star) || 0,
      tags: Array.isArray(q.tags) ? q.tags.map(String) : [],
    };
  }

  // 从任意文本（含 markdown 包裹、多段拼接）解析题目与高频考点
  function parseLibrary(raw) {
    var text = String(raw || "").replace(/```[a-zA-Z]*/g, ""); // 去除 markdown 代码围栏
    var objs = extractObjects(text);
    var qMap = {};
    var freq = [];
    for (var k = 0; k < objs.length; k++) {
      var o = objs[k];
      if (!o || typeof o !== "object" || Array.isArray(o)) continue;
      if (o.title && (o.subject || o.question_type)) {
        var q = normalizeQuestion(o);
        if (q.title) qMap[q.uid] = q; // 同 uid 去重
      } else if (
        o.knowledge_point &&
        (o.count_estimate != null || o.frequency_star != null)
      ) {
        freq.push({
          knowledge_point: String(o.knowledge_point || ""),
          count_estimate: Number(o.count_estimate) || 0,
          frequency_star: Number(o.frequency_star) || 0,
          related_years: Array.isArray(o.related_years) ? o.related_years : [],
          subjects: Array.isArray(o.subjects) ? o.subjects : [],
        });
      }
    }
    var questions = [];
    for (var u in qMap) questions.push(qMap[u]);
    return { questions: questions, freq: freq };
  }

  function mergeLibrary() {
    var map = {};
    state.base.forEach(function (q) {
      map[q.uid] = q;
    });
    state.uploaded.forEach(function (q) {
      map[q.uid] = q;
    }); // 上传覆盖同 uid
    state.all = Object.keys(map).map(function (u) {
      return map[u];
    });
    state.all.sort(function (a, b) {
      return (
        b.year - a.year ||
        a.subject.localeCompare(b.subject, "zh") ||
        a.question_type.localeCompare(b.question_type, "zh")
      );
    });
  }

  // ---------- 派生数据 ----------
  function years() {
    var s = {};
    state.all.forEach(function (q) {
      if (q.year) s[q.year] = 1;
    });
    return Object.keys(s)
      .map(Number)
      .sort(function (a, b) {
        return b - a;
      });
  }
  function subjects() {
    var order = [
      "古代文学",
      "现代文学",
      "外国文学",
      "古代文论",
      "西方文论",
      "现代汉语",
      "古代汉语",
      "文学理论",
      "比较文学",
    ];
    var set = {};
    state.all.forEach(function (q) {
      set[q.subject] = 1;
    });
    var list = order.filter(function (s) {
      return set[s];
    });
    Object.keys(set).forEach(function (s) {
      if (list.indexOf(s) === -1) list.push(s);
    });
    return list;
  }
  function types() {
    var order = ["名词解释", "简答题", "论述题", "填空题", "判断题"];
    var set = {};
    state.all.forEach(function (q) {
      set[q.question_type] = 1;
    });
    var list = order.filter(function (s) {
      return set[s];
    });
    Object.keys(set).forEach(function (s) {
      if (list.indexOf(s) === -1) list.push(s);
    });
    return list;
  }
  function countBy(fn) {
    var m = {};
    state.all.forEach(function (q) {
      var k = fn(q);
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }

  // ---------- 题目卡片渲染 ----------
  function cardHtml(q, showAnswer) {
    var inWrong = state.wrong.has(q.uid);
    var inFav = state.fav.has(q.uid);
    var tagsHtml = q.tags.length
      ? '<div class="q-tags">' +
        q.tags
          .map(function (t) {
            return '<span class="tag">' + escapeHtml(t) + "</span>";
          })
          .join("") +
        "</div>"
      : "";
    var freqHtml =
      q.frequency_star > 0
        ? '<span class="freq" title="考频">' +
          starsHtml(q.frequency_star) +
          "</span>"
        : "";
    return (
      "" +
      '<div class="q-card" data-uid="' +
      escapeHtml(q.uid) +
      '">' +
      '<div class="q-meta">' +
      '<span class="badge badge-year">' +
      escapeHtml(q.year || "—") +
      "</span>" +
      '<span class="badge badge-subject">' +
      escapeHtml(q.subject) +
      "</span>" +
      '<span class="badge badge-type">' +
      escapeHtml(q.question_type) +
      "</span>" +
      freqHtml +
      "</div>" +
      '<div class="q-title">' +
      escapeHtml(q.title) +
      "</div>" +
      '<div class="q-analysis' +
      (showAnswer ? " show" : "") +
      '">' +
      '<div class="q-analysis-label">参考解析</div>' +
      '<div class="q-analysis-body">' +
      textToHtml(q.analysis || "暂无解析") +
      "</div>" +
      "</div>" +
      tagsHtml +
      '<div class="q-actions">' +
      '<button class="btn btn-ghost" data-action="toggle-answer">' +
      (showAnswer ? "隐藏答案" : "显示答案") +
      "</button>" +
      '<button class="btn ' +
      (inWrong ? "btn-wrong-active" : "btn-wrong") +
      '" data-action="toggle-wrong">' +
      (inWrong ? "✓ 已标记错题" : "标记错题") +
      "</button>" +
      '<button class="btn ' +
      (inFav ? "btn-fav-active" : "btn-fav") +
      '" data-action="toggle-fav">' +
      (inFav ? "⭐ 已收藏" : "⭐ 收藏") +
      "</button>" +
      "</div>" +
      "</div>"
    );
  }

  // ---------- 视图：总调度 ----------
  function render() {
    var views = document.querySelectorAll(".view");
    for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
    $("#view-" + state.view).classList.add("active");

    var navs = document.querySelectorAll(".nav a");
    for (var j = 0; j < navs.length; j++)
      navs[j].classList.toggle("active", navs[j].dataset.target === state.view);
    $(".nav").classList.remove("open");

    updateBadges();
    switch (state.view) {
      case "home":
        renderHome();
        break;
      case "papers":
        renderPapers();
        break;
      case "category":
        renderCategory();
        break;
      case "wrong":
        renderList("wrong", state.wrong);
        break;
      case "favorites":
        renderList("favorites", state.fav);
        break;
      case "upload":
        var lc = $("#lib-count");
        if (lc) lc.textContent = state.all.length;
        break;
    }
    window.scrollTo(0, 0);
  }

  function updateBadges() {
    var w = $("#nav-wrong-badge");
    if (w) w.textContent = state.wrong.size || "";
    var f = $("#nav-fav-badge");
    if (f) f.textContent = state.fav.size || "";
  }

  // ---------- 视图：首页 ----------
  function renderHome() {
    var ys = years(),
      ss = subjects();
    var subjCount = countBy(function (q) {
      return q.subject;
    });
    var yearCount = countBy(function (q) {
      return q.year;
    });

    var html =
      '<div class="hero">' +
      "<h1>海南大学考研真题刷题</h1>" +
      '<p class="hero-sub">中国语言文学 · 历年真题智能刷题平台</p>' +
      '<div class="stat-row">' +
      '<div class="stat"><div class="stat-num">' +
      state.all.length +
      '</div><div class="stat-label">题目总数</div></div>' +
      '<div class="stat"><div class="stat-num">' +
      ys.length +
      '</div><div class="stat-label">历年套卷</div></div>' +
      '<div class="stat"><div class="stat-num">' +
      ss.length +
      '</div><div class="stat-label">科目</div></div>' +
      '<div class="stat"><div class="stat-num">' +
      state.wrong.size +
      '</div><div class="stat-label">我的错题</div></div>' +
      "</div></div>";

    html +=
      '<div class="quick-actions">' +
      '<button class="qa" data-go="papers">历年套卷</button>' +
      '<button class="qa" data-go="category">分类刷题</button>' +
      '<button class="qa" data-go="wrong">错题本</button>' +
      '<button class="qa" data-go="favorites">我的收藏</button>' +
      '<button class="qa" data-go="upload">上传新卷</button>' +
      "</div>";

    html +=
      '<div class="panel"><h2 class="panel-title">历年套卷</h2><div class="year-grid">';
    for (var i = 0; i < ys.length; i++) {
      html +=
        '<button class="year-card" data-go-year="' +
        ys[i] +
        '"><span class="yc-num">' +
        ys[i] +
        '</span><span class="yc-cnt">' +
        (yearCount[ys[i]] || 0) +
        " 题</span></button>";
    }
    html += "</div></div>";

    html +=
      '<div class="panel"><h2 class="panel-title">科目分布</h2><div class="subj-grid">';
    for (var s = 0; s < ss.length; s++) {
      html +=
        '<button class="subj-card" data-go-subject="' +
        escapeHtml(ss[s]) +
        '"><span class="sc-name">' +
        escapeHtml(ss[s]) +
        '</span><span class="sc-cnt">' +
        (subjCount[ss[s]] || 0) +
        "</span></button>";
    }
    html += "</div></div>";

    if (state.freq.length) {
      html +=
        '<div class="panel"><h2 class="panel-title">高频考点榜</h2><div class="freq-list">';
      var top = state.freq.slice(0, 10);
      for (var f = 0; f < top.length; f++) {
        var it = top[f];
        html +=
          '<div class="freq-item">' +
          '<span class="freq-rank">' +
          (f + 1) +
          "</span>" +
          '<div class="freq-main">' +
          '<div class="freq-kp">' +
          escapeHtml(it.knowledge_point) +
          "</div>" +
          '<div class="freq-sub">' +
          escapeHtml((it.subjects || []).join(" / ")) +
          " · 近年出现 " +
          it.count_estimate +
          " 次</div>" +
          "</div>" +
          '<span class="freq-star">' +
          starsHtml(it.frequency_star) +
          "</span>" +
          "</div>";
      }
      html += "</div></div>";
    }
    $("#view-home").innerHTML = html;
  }

  // ---------- 视图：历年套卷 ----------
  function renderPapers() {
    var ys = years();
    if (!state.paperYear && ys.length) state.paperYear = ys[0];

    var html =
      '<div class="panel paper-controls">' +
      '<div class="ctrl-row"><label>年份：</label><select id="paper-year">';
    for (var i = 0; i < ys.length; i++) {
      html +=
        '<option value="' +
        ys[i] +
        '"' +
        (ys[i] === state.paperYear ? " selected" : "") +
        ">" +
        ys[i] +
        " 年</option>";
    }
    html += "</select></div>";
    html +=
      '<div class="ctrl-row mode-toggle">' +
      '<button class="mode-btn ' +
      (state.paperMode === "mock" ? "active" : "") +
      '" data-mode="mock">全真模拟</button>' +
      '<button class="mode-btn ' +
      (state.paperMode === "recite" ? "active" : "") +
      '" data-mode="recite">背题模式</button>' +
      "</div></div>";

    var list = state.all.filter(function (q) {
      return q.year === state.paperYear;
    });
    window.currentPaperList = list;
    if (!list.length) {
      html += '<div class="empty">该年份暂无题目</div>';
      $("#view-papers").innerHTML = html;
      return;
    }
    if (state.paperIndex >= list.length) state.paperIndex = 0;
    var q = list[state.paperIndex];
    var showAnswer = state.paperMode === "recite";
    var pct = (((state.paperIndex + 1) / list.length) * 100).toFixed(1);

    html +=
      '<div class="paper-progress">' +
      '<div class="pp-bar"><div class="pp-fill" style="width:' +
      pct +
      '%"></div></div>' +
      '<div class="pp-text">第 ' +
      (state.paperIndex + 1) +
      " / " +
      list.length +
      " 题 · " +
      (state.paperMode === "mock"
        ? "全真模拟（答案默认隐藏）"
        : "背题模式（答案默认展示，可随时折叠）") +
      "</div>" +
      "</div>";

    html += '<div class="card-wrap">' + cardHtml(q, showAnswer) + "</div>";
    html +=
      '<div class="ai-grade-container" style="margin-top: 15px; border-top: 1px dashed #e0e0e0; padding-top: 10px;">';
    html +=
      '  <label style="font-weight: bold; display: block; margin-bottom: 6px; color: #333;">✍️ 你的作答 / 答题思路：</label>';
    html +=
      '  <textarea id="answer-input-' +
      state.paperIndex +
      '" rows="4" placeholder="在此输入你的回答或解题思路..." style="width: 100%; border: 1px solid #ccc; border-radius: 6px; padding: 10px; font-size: 14px; box-sizing: border-box;"></textarea>';
    html +=
      '  <button onclick="submitForAIGrade(' +
      state.paperIndex +
      ')" id="btn-submit-' +
      state.paperIndex +
      '" style="margin-top: 8px; background: #0056b3; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">🤖 AI 智能批改打分</button>';
    html +=
      '  <div id="ai-result-' +
      state.paperIndex +
      '" class="ai-result-box" style="display: none; margin-top: 12px; background: #f8f9fa; padding: 12px; border-radius: 6px; border-left: 4px solid #0056b3;"></div>';
    html += "</div>";
    html +=
      '<div class="paper-nav">' +
      '<button class="btn btn-primary" data-act="prev" ' +
      (state.paperIndex <= 0 ? "disabled" : "") +
      ">上一题</button>" +
      '<button class="btn btn-primary" data-act="next" ' +
      (state.paperIndex >= list.length - 1 ? "disabled" : "") +
      ">下一题</button>" +
      "</div>";

    html +=
      '<details class="answer-card"><summary>答题卡 / 跳转</summary><div class="ac-grid">';
    for (var m = 0; m < list.length; m++) {
      var marked = state.wrong.has(list[m].uid) || state.fav.has(list[m].uid);
      html +=
        '<button class="ac-cell' +
        (m === state.paperIndex ? " cur" : "") +
        (marked ? " marked" : "") +
        '" data-act="jump" data-i="' +
        m +
        '">' +
        (m + 1) +
        "</button>";
    }
    html += "</div></details>";

    $("#view-papers").innerHTML = html;
  }

  // ---------- 视图：分类刷题 ----------
  function renderCategory() {
    var ss = subjects(),
      ts = types();
    var subjCount = countBy(function (q) {
      return q.subject;
    });

    var html =
      '<div class="panel"><h2 class="panel-title">选择科目</h2><div class="subj-grid">';
    html +=
      '<button class="subj-card' +
      (state.catSubject === "all" ? " active" : "") +
      '" data-filter-subject="all"><span class="sc-name">全部</span><span class="sc-cnt">' +
      state.all.length +
      "</span></button>";
    for (var i = 0; i < ss.length; i++) {
      html +=
        '<button class="subj-card' +
        (state.catSubject === ss[i] ? " active" : "") +
        '" data-filter-subject="' +
        escapeHtml(ss[i]) +
        '"><span class="sc-name">' +
        escapeHtml(ss[i]) +
        '</span><span class="sc-cnt">' +
        (subjCount[ss[i]] || 0) +
        "</span></button>";
    }
    html += "</div></div>";

    html +=
      '<div class="panel"><h2 class="panel-title">选择题型</h2><div class="type-chips">';
    html +=
      '<button class="type-chip' +
      (state.catType === "all" ? " active" : "") +
      '" data-filter-type="all">全部</button>';
    for (var t = 0; t < ts.length; t++) {
      html +=
        '<button class="type-chip' +
        (state.catType === ts[t] ? " active" : "") +
        '" data-filter-type="' +
        escapeHtml(ts[t]) +
        '">' +
        escapeHtml(ts[t]) +
        "</button>";
    }
    html += "</div></div>";

    var list = state.all.filter(function (q) {
      return (
        (state.catSubject === "all" || q.subject === state.catSubject) &&
        (state.catType === "all" || q.question_type === state.catType)
      );
    });
    list.sort(function (a, b) {
      return b.year - a.year || a.subject.localeCompare(b.subject, "zh");
    });

    html +=
      '<div class="panel"><div class="result-head">共 <b>' +
      list.length +
      '</b> 题</div><div class="card-list">';
    if (!list.length) {
      html += '<div class="empty">没有符合条件的题目</div>';
    } else {
      for (var k = 0; k < list.length; k++) html += cardHtml(list[k], false);
    }
    html += "</div></div>";
    $("#view-category").innerHTML = html;
  }

  // ---------- 视图：错题本 / 我的收藏 ----------
  function renderList(viewName, set) {
    var list = state.all.filter(function (q) {
      return set.has(q.uid);
    });
    list.sort(function (a, b) {
      return b.year - a.year;
    });
    var title = viewName === "wrong" ? "错题本" : "我的收藏";
    var emptyMsg =
      viewName === "wrong"
        ? "还没有标记错题，刷题时点击“标记错题”即可加入。"
        : "还没有收藏题目，刷题时点击“⭐ 收藏”即可加入。";
    var html =
      '<div class="panel"><div class="result-head">' +
      title +
      " · 共 <b>" +
      list.length +
      '</b> 题</div><div class="card-list">';
    if (!list.length) html += '<div class="empty">' + emptyMsg + "</div>";
    else for (var i = 0; i < list.length; i++) html += cardHtml(list[i], false);
    html += "</div></div>";
    $("#view-" + viewName).innerHTML = html;
  }

  // ---------- 卡片操作 ----------
  function handleCardAction(btn) {
    var card = btn.closest(".q-card");
    if (!card) return;
    var uid = card.dataset.uid;
    var q = null;
    for (var i = 0; i < state.all.length; i++) {
      if (state.all[i].uid === uid) {
        q = state.all[i];
        break;
      }
    }
    if (!q) return;

    var act = btn.dataset.action;
    if (act === "toggle-answer") {
      var an = $(".q-analysis", card);
      var on = an.classList.toggle("show");
      btn.textContent = on ? "隐藏答案" : "显示答案";
    } else if (act === "toggle-wrong") {
      if (state.wrong.has(uid)) {
        state.wrong.delete(uid);
        toast("已移出错题本");
      } else {
        state.wrong.add(uid);
        toast("已加入错题本");
      }
      saveSet(LS.wrong, state.wrong);
      reflectCard(card, uid);
      if (state.view === "wrong") removeCard(card);
      updateBadges();
    } else if (act === "toggle-fav") {
      if (state.fav.has(uid)) {
        state.fav.delete(uid);
        toast("已取消收藏");
      } else {
        state.fav.add(uid);
        toast("已收藏");
      }
      saveSet(LS.fav, state.fav);
      reflectCard(card, uid);
      if (state.view === "favorites") removeCard(card);
      updateBadges();
    }
  }

  function reflectCard(card, uid) {
    var wb = $('[data-action="toggle-wrong"]', card);
    var fb = $('[data-action="toggle-fav"]', card);
    if (wb) {
      var onW = state.wrong.has(uid);
      wb.className = "btn " + (onW ? "btn-wrong-active" : "btn-wrong");
      wb.textContent = onW ? "✓ 已标记错题" : "标记错题";
    }
    if (fb) {
      var onF = state.fav.has(uid);
      fb.className = "btn " + (onF ? "btn-fav-active" : "btn-fav");
      fb.textContent = onF ? "⭐ 已收藏" : "⭐ 收藏";
    }
  }

  function removeCard(card) {
    card.style.transition = "opacity .25s, transform .25s";
    card.style.opacity = "0";
    card.style.transform = "translateY(-6px)";
    setTimeout(function () {
      card.remove();
      var list = $("#view-" + state.view + " .card-list");
      if (list && !list.children.length) render();
    }, 250);
  }

  // ---------- 套卷翻页 ----------
  function handlePaperNav(btn) {
    var list = state.all.filter(function (q) {
      return q.year === state.paperYear;
    });
    var act = btn.dataset.act;
    if (act === "prev" && state.paperIndex > 0) {
      state.paperIndex--;
      renderPapers();
    } else if (act === "next" && state.paperIndex < list.length - 1) {
      state.paperIndex++;
      renderPapers();
    } else if (act === "jump") {
      state.paperIndex = Number(btn.dataset.i);
      renderPapers();
    }
  }

  // ---------- 上传新卷 ----------
  function handleFiles(files) {
    if (!files || !files.length) return;
    var pending = files.length;
    var collected = [];
    Array.prototype.forEach.call(files, function (file) {
      if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
        toast("仅支持 .json 文件：" + file.name);
        if (--pending === 0) finishUpload(collected);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var r = parseLibrary(reader.result);
          if (!r.questions.length) toast("未在 " + file.name + " 中识别到题目");
          else {
            collected = collected.concat(r.questions);
            toast("已从 " + file.name + " 识别 " + r.questions.length + " 题");
          }
        } catch (err) {
          toast("解析失败：" + file.name);
        }
        if (--pending === 0) finishUpload(collected);
      };
      reader.onerror = function () {
        toast("读取失败：" + file.name);
        if (--pending === 0) finishUpload(collected);
      };
      reader.readAsText(file);
    });
  }

  function finishUpload(collected) {
    if (!collected.length) return;
    var before = state.all.length;
    var map = {};
    state.uploaded.forEach(function (q) {
      map[q.uid] = q;
    });
    collected.forEach(function (q) {
      map[q.uid] = q;
    });
    state.uploaded = Object.keys(map).map(function (u) {
      return map[u];
    });
    saveUploaded(state.uploaded);
    mergeLibrary();
    var added = state.all.length - before;
    $("#upload-status").innerHTML =
      '<div class="ok-box">本次共识别 <b>' +
      collected.length +
      "</b> 题，新增 <b>" +
      added +
      "</b> 题，当前题库共 <b>" +
      state.all.length +
      "</b> 题。已保存到本地，刷新后仍有效。</div>";
    var lc = $("#lib-count");
    if (lc) lc.textContent = state.all.length;
    toast("题库已更新，共 " + state.all.length + " 题");
    if (state.view === "home" || state.view === "category") render();
  }

  // ---------- 手动加载基础题库（file:// 兜底） ----------
  function loadBaseFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var r = parseLibrary(reader.result);
      state.base = r.questions;
      state.freq = r.freq;
      mergeLibrary();
      $("#load-banner").classList.add("hidden");
      toast("已加载题库：" + state.all.length + " 题");
      render();
    };
    reader.readAsText(file);
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    // 拖拽上传
    var drop = $("#drop-zone");
    var input = $("#file-input");
    if (input)
      input.addEventListener("change", function () {
        handleFiles(input.files);
        input.value = "";
      });
    if (drop) {
      ["dragover", "dragenter"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.add("drag");
        });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.remove("drag");
        });
      });
      drop.addEventListener("drop", function (e) {
        if (e.dataTransfer && e.dataTransfer.files)
          handleFiles(e.dataTransfer.files);
      });
    }

    // 统一 click 委托
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest(".nav-toggle")) {
        $(".nav").classList.toggle("open");
        return;
      }
      var navA = t.closest(".nav a");
      if (navA) {
        state.view = navA.dataset.target;
        render();
        return;
      }

      var go = t.closest("[data-go]");
      if (go) {
        state.view = go.dataset.go;
        render();
        return;
      }
      var gy = t.closest("[data-go-year]");
      if (gy) {
        state.view = "papers";
        state.paperYear = Number(gy.dataset.goYear);
        state.paperIndex = 0;
        render();
        return;
      }
      var gs = t.closest("[data-go-subject]");
      if (gs) {
        state.view = "category";
        state.catSubject = gs.dataset.goSubject;
        state.catType = "all";
        render();
        return;
      }

      var actBtn = t.closest("[data-action]");
      if (actBtn) {
        handleCardAction(actBtn);
        return;
      }

      var mb = t.closest("[data-mode]");
      if (mb) {
        state.paperMode = mb.dataset.mode;
        renderPapers();
        return;
      }
      var pa = t.closest("[data-act]");
      if (pa) {
        handlePaperNav(pa);
        return;
      }

      var fs = t.closest("[data-filter-subject]");
      if (fs) {
        state.catSubject = fs.dataset.filterSubject;
        renderCategory();
        return;
      }
      var ft = t.closest("[data-filter-type]");
      if (ft) {
        state.catType = ft.dataset.filterType;
        renderCategory();
        return;
      }
    });

    // 统一 change 委托
    document.addEventListener("change", function (e) {
      if (e.target.id === "paper-year") {
        state.paperYear = Number(e.target.value);
        state.paperIndex = 0;
        renderPapers();
        return;
      }
      if (e.target.id === "base-file-input") {
        loadBaseFile(e.target.files && e.target.files[0]);
        return;
      }
    });
  }

  // ---------- 加载失败提示 ----------
  function showLoadBanner() {
    var b = $("#load-banner");
    if (!b) return;
    b.classList.remove("hidden");
    b.innerHTML =
      "<div><b>未自动读取到 questions.json。</b>" +
      "<p>若直接双击打开本页面（file:// 协议），浏览器会拦截本地文件读取。请任选一种方式：</p>" +
      '<p class="banner-opt">1) 启动本地静态服务器后访问，例如在当前目录运行 <code>python -m http.server</code> 后打开 <code>http://localhost:8000/</code></p>' +
      '<p class="banner-opt">2) 手动选择题库文件加载：<input type="file" id="base-file-input" accept=".json,application/json"></p>' +
      "</div>";
  }

  // ---------- 初始化 ----------
  function init() {
    state.wrong = loadSet(LS.wrong);
    state.fav = loadSet(LS.fav);
    state.uploaded = loadUploaded();
    bindEvents();

    fetch("questions.json")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (raw) {
        var r = parseLibrary(raw);
        state.base = r.questions;
        state.freq = r.freq;
        mergeLibrary();
        $("#loading").classList.add("hidden");
        if (!state.base.length) showLoadBanner();
        render();
      })
      .catch(function () {
        state.base = [];
        state.freq = [];
        mergeLibrary();
        $("#loading").classList.add("hidden");
        showLoadBanner();
        render();
      });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
async function submitForAIGrade(qIndex) {
  var question =
    window.currentPaperList && window.currentPaperList[qIndex]
      ? window.currentPaperList[qIndex]
      : null;

  var inputEl = document.getElementById("answer-input-" + qIndex);
  var resultBox = document.getElementById("ai-result-" + qIndex);
  var submitBtn = document.getElementById("btn-submit-" + qIndex);

  if (!inputEl || !inputEl.value.trim()) {
    alert("请先输入你的答案再提交打分哦！");
    return;
  }

  var userAnswer = inputEl.value.trim();
  submitBtn.disabled = true;
  submitBtn.innerText = "⏳ 阅卷老师打分中...";
  resultBox.style.display = "block";
  resultBox.innerHTML =
    "<p style='color: #666; margin: 0;'>AI 正在对照采分点分析您的回答...</p>";

  try {
    var WORKER_URL = "https://haida-ai-grader.xiaojiaixin211.workers.dev/";

    var response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: question ? question.title : "考研主观题",
        analysis: question ? question.analysis || question.answer || "" : "",
        max_score: question ? question.max_score || 10 : 10,
        user_answer: userAnswer,
      }),
    });

    var data = await response.json();

    if (data.error) {
      resultBox.innerHTML =
        "<p style='color: #dc3545; margin: 0;'>" + data.error + "</p>";
    } else {
      var hitHtml =
        data.hit_points && data.hit_points.length > 0
          ? data.hit_points.join("；")
          : "无明显命中";
      var missHtml =
        data.miss_points && data.miss_points.length > 0
          ? data.miss_points.join("；")
          : "无遗漏";

      resultBox.innerHTML =
        '<div style="font-size: 16px; font-weight: bold; color: #28a745; margin-bottom: 8px;">🎯 得分：' +
        data.score +
        " / " +
        data.max_score +
        " 分</div>" +
        '<div style="margin-bottom: 6px; font-size: 13px; color: #212529;"><strong>✅ 命中得分点：</strong> ' +
        hitHtml +
        "</div>" +
        '<div style="margin-bottom: 6px; font-size: 13px; color: #dc3545;"><strong>❌ 遗漏/错误采分点：</strong> ' +
        missHtml +
        "</div>" +
        '<div style="background: #ffffff; padding: 8px 10px; border-radius: 4px; font-size: 13px; color: #495057; border: 1px solid #e9ecef; margin-top: 6px;"><strong>💡 阅卷点评：</strong>' +
        data.feedback +
        "</div>";
    }
  } catch (err) {
    resultBox.innerHTML =
      "<p style='color: #dc3545; margin: 0;'>网络请求失败，请稍后再试。</p>";
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = "🤖 AI 智能批改打分";
  }
}

// 确保网页按钮能全局调用到打分函数
window.submitForAIGrade = submitForAIGrade;
