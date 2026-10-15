"use strict";

const MARKS = ["①", "②", "③", "④", "⑤"];
const SUBJECTS = [
  "개인정보보호의 이해",
  "개인정보보호 제도",
  "개인정보 라이프 사이클 관리",
  "개인정보의 보호조치",
  "개인정보 관리체계",
];
const EXAM_SECONDS = 120 * 60;
const SUBJECT_PASS = 0.4;
const TOTAL_PASS = 0.6;

const QUESTIONS = Array.isArray(window.CPPG_QUESTIONS) ? window.CPPG_QUESTIONS : [];
const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
const ROUNDS = [...new Set(QUESTIONS.map((q) => q.round))].sort();

const app = document.getElementById("app");

// ---------- 저장소 ----------

const STORE_KEY = "cppg.v1";

function loadStore() {
  const empty = { stats: {}, wrong: [], bookmarks: [], history: [], session: null };
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") };
  } catch {
    return empty;
  }
}

const store = loadStore();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 기록만 유지되지 않는다.
  }
}

function recordAttempt(id, correct) {
  const s = (store.stats[id] ||= { tries: 0, correct: 0 });
  s.tries += 1;
  if (correct) s.correct += 1;
  s.last = correct;
  const wrong = new Set(store.wrong);
  if (correct) wrong.delete(id);
  else wrong.add(id);
  store.wrong = [...wrong];
}

function toggleBookmark(id) {
  const set = new Set(store.bookmarks);
  set.has(id) ? set.delete(id) : set.add(id);
  store.bookmarks = [...set];
  save();
}

// ---------- 유틸 ----------

const h = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const label = (q) => `${q.round}회 ${q.no}번`;

// ---------- 세션 ----------

function startSession({ mode, title, ids }) {
  store.session = {
    mode, // "exam" | "practice"
    title,
    ids,
    answers: {},
    idx: 0,
    startedAt: Date.now(),
    timeLimit: mode === "exam" ? EXAM_SECONDS : null,
    finished: false,
  };
  save();
  location.hash = "#/quiz";
}

function gradeSession(sess) {
  const subjects = Object.fromEntries(SUBJECTS.map((s) => [s, { c: 0, t: 0 }]));
  let correct = 0;
  for (const id of sess.ids) {
    const q = BY_ID.get(id);
    const ok = sess.answers[id] === q.answer;
    subjects[q.subject].t += 1;
    if (ok) {
      subjects[q.subject].c += 1;
      correct += 1;
    }
  }
  const total = sess.ids.length;
  const fullExam = sess.mode === "exam" && total === 100;
  const subjectFail = Object.values(subjects).some((s) => s.t && s.c / s.t < SUBJECT_PASS);
  return {
    correct,
    total,
    subjects,
    passed: fullExam ? !subjectFail && correct / total >= TOTAL_PASS : null,
  };
}

function finishSession() {
  const sess = store.session;
  if (!sess || sess.finished) return;
  sess.finished = true;
  sess.endedAt = Date.now();
  if (sess.mode === "exam") {
    for (const id of sess.ids) recordAttempt(id, sess.answers[id] === BY_ID.get(id).answer);
  }
  const g = gradeSession(sess);
  store.history.unshift({
    at: sess.endedAt,
    mode: sess.mode,
    title: sess.title,
    correct: g.correct,
    answered: Object.keys(sess.answers).length,
    total: g.total,
    passed: g.passed,
    seconds: Math.round((sess.endedAt - sess.startedAt) / 1000),
    subjects: g.subjects,
  });
  store.history = store.history.slice(0, 200);
  save();
  location.hash = "#/result";
}

// ---------- 화면: 홈 ----------

function viewNoData() {
  app.innerHTML = `
    <div class="card">
      <h1>문제 데이터가 없습니다</h1>
      <p class="muted">저작권 보호를 위해 문제 데이터는 저장소에 포함되어 있지 않습니다. 직접 구매한 PDF로 데이터를 생성하세요.</p>
      <pre class="card" style="background:var(--surface-2);overflow-x:auto">pip install pypdf pypdfium2
python scripts/parse_pdf.py &lt;문제집 PDF 경로&gt;</pre>
      <p class="muted small">생성 후 이 페이지를 새로고침하면 됩니다.</p>
    </div>`;
}

function viewHome() {
  const solved = Object.keys(store.stats).length;
  const tries = Object.values(store.stats).reduce((a, s) => a + s.tries, 0);
  const right = Object.values(store.stats).reduce((a, s) => a + s.correct, 0);
  const sess = store.session;

  app.innerHTML = `
    <h1>CPPG 기출 풀이</h1>
    <p class="muted">총 ${QUESTIONS.length}문항 · 푼 문제 ${solved}개 · 정답률 ${pct(right, tries)}% · 오답노트 ${store.wrong.length}개</p>

    ${
      sess && !sess.finished
        ? `<div class="card" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
             <div><strong>이어서 풀기</strong><div class="muted small">${h(sess.title)} · ${Object.keys(sess.answers).length}/${sess.ids.length} 풀이</div></div>
             <div class="btn-row"><a class="btn primary" href="#/quiz">계속하기</a><button class="btn" data-act="discard">그만두기</button></div>
           </div>`
        : ""
    }

    <h2>실전 모의고사</h2>
    <div class="grid">
      ${ROUNDS.map(
        (r) => `
        <div class="card mode-card">
          <h3>${r}회차</h3>
          <p>100문항 · 120분 · 제출 후 채점<br>과목별 40%, 총점 60% 합격 기준</p>
          <button class="btn primary" data-act="exam" data-round="${r}">시작</button>
        </div>`
      ).join("")}
    </div>

    <h2>연습 모드</h2>
    <div class="card">
      <p class="muted small" style="margin-top:0">한 문제씩 풀고 바로 정답과 해설을 확인합니다.</p>
      <div class="form-row">
        <label class="field">회차
          <select id="p-round"><option value="">전체</option>${ROUNDS.map((r) => `<option value="${r}">${r}회차</option>`).join("")}</select>
        </label>
        <label class="field">과목
          <select id="p-subject"><option value="">전체</option>${SUBJECTS.map((s) => `<option>${h(s)}</option>`).join("")}</select>
        </label>
        <label class="field">문항 수
          <input id="p-count" type="number" min="1" max="300" value="20" style="width:90px">
        </label>
      </div>
      <div class="form-row">
        <label class="check"><input id="p-shuffle" type="checkbox" checked> 순서 섞기</label>
        <label class="check"><input id="p-unsolved" type="checkbox"> 안 푼 문제만</label>
      </div>
      <button class="btn primary" data-act="practice">연습 시작</button>
    </div>

    <h2>복습</h2>
    <div class="grid">
      <div class="card mode-card">
        <h3>오답 다시 풀기</h3>
        <p>틀린 문제 ${store.wrong.length}개. 맞히면 오답노트에서 빠집니다.</p>
        <button class="btn" data-act="wrong" ${store.wrong.length ? "" : "disabled"}>시작</button>
      </div>
      <div class="card mode-card">
        <h3>북마크 풀기</h3>
        <p>북마크한 문제 ${store.bookmarks.length}개.</p>
        <button class="btn" data-act="bookmarks" ${store.bookmarks.length ? "" : "disabled"}>시작</button>
      </div>
    </div>`;

  app.onclick = (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "discard") {
      if (confirm("진행 중인 풀이를 그만둘까요? 기록은 남지 않습니다.")) {
        store.session = null;
        save();
        render();
      }
    } else if (act === "exam") {
      if (!confirmReplace()) return;
      const r = Number(btn.dataset.round);
      startSession({ mode: "exam", title: `${r}회차 모의고사`, ids: QUESTIONS.filter((q) => q.round === r).map((q) => q.id) });
    } else if (act === "practice") {
      if (!confirmReplace()) return;
      const round = document.getElementById("p-round").value;
      const subject = document.getElementById("p-subject").value;
      const count = Math.max(1, Number(document.getElementById("p-count").value) || 20);
      let pool = QUESTIONS.filter(
        (q) => (!round || q.round === Number(round)) && (!subject || q.subject === subject)
      );
      if (document.getElementById("p-unsolved").checked) pool = pool.filter((q) => !store.stats[q.id]);
      if (!pool.length) return alert("조건에 맞는 문제가 없습니다.");
      if (document.getElementById("p-shuffle").checked) pool = shuffle(pool);
      const title = ["연습", round && `${round}회차`, subject].filter(Boolean).join(" · ");
      startSession({ mode: "practice", title, ids: pool.slice(0, count).map((q) => q.id) });
    } else if (act === "wrong" || act === "bookmarks") {
      if (!confirmReplace()) return;
      startSession({
        mode: "practice",
        title: act === "wrong" ? "오답 다시 풀기" : "북마크 풀기",
        ids: shuffle(store[act].filter((id) => BY_ID.has(id))),
      });
    }
  };
}

function confirmReplace() {
  const s = store.session;
  return !s || s.finished || confirm("진행 중인 풀이가 있습니다. 새로 시작할까요?");
}

// ---------- 화면: 문제 풀이 ----------

let timerHandle = null;

function viewQuiz() {
  const sess = store.session;
  if (!sess) return (location.hash = "#/");
  if (sess.finished && !sess.reviewing) return (location.hash = "#/result");

  const review = Boolean(sess.reviewing);
  const id = sess.ids[sess.idx];
  const q = BY_ID.get(id);
  const picked = sess.answers[id];
  const revealed = review || (sess.mode === "practice" && picked != null);
  const answeredCount = Object.keys(sess.answers).length;
  const bookmarked = store.bookmarks.includes(id);
  const isLast = sess.idx === sess.ids.length - 1;

  const choiceClass = (i) => {
    const n = i + 1;
    if (revealed) {
      if (n === q.answer) return "correct";
      if (n === picked) return "wrong";
      return "";
    }
    return n === picked ? "selected" : "";
  };

  const omrClass = (qid, i) => {
    const cls = [];
    if (i === sess.idx) cls.push("current");
    const a = sess.answers[qid];
    if (a != null) {
      if (review || sess.mode === "practice") cls.push(a === BY_ID.get(qid).answer ? "correct" : "wrong");
      else cls.push("answered");
    } else if (review) cls.push("wrong");
    return cls.join(" ");
  };

  app.innerHTML = `
    <div class="quiz-head">
      <div>
        <strong>${h(sess.title)}</strong>${review ? ' <span class="tag">검토</span>' : ""}
        <div class="muted small">${sess.idx + 1} / ${sess.ids.length} · ${answeredCount}문항 응답</div>
      </div>
      <div class="btn-row" style="align-items:center">
        ${sess.timeLimit && !review ? `<span class="timer" id="timer"></span>` : ""}
        ${
          review
            ? `<a class="btn" href="#/result">결과로</a>`
            : `<button class="btn ${sess.mode === "exam" ? "primary" : ""}" data-act="submit">${sess.mode === "exam" ? "제출" : "끝내기"}</button>`
        }
      </div>
    </div>
    <div class="progress"><div style="width:${((sess.idx + 1) / sess.ids.length) * 100}%"></div></div>

    <div class="card">
      <div class="q-meta">
        <span class="tag">${label(q)}</span>
        <span class="tag">${h(q.subject)}</span>
        ${store.stats[id] ? `<span class="tag">${store.stats[id].correct}/${store.stats[id].tries} 정답</span>` : ""}
        <span style="flex:1"></span>
        <button class="icon-btn small ${/표|그림|도표|사례/.test(q.stem) ? "hint" : ""}" data-act="pages" title="원본 페이지 보기 (표·그림 확인)">${/표|그림|도표|사례/.test(q.stem) ? "표·그림은 원본 보기" : "원본 보기"}</button>
        <button class="icon-btn" data-act="bookmark" title="북마크 (B)" aria-pressed="${bookmarked}">${bookmarked ? "★" : "☆"}</button>
      </div>
      <p class="q-stem"><span class="q-num">${q.no}.</span>${h(q.stem)}</p>
      <div class="choices">
        ${q.choices
          .map(
            (c, i) => `
          <button class="choice ${choiceClass(i)}" data-choice="${i + 1}" ${revealed ? "disabled" : ""}>
            <span class="mark">${MARKS[i]}</span><span>${h(c)}</span>
          </button>`
          )
          .join("")}
      </div>
      ${
        revealed
          ? `<div class="explain">
               <div class="verdict ${picked === q.answer ? "good" : "bad"}">
                 ${picked == null ? "미응답" : picked === q.answer ? "정답입니다" : "오답입니다"} · 정답 ${MARKS[q.answer - 1]}
               </div>
               <p>${h(q.explanation) || '<span class="muted">해설이 없습니다.</span>'}</p>
             </div>`
          : ""
      }
    </div>

    <div class="quiz-foot">
      <button class="btn" data-act="prev" ${sess.idx === 0 ? "disabled" : ""}>← 이전</button>
      ${
        isLast && !review
          ? `<button class="btn primary" data-act="submit">${sess.mode === "exam" ? "제출하기" : "끝내기"}</button>`
          : `<button class="btn primary" data-act="next" ${isLast ? "disabled" : ""}>다음 →</button>`
      }
    </div>

    <div class="omr">
      ${sess.ids.map((qid, i) => `<button class="${omrClass(qid, i)}" data-goto="${i}">${i + 1}</button>`).join("")}
    </div>
    <p class="kbd-hint"><kbd>1</kbd>~<kbd>5</kbd> 선택 · <kbd>←</kbd><kbd>→</kbd> 이동 · <kbd>B</kbd> 북마크</p>`;

  const go = (i) => {
    sess.idx = Math.min(Math.max(0, i), sess.ids.length - 1);
    save();
    render();
    window.scrollTo({ top: 0 });
  };

  const choose = (n) => {
    if (revealed) return;
    if (sess.mode === "practice") {
      sess.answers[id] = n;
      recordAttempt(id, n === q.answer);
    } else {
      sess.answers[id] = sess.answers[id] === n ? undefined : n;
      if (sess.answers[id] === undefined) delete sess.answers[id];
    }
    save();
    render();
  };

  const submit = () => {
    const left = sess.ids.length - Object.keys(sess.answers).length;
    const msg =
      sess.mode === "exam"
        ? left
          ? `${left}문항이 비어 있습니다. 제출할까요?`
          : "제출할까요?"
        : "연습을 끝낼까요?";
    if (confirm(msg)) finishSession();
  };

  app.onclick = (e) => {
    const t = e.target.closest("[data-choice],[data-act],[data-goto]");
    if (!t) return;
    if (t.dataset.choice) choose(Number(t.dataset.choice));
    else if (t.dataset.goto) go(Number(t.dataset.goto));
    else if (t.dataset.act === "prev") go(sess.idx - 1);
    else if (t.dataset.act === "next") go(sess.idx + 1);
    else if (t.dataset.act === "submit") submit();
    else if (t.dataset.act === "bookmark") {
      toggleBookmark(id);
      render();
    } else if (t.dataset.act === "pages") openPages(q);
  };

  keyHandler = (e) => {
    if (e.target.matches("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.getElementById("page-viewer").open) return;
    if (e.key >= "1" && e.key <= "5") choose(Number(e.key));
    else if (e.key === "ArrowLeft") go(sess.idx - 1);
    else if (e.key === "ArrowRight" || (e.key === "Enter" && revealed)) go(sess.idx + 1);
    else if (e.key === "b" || e.key === "B") {
      toggleBookmark(id);
      render();
    }
  };

  if (sess.timeLimit && !review) {
    const tick = () => {
      const left = sess.timeLimit - (Date.now() - sess.startedAt) / 1000;
      const el = document.getElementById("timer");
      if (el) {
        el.textContent = `남은 시간 ${fmtTime(left)}`;
        el.classList.toggle("low", left < 600);
      }
      if (left <= 0) {
        clearInterval(timerHandle);
        alert("시험 시간이 끝났습니다. 자동으로 제출합니다.");
        finishSession();
      }
    };
    tick();
    timerHandle = setInterval(tick, 1000);
  }
}

function openPages(q) {
  const dlg = document.getElementById("page-viewer");
  document.getElementById("page-viewer-title").textContent = `${label(q)} 원본 (p.${q.pages.join(", ")})`;
  document.getElementById("page-viewer-body").innerHTML = q.pages
    .map(
      (p) =>
        `<img src="data/pages/p${String(p).padStart(3, "0")}.png" alt="${p}페이지" onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'empty',textContent:'페이지 이미지가 없습니다. parse_pdf.py를 pypdfium2와 함께 다시 실행하세요.'}))">`
    )
    .join("");
  dlg.showModal();
}

// ---------- 화면: 결과 ----------

function viewResult() {
  const sess = store.session;
  if (!sess || !sess.finished) return (location.hash = "#/");
  sess.reviewing = false;
  const g = gradeSession(sess);
  const seconds = Math.round((sess.endedAt - sess.startedAt) / 1000);
  const wrongIds = sess.ids.filter((id) => sess.answers[id] !== BY_ID.get(id).answer);

  app.innerHTML = `
    <h1>${h(sess.title)} 결과</h1>
    <p class="muted">${fmtDate(sess.endedAt)} · 소요 ${fmtTime(seconds)}</p>

    <div class="card" style="display:flex;gap:28px;align-items:center;flex-wrap:wrap">
      <div>
        <div class="score-big">${g.correct}<span class="muted" style="font-size:1.2rem"> / ${g.total}</span></div>
        <div class="muted">정답률 ${pct(g.correct, g.total)}%</div>
      </div>
      ${g.passed === null ? "" : `<div class="${g.passed ? "pass" : "fail"}" style="font-size:1.4rem">${g.passed ? "합격" : "불합격"}</div>`}
    </div>

    <h2>과목별</h2>
    <div class="card" style="padding:8px 16px">
      <table>
        <thead><tr><th>과목</th><th class="num">정답</th><th class="num">정답률</th><th></th></tr></thead>
        <tbody>
          ${SUBJECTS.filter((s) => g.subjects[s].t)
            .map((s) => {
              const { c, t } = g.subjects[s];
              const low = c / t < SUBJECT_PASS;
              return `<tr>
                <td>${h(s)}</td>
                <td class="num">${c}/${t}</td>
                <td class="num ${low ? "fail" : ""}">${pct(c, t)}%${low && g.passed !== null ? " 과락" : ""}</td>
                <td style="width:30%"><div class="bar ${low ? "low" : ""}"><div style="width:${pct(c, t)}%"></div></div></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>

    <div class="btn-row" style="margin-top:20px">
      <button class="btn primary" data-act="review">전체 검토</button>
      <button class="btn" data-act="retry-wrong" ${wrongIds.length ? "" : "disabled"}>틀린 ${wrongIds.length}문제 다시 풀기</button>
      <a class="btn" href="#/">홈으로</a>
    </div>`;

  app.onclick = (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    if (t.dataset.act === "review") {
      sess.reviewing = true;
      sess.idx = 0;
      save();
      location.hash = "#/quiz";
    } else if (t.dataset.act === "retry-wrong") {
      startSession({ mode: "practice", title: `${sess.title} 오답`, ids: wrongIds });
    }
  };
}

// ---------- 화면: 목록 (오답노트 / 북마크) ----------

function viewList(kind) {
  const ids = store[kind].filter((id) => BY_ID.has(id));
  const qs = ids.map((id) => BY_ID.get(id)).sort((a, b) => a.round - b.round || a.no - b.no);
  const title = kind === "wrong" ? "오답노트" : "북마크";

  app.innerHTML = `
    <h1>${title}</h1>
    <p class="muted">${qs.length}문항${kind === "wrong" ? " · 다시 풀어서 맞히면 자동으로 빠집니다." : ""}</p>
    ${
      qs.length
        ? `<div class="btn-row" style="margin:14px 0"><button class="btn primary" data-act="solve">모두 풀기</button>
           ${kind === "wrong" ? '<button class="btn" data-act="clear">비우기</button>' : ""}</div>
           <div class="card" style="padding:4px 16px">
             ${qs
               .map(
                 (q) => `<div class="list-item">
                   <span class="tag">${label(q)}</span>
                   <span class="text" title="${h(q.stem)}">${h(q.stem)}</span>
                   <button class="icon-btn" data-solve="${q.id}" title="이 문제 풀기">풀기</button>
                   <button class="icon-btn" data-remove="${q.id}" title="목록에서 빼기">✕</button>
                 </div>`
               )
               .join("")}
           </div>`
        : `<div class="card empty">비어 있습니다.</div>`
    }`;

  app.onclick = (e) => {
    const t = e.target.closest("[data-act],[data-solve],[data-remove]");
    if (!t) return;
    if (t.dataset.remove) {
      store[kind] = store[kind].filter((id) => id !== t.dataset.remove);
      save();
      render();
    } else if (t.dataset.solve) {
      if (!confirmReplace()) return;
      startSession({ mode: "practice", title, ids: [t.dataset.solve] });
    } else if (t.dataset.act === "solve") {
      if (!confirmReplace()) return;
      startSession({ mode: "practice", title, ids: shuffle(qs.map((q) => q.id)) });
    } else if (t.dataset.act === "clear" && confirm("오답노트를 비울까요?")) {
      store.wrong = [];
      save();
      render();
    }
  };
}

// ---------- 화면: 기록 ----------

function viewHistory() {
  const rows = store.history;
  app.innerHTML = `
    <h1>풀이 기록</h1>
    <p class="muted">최근 ${rows.length}회</p>
    ${
      rows.length
        ? `<div class="card" style="padding:8px 16px;overflow-x:auto">
             <table>
               <thead><tr><th>날짜</th><th>구분</th><th class="num">점수</th><th class="num">정답률</th><th class="num">소요</th><th></th></tr></thead>
               <tbody>
                 ${rows
                   .map(
                     (r) => `<tr>
                       <td class="small">${fmtDate(r.at)}</td>
                       <td>${h(r.title)}</td>
                       <td class="num">${r.correct}/${r.total}</td>
                       <td class="num">${pct(r.correct, r.total)}%</td>
                       <td class="num small">${fmtTime(r.seconds)}</td>
                       <td>${r.passed == null ? "" : `<span class="${r.passed ? "pass" : "fail"}">${r.passed ? "합격" : "불합격"}</span>`}</td>
                     </tr>`
                   )
                   .join("")}
               </tbody>
             </table>
           </div>
           <div class="btn-row" style="margin-top:20px">
             <button class="btn" data-act="export">기록 내보내기</button>
             <label class="btn">기록 가져오기<input type="file" accept="application/json" id="import" hidden></label>
             <button class="btn" data-act="reset">전체 초기화</button>
           </div>`
        : `<div class="card empty">아직 기록이 없습니다.</div>
           <div class="btn-row" style="margin-top:20px">
             <label class="btn">기록 가져오기<input type="file" accept="application/json" id="import" hidden></label>
           </div>`
    }`;

  app.onclick = (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    if (t.dataset.act === "export") {
      const blob = new Blob([JSON.stringify(store, null, 1)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(blob),
        download: `cppg-기록-${new Date().toISOString().slice(0, 10)}.json`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    } else if (t.dataset.act === "reset" && confirm("풀이 기록, 오답노트, 북마크를 모두 지울까요?")) {
      Object.assign(store, { stats: {}, wrong: [], bookmarks: [], history: [], session: null });
      save();
      render();
    }
  };

  document.getElementById("import").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data.stats !== "object") throw new Error();
      Object.assign(store, data);
      save();
      render();
    } catch {
      alert("올바른 기록 파일이 아닙니다.");
    }
  };
}

// ---------- 라우터 ----------

let keyHandler = null;
document.addEventListener("keydown", (e) => keyHandler && keyHandler(e));

function render() {
  clearInterval(timerHandle);
  keyHandler = null;
  app.onclick = null;
  const route = location.hash.replace(/^#\/?/, "") || "";
  document.querySelectorAll(".topbar nav a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === `#/${route}`);
  });
  if (!QUESTIONS.length) return viewNoData();
  if (route === "quiz") viewQuiz();
  else if (route === "result") viewResult();
  else if (route === "wrong") viewList("wrong");
  else if (route === "bookmarks") viewList("bookmarks");
  else if (route === "history") viewHistory();
  else viewHome();
}

window.addEventListener("hashchange", render);

// ---------- 테마 ----------

(function initTheme() {
  const root = document.documentElement;
  let saved = null;
  try {
    saved = localStorage.getItem("cppg.theme");
  } catch {}
  const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "dark" : "light";
  document.getElementById("theme-toggle").onclick = () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("cppg.theme", root.dataset.theme);
    } catch {}
  };
})();

render();
