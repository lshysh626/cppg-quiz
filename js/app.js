"use strict";

// ═══════════════════════════════════════════════════════════
//  CPPG 기출 마스터
//  문제 데이터는 사용자가 불러온 PDF에서 브라우저 안에서 만들고 IndexedDB에만 둔다.
//  풀이 기록·폴더는 localStorage에 둔다.
// ═══════════════════════════════════════════════════════════

const PDFJS_WORKER = "vendor/pdfjs/pdf.worker.min.js";
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

const MARKS = ["①", "②", "③", "④", "⑤"];
const SUBJECTS = CPPGParser.SUBJECTS;
const SUBJECT_COUNTS = [10, 20, 25, 30, 15]; // 실제 시험 과목별 문항 수
const EXAM_SECONDS = 120 * 60;
const SUBJECT_PASS = 0.4;
const TOTAL_PASS = 0.6;
const MODES = {
  immediate: { label: "⚡ 즉시 채점", desc: "답을 고르면 바로 채점하고 해설을 보여 줍니다." },
  bulk: { label: "🎯 실전 모드", desc: "실제 시험처럼 모두 푼 뒤 한 번에 채점합니다." },
  study: { label: "📖 학습 모드", desc: "정답과 해설을 미리 보며 개념을 익힙니다. 기록에는 남지 않습니다." },
};

const contentEl = document.getElementById("content");
const appEl = document.getElementById("app");

let QUESTIONS = [];
let BY_ID = new Map();
let META = null; // { fileName, loadedAt, problems }

// ─── 저장소 ─────────────────────────────────────────────

const STORE_KEY = "cppg.master.v1";

function loadStore() {
  const empty = { stats: {}, wrong: [], folders: [], history: [], session: null, mode: "immediate" };
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
    toast("기록을 저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.");
  }
}

function recordAttempt(id, correct) {
  const s = (store.stats[id] ||= { tries: 0, correct: 0 });
  s.tries += 1;
  if (correct) s.correct += 1;
  s.last = correct;
  s.at = Date.now();
  const wrong = new Set(store.wrong);
  correct ? wrong.delete(id) : wrong.add(id);
  store.wrong = [...wrong];
}

// ─── 유틸 ───────────────────────────────────────────────

const h = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);
const uid = () => Math.random().toString(36).slice(2, 10);
const label = (q) => `${q.round}회 ${q.no}번`;

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const hh = Math.floor(sec / 3600);
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function barClass(ratio) {
  return ratio < SUBJECT_PASS ? "low" : ratio < TOTAL_PASS ? "mid" : "";
}

let toastTimer = null;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const el = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2200);
}

// ─── 다이얼로그 ─────────────────────────────────────────

const dialogEl = document.getElementById("dialog");

function openDialog({ title, body = "", actions, onOpen }) {
  return new Promise((resolve) => {
    document.getElementById("dialog-title").textContent = title;
    document.getElementById("dialog-body").innerHTML = body;
    const actionsEl = document.getElementById("dialog-actions");
    actionsEl.innerHTML = "";
    const close = (value) => {
      dialogEl.hidden = true;
      dialogEl.onkeydown = null;
      resolve(value);
    };
    for (const a of actions) {
      const btn = Object.assign(document.createElement("button"), { className: `btn ${a.cls || ""}`, textContent: a.label });
      btn.onclick = () => close(a.value());
      actionsEl.append(btn);
    }
    dialogEl.onclick = (e) => e.target === dialogEl && close(undefined);
    dialogEl.onkeydown = (e) => {
      if (e.key === "Escape") close(undefined);
      if (e.key === "Enter" && e.target.tagName === "INPUT") actionsEl.lastElementChild.click();
    };
    dialogEl.hidden = false;
    onOpen?.(dialogEl, close);
    (dialogEl.querySelector("input, select") || actionsEl.lastElementChild).focus();
  });
}

const confirmBox = (title, body = "", okLabel = "확인", danger = false) =>
  openDialog({
    title,
    body: body && `<p>${body}</p>`,
    actions: [
      { label: "취소", value: () => false },
      { label: okLabel, cls: danger ? "danger" : "primary", value: () => true },
    ],
  });

const alertBox = (title, body = "") =>
  openDialog({ title, body: body && `<p>${body}</p>`, actions: [{ label: "확인", cls: "primary", value: () => true }] });

const promptBox = (title, { value = "", placeholder = "" } = {}) =>
  openDialog({
    title,
    body: `<label class="field"><input id="dialog-input" value="${h(value)}" placeholder="${h(placeholder)}" maxlength="40"></label>`,
    actions: [
      { label: "취소", value: () => null },
      { label: "확인", cls: "primary", value: () => document.getElementById("dialog-input").value.trim() || null },
    ],
  });

// ─── 문제 데이터 (PDF) ──────────────────────────────────

async function loadData() {
  try {
    const saved = await KV.get("questions");
    if (saved && Array.isArray(saved.questions)) {
      QUESTIONS = saved.questions;
      META = { fileName: saved.fileName, loadedAt: saved.loadedAt, problems: saved.problems || [] };
    }
  } catch (e) {
    console.error(e);
  }
  BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
}

async function importPdf(file, onProgress) {
  if (!window.pdfjsLib) throw new Error("PDF 엔진을 불러오지 못했습니다. 인터넷 연결을 확인하세요.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const { questions, problems } = await CPPGParser.parse(pdf, onProgress);
  pdf.destroy();
  if (problems.length > 30) throw new Error(`파싱에 실패한 문항이 너무 많습니다 (${problems.length}건).`);
  const record = { questions, problems, fileName: file.name, loadedAt: Date.now() };
  await KV.set("pdf", bytes.buffer);
  await KV.set("questions", record);
  pdfDocPromise = null;
  await loadData();
  return record;
}

async function clearData() {
  await KV.del("questions");
  await KV.del("pdf");
  pdfDocPromise = null;
  QUESTIONS = [];
  BY_ID = new Map();
  META = null;
}

let pdfDocPromise = null;
function getPdfDoc() {
  pdfDocPromise ||= KV.get("pdf").then((buf) => {
    if (!buf) throw new Error("저장된 PDF가 없습니다.");
    return pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  });
  pdfDocPromise.catch(() => (pdfDocPromise = null));
  return pdfDocPromise;
}

function dropzoneHTML() {
  return `
    <div class="dropzone" id="dropzone" tabindex="0" role="button">
      <div class="big">📄</div>
      <h3>문제집 PDF 불러오기</h3>
      <p class="muted small">컴공로드맵 CPPG 실전 300제 PDF를 끌어다 놓거나 클릭해서 선택하세요.<br>
      파일은 서버로 올라가지 않고 이 브라우저 안에서만 분석·저장됩니다.</p>
      <input type="file" id="pdf-input" accept="application/pdf" hidden>
      <div id="import-progress" hidden>
        <div class="progress-bar"><div style="width:0%"></div></div>
        <p class="muted small" style="margin-top:0.5rem" id="import-label">분석 중…</p>
      </div>
    </div>`;
}

function bindDropzone(onDone) {
  const zone = document.getElementById("dropzone");
  if (!zone) return;
  const input = document.getElementById("pdf-input");
  let busy = false;
  const run = async (file) => {
    if (!file || busy) return;
    if (!/\.pdf$/i.test(file.name)) return alertBox("PDF 파일이 아닙니다", "문제집 PDF 파일을 선택하세요.");
    busy = true;
    const prog = document.getElementById("import-progress");
    const bar = prog.querySelector(".progress-bar > div");
    const lbl = document.getElementById("import-label");
    prog.hidden = false;
    try {
      const rec = await importPdf(file, (r) => {
        bar.style.width = `${Math.round(r * 100)}%`;
        lbl.textContent = `페이지 분석 중… ${Math.round(r * 100)}%`;
      });
      toast(`${rec.questions.length}문항을 불러왔습니다.`);
      renderSidebar();
      onDone?.();
    } catch (e) {
      console.error(e);
      prog.hidden = true;
      alertBox("불러오지 못했습니다", h(e.message || e));
    } finally {
      busy = false;
    }
  };
  zone.onclick = (e) => e.target !== input && input.click();
  zone.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && input.click();
  input.onchange = () => run(input.files[0]);
  zone.ondragover = (e) => {
    e.preventDefault();
    zone.classList.add("over");
  };
  zone.ondragleave = () => zone.classList.remove("over");
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    run(e.dataTransfer.files[0]);
  };
}

// ─── 폴더 (다시 볼 문제) ────────────────────────────────

const folderById = (id) => store.folders.find((f) => f.id === id);
const childFolders = (parentId) => store.folders.filter((f) => (f.parentId || null) === parentId);

function folderItemsDeep(id, acc = new Set()) {
  const f = folderById(id);
  if (!f) return acc;
  f.items.forEach((q) => acc.add(q));
  childFolders(id).forEach((c) => folderItemsDeep(c.id, acc));
  return acc;
}

function folderPath(id) {
  const names = [];
  for (let f = folderById(id); f; f = folderById(f.parentId)) names.unshift(f.name);
  return names.join(" / ");
}

function folderOptions(parentId = null, depth = 0) {
  return childFolders(parentId)
    .map((f) => `<option value="${f.id}">${"　".repeat(depth)}${depth ? "└ " : ""}${h(f.name)}</option>` + folderOptions(f.id, depth + 1))
    .join("");
}

function createFolder(name, parentId = null) {
  const f = { id: uid(), name, parentId, items: [], createdAt: Date.now() };
  store.folders.push(f);
  save();
  return f;
}

function deleteFolder(id) {
  childFolders(id).forEach((c) => deleteFolder(c.id));
  store.folders = store.folders.filter((f) => f.id !== id);
}

const foldersOf = (qid) => store.folders.filter((f) => f.items.includes(qid));

async function openBookmarkModal(qid, onChange) {
  const q = BY_ID.get(qid);
  const render = (dlg) => {
    const current = foldersOf(qid);
    dlg.querySelector("#bm-current").innerHTML = current.length
      ? current.map((f) => `<span class="chip">${h(folderPath(f.id))}<button data-unbm="${f.id}" title="이 폴더에서 빼기">✕</button></span>`).join("")
      : `<span class="muted small">아직 저장된 폴더가 없습니다.</span>`;
    const sel = dlg.querySelector("#bm-folder");
    const keep = sel.value;
    sel.innerHTML = store.folders.length ? folderOptions() : `<option value="">폴더를 먼저 만들어 주세요</option>`;
    if (keep && folderById(keep)) sel.value = keep;
  };
  await openDialog({
    title: "⭐ 다시 볼 문제 저장",
    body: `
      <p class="muted small">${h(label(q))} · ${h(q.stem.slice(0, 60))}${q.stem.length > 60 ? "…" : ""}</p>
      <div class="field">현재 저장된 폴더<div class="chip-list" id="bm-current"></div></div>
      <label class="field">추가할 폴더 선택<select id="bm-folder"></select></label>
      <div class="field">새 폴더 만들기
        <div class="btn-row" style="flex-wrap:nowrap">
          <input id="bm-new" class="input" placeholder="예: 헷갈리는 법조항" maxlength="40" style="flex:1;min-width:0">
          <button class="btn small" id="bm-create">생성</button>
        </div>
      </div>`,
    actions: [
      { label: "닫기", value: () => null },
      {
        label: "저장",
        cls: "gold",
        value: () => {
          const f = folderById(document.getElementById("bm-folder").value);
          if (f && !f.items.includes(qid)) {
            f.items.push(qid);
            save();
            toast(`'${f.name}'에 저장했습니다.`);
          }
          return f;
        },
      },
    ],
    onOpen: (dlg) => {
      render(dlg);
      dlg.querySelector("#bm-create").onclick = () => {
        const input = dlg.querySelector("#bm-new");
        const name = input.value.trim();
        if (!name) return input.focus();
        const f = createFolder(name);
        input.value = "";
        render(dlg);
        dlg.querySelector("#bm-folder").value = f.id;
      };
      dlg.querySelector("#bm-new").onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          dlg.querySelector("#bm-create").click();
        }
      };
      dlg.querySelector("#bm-current").onclick = (e) => {
        const id = e.target.closest("[data-unbm]")?.dataset.unbm;
        if (!id) return;
        const f = folderById(id);
        f.items = f.items.filter((x) => x !== qid);
        save();
        render(dlg);
      };
    },
  });
  onChange?.();
}

// ─── 세션 ───────────────────────────────────────────────

function startSession({ title, ids, kind, timeLimit = null }) {
  if (!ids.length) return alertBox("풀 문제가 없습니다");
  store.session = {
    title,
    kind,
    mode: store.mode,
    ids,
    answers: {},
    idx: 0,
    elapsed: 0,
    timeLimit: store.mode === "study" ? null : timeLimit,
    finished: false,
  };
  save();
  go("quiz");
}

async function startSessionSafely(opts) {
  const s = store.session;
  if (s && !s.finished && !(await confirmBox("진행 중인 풀이가 있습니다", "새로 시작하면 진행 중인 풀이는 사라집니다.", "새로 시작"))) return;
  startSession(opts);
}

function buildMockExam() {
  return SUBJECTS.flatMap((s, i) => shuffle(QUESTIONS.filter((q) => q.subject === s)).slice(0, SUBJECT_COUNTS[i])).map((q) => q.id);
}

function gradeSession(sess) {
  const subjects = Object.fromEntries(SUBJECTS.map((s) => [s, { c: 0, t: 0 }]));
  let correct = 0;
  for (const id of sess.ids) {
    const q = BY_ID.get(id);
    if (!q) continue;
    const ok = sess.answers[id] === q.answer;
    subjects[q.subject].t += 1;
    if (ok) {
      subjects[q.subject].c += 1;
      correct += 1;
    }
  }
  const total = sess.ids.length;
  // 과목 구성이 실제 시험(100문항)과 같을 때만 합격 여부를 판정한다
  const examShape = total === 100 && SUBJECTS.every((s, i) => subjects[s].t === SUBJECT_COUNTS[i]);
  const subjectFail = SUBJECTS.some((s) => subjects[s].t && subjects[s].c / subjects[s].t < SUBJECT_PASS);
  return {
    correct,
    total,
    answered: Object.keys(sess.answers).length,
    subjects,
    passed: examShape ? !subjectFail && correct / total >= TOTAL_PASS : null,
  };
}

function finishSession() {
  const sess = store.session;
  if (!sess || sess.finished) return;
  sess.finished = true;
  sess.endedAt = Date.now();
  if (sess.mode === "study") {
    store.session = null;
    save();
    toast("학습을 마쳤습니다.");
    return go("select");
  }
  if (sess.mode === "bulk") {
    for (const id of sess.ids) if (sess.answers[id] != null) recordAttempt(id, sess.answers[id] === BY_ID.get(id)?.answer);
  }
  const g = gradeSession(sess);
  store.history.unshift({
    at: sess.endedAt,
    title: sess.title,
    kind: sess.kind,
    mode: sess.mode,
    correct: g.correct,
    answered: g.answered,
    total: g.total,
    passed: g.passed,
    seconds: Math.round(sess.elapsed),
    subjects: g.subjects,
  });
  store.history = store.history.slice(0, 300);
  save();
  go("result");
}

// ─── 라우팅 ─────────────────────────────────────────────

let cleanup = [];
let keyHandler = null;

function go(view, sub = "") {
  const hash = `#/${view}${sub ? "/" + sub : ""}`;
  if (location.hash === hash) render();
  else location.hash = hash;
}

function render() {
  cleanup.forEach((fn) => fn());
  cleanup = [];
  keyHandler = null;
  contentEl.onclick = null;
  closeLightbox();

  const [view = "dashboard", sub = ""] = location.hash.replace(/^#\/?/, "").split("/");
  const views = { dashboard: viewDashboard, select: viewSelect, bookmarks: viewBookmarks, stats: viewStats, settings: viewSettings, quiz: viewQuiz, result: viewResult };
  const target = views[view] ? view : "dashboard";
  const needsData = ["select", "quiz", "result", "bookmarks"].includes(target);
  const blocked = needsData && !QUESTIONS.length;

  appEl.classList.toggle("quiz-mode", target === "quiz" && !blocked);
  document.querySelectorAll(".nav-links li").forEach((li) => li.classList.toggle("active", li.dataset.view === target));

  if (blocked) viewNeedsPdf(target);
  else views[target](decodeURIComponent(sub));
  if (target !== "quiz") contentEl.scrollTop = 0;
}

function renderSidebar() {
  document.getElementById("data-status").innerHTML = QUESTIONS.length
    ? `📄 ${QUESTIONS.length}문항 불러옴`
    : `<a href="#/dashboard">📄 PDF를 불러오세요</a>`;
}

document.querySelector(".nav-links").onclick = (e) => {
  const li = e.target.closest("li[data-view]");
  if (li) go(li.dataset.view);
};

window.addEventListener("hashchange", render);
document.addEventListener("keydown", (e) => {
  if (!lightboxEl.hidden) return lightboxKey(e);
  if (!dialogEl.hidden) return;
  keyHandler?.(e);
});

// 문제 데이터가 필요한 화면인데 아직 PDF를 불러오지 않은 경우
function viewNeedsPdf(view) {
  const titles = { select: "기출 풀기", bookmarks: "⭐ 다시 볼 문제", quiz: "기출 풀기", result: "채점 결과" };
  contentEl.innerHTML = `
    <section class="view">
      <h1>${titles[view] || "기출 풀기"}</h1>
      <div class="banner"><div class="icon">📄</div><div class="text"><strong>먼저 문제집 PDF를 불러와 주세요.</strong>
        <span class="small muted">이 기기에는 아직 문제 데이터가 없습니다. 기기마다 한 번씩 불러오면 그다음부터는 바로 쓸 수 있습니다.</span></div></div>
      <div style="margin-top:1.25rem">${dropzoneHTML()}</div>
    </section>`;
  bindDropzone(() => render());
}

// ─── 화면: 대시보드 ─────────────────────────────────────

function summary() {
  const entries = Object.entries(store.stats).filter(([id]) => BY_ID.has(id));
  const tries = entries.reduce((a, [, s]) => a + s.tries, 0);
  const right = entries.reduce((a, [, s]) => a + s.correct, 0);
  const exams = store.history.filter((r) => r.passed !== null);
  return {
    solved: entries.length,
    tries,
    rate: pct(right, tries),
    exams: exams.length,
    best: exams.length ? Math.max(...exams.map((r) => r.correct)) : null,
  };
}

function viewDashboard() {
  const sess = store.session;
  const sm = summary();
  const noData = !QUESTIONS.length;

  contentEl.innerHTML = `
    <section class="view">
      <h1>대시보드</h1>
      ${
        noData
          ? `<div class="banner"><div class="icon">📄</div><div class="text"><strong>문제집 PDF가 아직 없습니다.</strong>
               <span class="small muted">문제집은 저작권이 있는 자료라 사이트에 들어 있지 않습니다. 구매한 PDF를 한 번만 불러오면 이 기기에 저장됩니다.</span></div></div>
             <div style="margin-top:1.25rem">${dropzoneHTML()}</div>`
          : sess && !sess.finished
            ? `<div class="banner info"><div class="icon">⏸️</div><div class="text"><strong>풀던 문제가 있습니다</strong>
                 <span class="small muted">${h(sess.title)} · ${MODES[sess.mode].label} · ${Object.keys(sess.answers).length}/${sess.ids.length} 응답</span></div>
                 <div class="btn-row"><button class="btn small danger" data-act="discard">그만두기</button><button class="btn sky" data-act="resume">이어서 풀기</button></div></div>`
            : ""
      }

      ${
        noData
          ? ""
          : `<h2>📊 나의 학습 현황</h2>
             <div class="stats-grid">
               <div class="stat-card"><div class="label">푼 문제</div><div class="value">${sm.solved}<small> / ${QUESTIONS.length}</small></div></div>
               <div class="stat-card"><div class="label">정답률</div><div class="value">${sm.rate}<small>%</small></div></div>
               <div class="stat-card"><div class="label">다시 볼 문제</div><div class="value">${new Set(store.folders.flatMap((f) => f.items)).size}<small>개</small></div></div>
               <div class="stat-card"><div class="label">모의고사 최고점</div><div class="value">${sm.best ?? "-"}<small>${sm.best != null ? "점" : ""}</small></div></div>
             </div>`
      }

      <div class="dash-grid" style="margin-top:0.5rem">
        <div>
          <h2>✨ 핵심 기능</h2>
          <div class="feature-grid">
            <div class="card feature"><div class="ico">🎯</div><h4>실전 모드</h4><p>실제 시험처럼 100문항을 120분 안에 풀고, 과목별 과락까지 판정합니다.</p></div>
            <div class="card feature"><div class="ico">⚡</div><h4>즉시 채점</h4><p>답을 고르는 순간 정답과 해설을 보여 줍니다.</p></div>
            <div class="card feature"><div class="ico">📖</div><h4>학습 모드</h4><p>정답과 해설을 미리 보며 개념을 익히는 학습 중심 모드입니다.</p></div>
            <div class="card feature"><div class="ico">⭐</div><h4>다시 볼 문제</h4><p>폴더와 하위 폴더로 문제를 정리하고, 고른 폴더만 모아 풉니다.</p></div>
          </div>
        </div>
        <div>
          <h2>📘 사이트 이용방법</h2>
          <div class="card guide-card" style="height:calc(100% - 3.25rem)">
            <p>처음 오셨나요?<br>기출 풀이 사이트의 핵심 기능과 학습 방법을 확인해 보세요!</p>
            <button class="btn sky" data-act="guide">📖 이용방법 가이드 보기</button>
          </div>
        </div>
      </div>
    </section>`;

  bindDropzone(() => render());
  contentEl.onclick = async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "resume") go("quiz");
    else if (act === "guide") openGuide();
    else if (act === "discard" && (await confirmBox("풀이를 그만둘까요?", "진행 중인 풀이는 기록되지 않습니다.", "그만두기", true))) {
      store.session = null;
      save();
      render();
    }
  };
}

function openGuide() {
  openDialog({
    title: "📘 이용방법 가이드",
    body: `
      <ol style="padding-left:1.2rem;display:grid;gap:0.6rem">
        <li><b>PDF 불러오기</b> — 대시보드에서 문제집 PDF를 한 번 불러오면 이 기기 브라우저에 저장됩니다. 다른 기기에서는 그 기기에서 다시 불러오세요.</li>
        <li><b>모드 고르기</b> — 기출 풀기 화면 오른쪽 위에서 즉시 채점, 실전 모드, 학습 모드를 고릅니다.</li>
        <li><b>문제 고르기</b> — 실전 모의고사(과목 비율대로 100문항 랜덤), 회차별, 과목별, 다시 볼 문제 폴더에서 고릅니다.</li>
        <li><b>표·그림 확인</b> — 표나 그림이 있는 문제는 <b>원본 보기</b>로 PDF 페이지를 확인하세요. 휠로 확대, 드래그로 이동합니다.</li>
        <li><b>단축키</b> — <kbd>1</kbd>~<kbd>5</kbd> 선택, <kbd>Ctrl</kbd>+<kbd>[</kbd> 이전, <kbd>Ctrl</kbd>+<kbd>]</kbd> 다음, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 다음·제출, <kbd>B</kbd> 다시 볼 문제 저장</li>
        <li><b>틀린 문제</b>는 다시 볼 문제의 '틀린 문제(자동)'에 쌓이고, 다시 맞히면 빠집니다.</li>
      </ol>`,
    actions: [{ label: "닫기", cls: "primary", value: () => true }],
  });
}

// ─── 화면: 기출 풀기 ────────────────────────────────────

function roundStat(r) {
  const qs = QUESTIONS.filter((q) => q.round === r);
  return statOf(qs);
}

function statOf(qs) {
  let solved = 0;
  let last = 0;
  for (const q of qs) {
    const s = store.stats[q.id];
    if (s) {
      solved += 1;
      if (s.last) last += 1;
    }
  }
  return { total: qs.length, solved, rate: pct(last, solved) };
}

function viewSelect(sub) {
  const rounds = [...new Set(QUESTIONS.map((q) => q.round))].sort();
  let subHTML = "";
  if (sub === "round") {
    subHTML = `
      <div class="sub-grid">
        ${rounds
          .map((r) => {
            const st = roundStat(r);
            return `<div class="card sub-card">
              <h4>📅 ${r}회차</h4>
              <div class="meta">${st.total}문항 · 푼 문제 ${st.solved} · 최근 정답률 ${st.solved ? st.rate + "%" : "-"}</div>
              <div class="bar"><div style="width:${pct(st.solved, st.total)}%"></div></div>
              <div class="btn-row"><button class="btn small primary" data-round="${r}">순서대로 풀기</button><button class="btn small" data-round="${r}" data-shuffle="1">섞어서 풀기</button></div>
            </div>`;
          })
          .join("")}
      </div>`;
  } else if (sub === "subject") {
    subHTML = `
      <div class="sub-grid">
        ${SUBJECTS.map((s, i) => {
          const qs = QUESTIONS.filter((q) => q.subject === s);
          const st = statOf(qs);
          const unsolved = qs.filter((q) => !store.stats[q.id]).length;
          return `<div class="card sub-card">
            <h4>${i + 1}과목 · ${h(s)}</h4>
            <div class="meta">${qs.length}문항 · 푼 문제 ${st.solved} · 최근 정답률 ${st.solved ? st.rate + "%" : "-"}</div>
            <div class="bar ${st.solved ? barClass(st.rate / 100) : ""}"><div style="width:${pct(st.solved, st.total)}%"></div></div>
            <div class="btn-row">
              <button class="btn small primary" data-subject="${i}" data-n="20">랜덤 20문제</button>
              <button class="btn small" data-subject="${i}">전체 ${qs.length}문제</button>
              <button class="btn small" data-subject="${i}" data-unsolved="1" ${unsolved ? "" : "disabled"}>안 푼 문제 ${unsolved}</button>
            </div>
          </div>`;
        }).join("")}
      </div>`;
  }

  contentEl.innerHTML = `
    <section class="view">
      <div class="page-head">
        <h1>기출 풀기</h1>
        <div class="mode-toggle-group">
          ${Object.entries(MODES).map(([k, m]) => `<button class="toggle-btn ${store.mode === k ? "active" : ""}" data-mode="${k}">${m.label}</button>`).join("")}
        </div>
      </div>
      <p class="mode-desc">${MODES[store.mode].desc}</p>

      <div class="mode-layout">
        <button class="big-card" data-act="mock">
          <span class="emoji">📋</span>
          <span><h3>실전 모의고사 풀기</h3><p>과목 비율대로 300제에서 100문항 랜덤 출제 · 120분 · 과목별 40%, 총점 60% 합격</p></span>
        </button>
        <div class="row-3">
          <button class="big-card ${sub === "round" ? "active" : ""}" data-sub="round"><span class="emoji">📅</span><span><h3>회차별 풀기</h3><p>원하는 회차 선택</p></span></button>
          <button class="big-card ${sub === "subject" ? "active" : ""}" data-sub="subject"><span class="emoji">📂</span><span><h3>과목별 풀기</h3><p>5개 과목 중 선택</p></span></button>
          <button class="big-card star" data-act="bookmarks"><span class="emoji">⭐</span><span><h3>다시 볼 문제</h3><p>북마크 폴더별 풀기</p></span></button>
        </div>
      </div>
      <div class="sub-list">${subHTML}</div>
    </section>`;

  contentEl.onclick = (e) => {
    const t = e.target.closest("[data-mode],[data-act],[data-sub],[data-round],[data-subject]");
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.mode) {
      store.mode = d.mode;
      save();
      render();
    } else if (d.act === "mock") {
      startSessionSafely({ title: "실전 모의고사", kind: "mock", ids: buildMockExam(), timeLimit: EXAM_SECONDS });
    } else if (d.act === "bookmarks") {
      go("bookmarks");
    } else if (d.sub) {
      go("select", sub === d.sub ? "" : d.sub);
    } else if (d.round) {
      const r = Number(d.round);
      let ids = QUESTIONS.filter((q) => q.round === r).map((q) => q.id);
      if (d.shuffle) ids = shuffle(ids);
      startSessionSafely({ title: `${r}회차${d.shuffle ? " (섞기)" : ""}`, kind: "round", ids, timeLimit: d.shuffle ? null : EXAM_SECONDS });
    } else if (d.subject) {
      const s = SUBJECTS[Number(d.subject)];
      let qs = QUESTIONS.filter((q) => q.subject === s);
      if (d.unsolved) qs = qs.filter((q) => !store.stats[q.id]);
      if (d.n) qs = shuffle(qs).slice(0, Number(d.n));
      const suffix = d.n ? ` 랜덤 ${qs.length}` : d.unsolved ? " 안 푼 문제" : "";
      startSessionSafely({ title: `${s}${suffix}`, kind: "subject", ids: qs.map((q) => q.id) });
    }
  };
}

// ─── 화면: 문제 풀이 ────────────────────────────────────

let omrOpen = false;

function renderStem(stem) {
  // "ㄱ. … ㄴ. …" 이나 "· … · …" 같은 보기 목록은 상자로 따로 보여 준다
  const re = /(?:^|\s)(?=(?:[ㄱ-ㅎ]\.|·)\s)/g;
  const cuts = [...stem.matchAll(re)].map((m) => m.index);
  if (cuts.length < 2) return `<p class="q-stem">${h(stem)}</p>`;
  const main = stem.slice(0, cuts[0]).trim();
  const items = cuts.map((c, i) => stem.slice(c, cuts[i + 1]).trim());
  return `${main ? `<p class="q-stem">${h(main)}</p>` : ""}<div class="bogi-box">${items.map((t) => `<div>${h(t)}</div>`).join("")}</div>`;
}

function viewQuiz() {
  const sess = store.session;
  if (!sess) return go("select");
  if (sess.finished && !sess.reviewing) return go("result");
  sess.ids = sess.ids.filter((id) => BY_ID.has(id));
  if (!sess.ids.length) {
    store.session = null;
    save();
    return go("select");
  }
  sess.idx = Math.min(sess.idx, sess.ids.length - 1);

  const review = Boolean(sess.reviewing);
  const id = sess.ids[sess.idx];
  const q = BY_ID.get(id);
  const picked = sess.answers[id];
  const study = sess.mode === "study";
  const revealed = review || study || (sess.mode === "immediate" && picked != null);
  const locked = review || (sess.mode === "immediate" && picked != null);
  const isLast = sess.idx === sess.ids.length - 1;
  const answeredCount = Object.keys(sess.answers).length;
  const saved = foldersOf(id).length > 0;
  const hasFigure = /표|그림|도표|사례|다음과 같/.test(q.stem);

  const choiceClass = (n) => {
    if (revealed) {
      if (n === q.answer) return "correct";
      if (n === picked) return "wrong";
      return "";
    }
    return n === picked ? "selected" : "";
  };

  let verdict = "";
  if (revealed) {
    if (study && picked == null) verdict = `<div class="verdict neutral">정답 ${MARKS[q.answer - 1]}</div>`;
    else if (picked == null) verdict = `<div class="verdict bad">미응답 · 정답 ${MARKS[q.answer - 1]}</div>`;
    else if (picked === q.answer) verdict = `<div class="verdict good">⭕ 정답입니다 · ${MARKS[q.answer - 1]}</div>`;
    else verdict = `<div class="verdict bad">❌ 오답입니다 · 내 답 ${MARKS[picked - 1]} / 정답 ${MARKS[q.answer - 1]}</div>`;
  }

  const finishLabel = sess.mode === "bulk" ? "답안 제출" : "끝내기";
  const mainAction = review
    ? isLast
      ? `<button class="btn primary main-action" data-act="to-result">결과로 돌아가기</button>`
      : `<button class="btn primary main-action" data-act="next">다음 문제 →</button>`
    : isLast
      ? `<button class="btn primary main-action" data-act="finish">${finishLabel} (Ctrl+Enter)</button>`
      : `<button class="btn primary main-action" data-act="next">다음 문제 → (Ctrl+Enter)</button>`;

  const omrClass = (qid, i) => {
    const cls = [];
    if (i === sess.idx) cls.push("current");
    const a = sess.answers[qid];
    const showOX = review || sess.mode === "immediate";
    if (a != null) cls.push(showOX ? (a === BY_ID.get(qid).answer ? "correct" : "wrong") : "answered");
    else if (review) cls.push("wrong");
    return cls.join(" ");
  };

  contentEl.innerHTML = `
    <div class="quiz-top">
      <div class="quiz-title-pill">📋 ${h(sess.title)} · ${MODES[sess.mode].label}${review ? " · 검토" : ""}</div>
      <div class="quiz-timer" id="quiz-timer">${review ? `${answeredCount}/${sess.ids.length}` : ""}</div>
      <div class="quiz-top-right">
        ${!review && sess.mode === "bulk" ? `<button class="btn small primary" data-act="finish">답안 제출</button>` : ""}
        <button class="ghost-btn" data-act="exit" title="나가기" style="font-size:1.3rem">✕</button>
      </div>
      <div class="quiz-progress"><div style="width:${((sess.idx + 1) / sess.ids.length) * 100}%"></div></div>
    </div>

    <div class="quiz-body">
      <div class="quiz-card">
        <div class="q-head">
          <span class="q-badge">Q${sess.idx + 1}</span>
          <span class="q-tag">${h(q.subject)}</span>
          <span class="muted small">${sess.idx + 1} / ${sess.ids.length}</span>
          <span class="spacer"></span>
          <button class="src-btn ${hasFigure ? "hint" : ""}" data-act="source" title="PDF 원본 페이지 보기">🔍 원본 보기</button>
          <button class="star-btn ${saved ? "on" : ""}" data-act="star" title="다시 볼 문제 (B)">⭐ 다시 볼 문제</button>
        </div>
        <div class="q-source">📄 출처: 컴공로드맵 CPPG 실전 300제 ${q.round}회차 ${q.no}번${store.stats[id] ? ` · 지금까지 ${store.stats[id].correct}/${store.stats[id].tries} 정답` : ""}</div>
        ${renderStem(q.stem)}
        <div class="choices">
          ${q.choices
            .map((c, i) => `<button class="choice ${choiceClass(i + 1)}" data-choice="${i + 1}" ${locked ? "disabled" : ""}><span class="mark">${MARKS[i]}</span><span>${h(c)}</span></button>`)
            .join("")}
        </div>
        ${
          revealed
            ? `<div class="feedback"><div class="fb-title">채점 결과 및 해설</div>${verdict}<p>${h(q.explanation) || '<span class="muted">해설이 없습니다.</span>'}</p></div>`
            : ""
        }
        <div class="quiz-actions">
          <button class="btn" data-act="prev" ${sess.idx === 0 ? "disabled" : ""}>← 이전 (Ctrl+[)</button>
          ${mainAction}
          <button class="btn" data-act="skip" ${isLast ? "disabled" : ""}>건너뛰기 (Ctrl+])</button>
        </div>
        <p class="kbd-hint"><kbd>1</kbd>~<kbd>5</kbd> 선택 · <kbd>←</kbd><kbd>→</kbd> 이동 · <kbd>B</kbd> 다시 볼 문제 · <kbd>Esc</kbd> 문항표</p>
      </div>
    </div>

    <button class="side-tab" data-act="omr" ${omrOpen ? "hidden" : ""}>문항표</button>
    <aside class="side-panel" ${omrOpen ? "" : "hidden"}>
      <div class="head"><span>문항표 · ${answeredCount}/${sess.ids.length} 응답</span><button class="ghost-btn" data-act="omr">✕</button></div>
      <div class="omr-legend">
        ${review || sess.mode === "immediate" ? `<span><i style="background:rgba(52,211,153,.5)"></i>정답</span><span><i style="background:rgba(248,113,113,.5)"></i>오답</span>` : `<span><i style="background:rgba(56,189,248,.5)"></i>응답</span>`}
        <span><i style="background:rgba(255,255,255,.08)"></i>미응답</span>
      </div>
      <div class="omr">${sess.ids.map((qid, i) => `<button class="${omrClass(qid, i)}" data-goto="${i}">${i + 1}</button>`).join("")}</div>
    </aside>`;

  // 타이머: 실전 모의고사·회차 풀이는 남은 시간, 나머지는 경과 시간
  if (!review) {
    let last = Date.now();
    let savedAt = Date.now();
    let handle = null;
    const timerEl = document.getElementById("quiz-timer");
    const tick = () => {
      const now = Date.now();
      sess.elapsed += (now - last) / 1000;
      last = now;
      if (sess.timeLimit) {
        const left = sess.timeLimit - sess.elapsed;
        timerEl.textContent = fmtTime(left);
        timerEl.classList.toggle("low", left < 600);
        if (left <= 0) {
          clearInterval(handle);
          alertBox("시험 시간이 끝났습니다", "자동으로 채점합니다.").then(finishSession);
          return;
        }
      } else {
        timerEl.textContent = fmtTime(sess.elapsed);
      }
      if (now - savedAt > 5000) {
        savedAt = now;
        save();
      }
    };
    handle = setInterval(tick, 1000);
    tick();
    cleanup.push(() => {
      clearInterval(handle);
      save();
    });
  }

  const move = (i) => {
    if (i < 0 || i >= sess.ids.length) return;
    sess.idx = i;
    save();
    render();
    contentEl.scrollTop = 0;
  };

  const choose = (n) => {
    if (locked) return;
    if (sess.mode === "immediate") {
      sess.answers[id] = n;
      recordAttempt(id, n === q.answer);
    } else if (sess.answers[id] === n) {
      delete sess.answers[id];
    } else {
      sess.answers[id] = n;
    }
    save();
    render();
  };

  const finish = async () => {
    const left = sess.ids.length - Object.keys(sess.answers).length;
    let msg = "";
    if (sess.mode === "bulk") msg = left ? `아직 ${left}문항을 풀지 않았습니다. 그대로 제출할까요?` : "답안을 제출하고 채점할까요?";
    else msg = sess.mode === "study" ? "학습을 마칠까요?" : "풀이를 끝내고 결과를 볼까요?";
    if (await confirmBox(sess.mode === "bulk" ? "답안 제출" : "끝내기", msg, sess.mode === "bulk" ? "제출" : "끝내기")) finishSession();
  };

  const exit = async () => {
    if (review) return go("result");
    const ok = await openDialog({
      title: "풀이 화면 나가기",
      body: "<p>지금까지 푼 내용은 저장되어 대시보드에서 이어서 풀 수 있습니다.</p>",
      actions: [
        { label: "계속 풀기", value: () => "stay" },
        { label: "그만두기", cls: "danger", value: () => "discard" },
        { label: "나가기", cls: "primary", value: () => "leave" },
      ],
    });
    if (ok === "discard") {
      store.session = null;
      save();
      go("select");
    } else if (ok === "leave") go("dashboard");
  };

  const star = () => openBookmarkModal(id, () => render());

  contentEl.onclick = (e) => {
    const t = e.target.closest("[data-choice],[data-act],[data-goto]");
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.choice) choose(Number(d.choice));
    else if (d.goto) move(Number(d.goto));
    else if (d.act === "prev") move(sess.idx - 1);
    else if (d.act === "next" || d.act === "skip") move(sess.idx + 1);
    else if (d.act === "finish") finish();
    else if (d.act === "to-result") go("result");
    else if (d.act === "exit") exit();
    else if (d.act === "star") star();
    else if (d.act === "source") openLightbox(q);
    else if (d.act === "omr") {
      omrOpen = !omrOpen;
      render();
    }
  };

  keyHandler = (e) => {
    if (e.target.matches("input, textarea, select")) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === "[") move(sess.idx - 1);
    else if (ctrl && e.key === "]") move(sess.idx + 1);
    else if (ctrl && e.key === "Enter") {
      if (!isLast) move(sess.idx + 1);
      else if (review) go("result");
      else finish();
    } else if (ctrl || e.altKey) return;
    else if (e.key >= "1" && e.key <= "5") choose(Number(e.key));
    else if (e.key === "ArrowLeft") move(sess.idx - 1);
    else if (e.key === "ArrowRight") move(sess.idx + 1);
    else if (e.key === "Enter" && revealed && !isLast) move(sess.idx + 1);
    else if (e.key === "b" || e.key === "B") star();
    else if (e.key === "Escape") {
      omrOpen = !omrOpen;
      render();
    } else return;
    e.preventDefault();
  };
}

// ─── 화면: 채점 결과 ────────────────────────────────────

function viewResult() {
  const sess = store.session;
  if (!sess || !sess.finished) return go("select");
  if (sess.reviewing) {
    sess.reviewing = false;
    save();
  }
  const g = gradeSession(sess);
  const wrongIds = sess.ids.filter((id) => sess.answers[id] !== BY_ID.get(id)?.answer);

  contentEl.innerHTML = `
    <section class="view">
      <div class="page-head">
        <h1>채점 결과</h1>
        <div class="btn-row">
          <button class="btn" data-act="review">📖 전체 해설 보기</button>
          <button class="btn primary" data-act="retry" ${wrongIds.length ? "" : "disabled"}>틀린 ${wrongIds.length}문제 다시 풀기</button>
        </div>
      </div>

      <div class="card score-hero">
        <div><div class="muted small">${h(sess.title)} · ${MODES[sess.mode].label}</div>
          <div class="score-big">${g.correct}<small> / ${g.total}</small></div>
          <div class="muted small">정답률 ${pct(g.correct, g.total)}% · 응답 ${g.answered}문항 · 소요 ${fmtTime(sess.elapsed)}</div>
        </div>
        ${g.passed === null ? "" : `<div class="verdict-big ${g.passed ? "pass" : "fail"}">${g.passed ? "🎉 합격" : "불합격"}</div>`}
      </div>

      <h2>과목별 결과</h2>
      <div class="card" style="padding:0.5rem 1.25rem">
        <table>
          <thead><tr><th>과목</th><th class="num">정답</th><th class="num">정답률</th><th style="width:35%"></th></tr></thead>
          <tbody>
            ${SUBJECTS.filter((s) => g.subjects[s].t)
              .map((s) => {
                const { c, t } = g.subjects[s];
                const low = c / t < SUBJECT_PASS;
                return `<tr><td>${h(s)}</td><td class="num">${c} / ${t}</td>
                  <td class="num ${low ? "fail" : ""}">${pct(c, t)}%${low && g.passed !== null ? " 과락" : ""}</td>
                  <td><div class="bar ${barClass(c / t)}"><div style="width:${pct(c, t)}%"></div></div></td></tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>

      <h2>문항별 결과</h2>
      <div class="card" style="padding:0.5rem 1.25rem;overflow-x:auto">
        <table>
          <thead><tr><th>#</th><th>문항</th><th>과목</th><th class="num">내 답</th><th class="num">정답</th><th class="num">채점</th><th></th></tr></thead>
          <tbody>
            ${sess.ids
              .map((id, i) => {
                const q = BY_ID.get(id);
                const a = sess.answers[id];
                const ok = a === q.answer;
                return `<tr class="clickable" data-review="${i}">
                  <td class="muted">${i + 1}</td><td>${label(q)}</td><td class="small muted">${h(q.subject)}</td>
                  <td class="num">${a ? MARKS[a - 1] : "-"}</td><td class="num">${MARKS[q.answer - 1]}</td>
                  <td class="num ${ok ? "ox-o" : "ox-x"}">${ok ? "O" : "X"}</td>
                  <td class="num"><button class="ghost-btn" data-star="${id}" title="다시 볼 문제">${foldersOf(id).length ? "⭐" : "☆"}</button></td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>`;

  contentEl.onclick = (e) => {
    const starId = e.target.closest("[data-star]")?.dataset.star;
    if (starId) return openBookmarkModal(starId, () => render());
    const t = e.target.closest("[data-act],[data-review]");
    if (!t || t.disabled) return;
    if (t.dataset.review != null || t.dataset.act === "review") {
      sess.reviewing = true;
      sess.idx = Number(t.dataset.review || 0);
      save();
      go("quiz");
    } else if (t.dataset.act === "retry") {
      startSession({ title: `${sess.title} 오답`, kind: "retry", ids: wrongIds });
    }
  };
}

// ─── 화면: 다시 볼 문제 ─────────────────────────────────

const expanded = new Set();
const selectedFolders = new Set();

function viewBookmarks() {
  const wrongIds = store.wrong.filter((id) => BY_ID.has(id));

  const qRows = (ids, folderId) =>
    [...ids]
      .map((id) => BY_ID.get(id))
      .filter(Boolean)
      .sort((a, b) => a.round - b.round || a.no - b.no)
      .map(
        (q) => `<div class="q-row">
          <span class="q-tag">${label(q)}</span>
          <span class="text" data-view-q="${q.id}" title="${h(q.stem)}">${h(q.stem)}</span>
          ${folderId ? `<button class="ghost-btn small" data-move="${q.id}" data-from="${folderId}" title="다른 폴더로 이동">↪</button>` : ""}
          <button class="ghost-btn small" data-remove="${q.id}" data-from="${folderId || "wrong"}" title="빼기">✕</button>
        </div>`
      )
      .join("") || `<div class="muted small" style="padding:0.4rem">비어 있습니다.</div>`;

  const tree = (parentId = null, depth = 0) =>
    childFolders(parentId)
      .map((f) => {
        const count = folderItemsDeep(f.id).size;
        const open = expanded.has(f.id);
        const hasChildren = childFolders(f.id).length > 0;
        return `
          <div class="folder-row" style="padding-left:${0.9 + depth * 1.4}rem">
            <input type="checkbox" data-select="${f.id}" ${selectedFolders.has(f.id) ? "checked" : ""} aria-label="${h(f.name)} 선택">
            <button class="twisty" data-toggle="${f.id}">${open ? "▼" : "▶"}</button>
            <span class="name" data-toggle="${f.id}">📁 ${h(f.name)}</span>
            <span class="count">${count}문항${hasChildren ? " (하위 포함)" : ""}</span>
            <span class="actions">
              <button class="btn small" data-solve="${f.id}" ${count ? "" : "disabled"}>풀기</button>
              <button class="ghost-btn" data-add-sub="${f.id}" title="하위 폴더 추가">＋</button>
              <button class="ghost-btn" data-rename="${f.id}" title="이름 변경">✎</button>
              <button class="ghost-btn" data-del="${f.id}" title="삭제">🗑</button>
            </span>
          </div>
          ${open ? `<div class="folder-items" style="margin-left:${2.2 + depth * 1.4}rem">${qRows(f.items, f.id)}</div>${tree(f.id, depth + 1)}` : ""}`;
      })
      .join("");

  contentEl.innerHTML = `
    <section class="view">
      <div class="page-head">
        <h1>⭐ 다시 볼 문제</h1>
        <div class="btn-row">
          <button class="btn" data-act="new">📁 새 폴더</button>
          <button class="btn" data-act="solve-selected" ${selectedFolders.size ? "" : "disabled"}>선택 폴더 풀기</button>
          <button class="btn gold" data-act="shuffle-selected" ${selectedFolders.size ? "" : "disabled"}>선택 폴더 섞어서 풀기</button>
        </div>
      </div>
      <p class="muted small" style="margin:-1rem 0 1.25rem">풀이 화면의 ⭐ 버튼이나 <kbd>B</kbd> 키로 문제를 폴더에 저장합니다. 문제는 여러 폴더에 동시에 넣을 수 있습니다.</p>

      <div class="card" style="padding:0.6rem">
        <div class="folder-row">
          <span style="width:16px"></span>
          <button class="twisty" data-toggle="__wrong">${expanded.has("__wrong") ? "▼" : "▶"}</button>
          <span class="name" data-toggle="__wrong">🔁 틀린 문제 <span class="muted small">(자동)</span></span>
          <span class="count">${wrongIds.length}문항</span>
          <span class="actions"><button class="btn small" data-solve="__wrong" ${wrongIds.length ? "" : "disabled"}>풀기</button></span>
        </div>
        ${expanded.has("__wrong") ? `<div class="folder-items">${qRows(wrongIds, null)}</div>` : ""}
        ${store.folders.length ? tree() : `<div class="empty-state" style="padding:2rem 1rem"><p>아직 만든 폴더가 없습니다. 새 폴더를 만들거나 풀이 화면에서 ⭐를 눌러 보세요.</p></div>`}
      </div>
    </section>`;

  const solve = (ids, title, mix = true) => startSessionSafely({ title, kind: "folder", ids: mix ? shuffle(ids) : ids });

  contentEl.onclick = async (e) => {
    const t = e.target.closest("button, [data-toggle], [data-view-q], input[data-select]");
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.select) {
      t.checked ? selectedFolders.add(d.select) : selectedFolders.delete(d.select);
      return render();
    }
    if (d.toggle) {
      expanded.has(d.toggle) ? expanded.delete(d.toggle) : expanded.add(d.toggle);
      return render();
    }
    if (d.viewQ) return showQuestion(BY_ID.get(d.viewQ));
    if (d.solve) {
      if (d.solve === "__wrong") return solve(wrongIds, "틀린 문제 다시 풀기");
      return solve([...folderItemsDeep(d.solve)], folderPath(d.solve));
    }
    if (d.act === "new" || d.addSub) {
      const name = await promptBox(d.addSub ? `'${folderById(d.addSub).name}' 안에 하위 폴더 만들기` : "새 폴더 만들기", { placeholder: "폴더 이름" });
      if (name) {
        createFolder(name, d.addSub || null);
        if (d.addSub) expanded.add(d.addSub);
        render();
      }
    } else if (d.rename) {
      const f = folderById(d.rename);
      const name = await promptBox("폴더 이름 변경", { value: f.name });
      if (name) {
        f.name = name;
        save();
        render();
      }
    } else if (d.del) {
      const f = folderById(d.del);
      if (await confirmBox("폴더 삭제", `'${h(f.name)}' 폴더와 하위 폴더를 삭제합니다. 문제 자체는 지워지지 않습니다.`, "삭제", true)) {
        deleteFolder(d.del);
        selectedFolders.delete(d.del);
        save();
        render();
      }
    } else if (d.remove) {
      if (d.from === "wrong") store.wrong = store.wrong.filter((x) => x !== d.remove);
      else {
        const f = folderById(d.from);
        f.items = f.items.filter((x) => x !== d.remove);
      }
      save();
      render();
    } else if (d.move) {
      const from = folderById(d.from);
      const target = await openDialog({
        title: "다른 폴더로 이동",
        body: `<label class="field">옮길 폴더<select id="move-target">${folderOptions()}</select></label>`,
        actions: [
          { label: "취소", value: () => null },
          { label: "이동", cls: "primary", value: () => document.getElementById("move-target").value },
        ],
        onOpen: (dlg) => (dlg.querySelector("#move-target").value = d.from),
      });
      const to = folderById(target);
      if (to && to !== from) {
        from.items = from.items.filter((x) => x !== d.move);
        if (!to.items.includes(d.move)) to.items.push(d.move);
        expanded.add(to.id);
        save();
        render();
      }
    } else if (d.act === "solve-selected" || d.act === "shuffle-selected") {
      const ids = new Set();
      selectedFolders.forEach((fid) => folderById(fid) && folderItemsDeep(fid, ids));
      const names = [...selectedFolders].map((fid) => folderById(fid)?.name).filter(Boolean);
      solve([...ids], names.length > 1 ? `${names[0]} 외 ${names.length - 1}개 폴더` : names[0], d.act === "shuffle-selected");
    }
  };
}

// 진행 중인 풀이를 건드리지 않고 문제 하나를 정답·해설과 함께 보여 준다
function showQuestion(q) {
  openDialog({
    title: `${label(q)} · ${q.subject}`,
    body: `
      ${renderStem(q.stem)}
      <div class="choices">
        ${q.choices.map((c, i) => `<div class="choice ${i + 1 === q.answer ? "correct" : ""}"><span class="mark">${MARKS[i]}</span><span>${h(c)}</span></div>`).join("")}
      </div>
      <div class="feedback"><div class="fb-title">해설</div><div class="verdict neutral">정답 ${MARKS[q.answer - 1]}</div><p>${h(q.explanation)}</p></div>`,
    actions: [
      { label: "🔍 원본 보기", value: () => "source" },
      { label: "⭐ 폴더 관리", value: () => "star" },
      { label: "닫기", cls: "primary", value: () => null },
    ],
    onOpen: (dlg) => dlg.querySelector(".modal-card").classList.add("wide"),
  }).then((act) => {
    dialogEl.querySelector(".modal-card").classList.remove("wide");
    if (act === "source") openLightbox(q);
    else if (act === "star") openBookmarkModal(q.id, () => render());
  });
}

// ─── 화면: 학습 통계 ────────────────────────────────────

function viewStats() {
  const sm = summary();
  if (!sm.tries && !store.history.length) {
    contentEl.innerHTML = `
      <section class="view"><h1>학습 통계</h1>
        <div class="empty-state"><div class="big">📊</div><h3>아직 학습 기록이 없습니다</h3><p>기출 풀기에서 문제를 풀어보세요!</p></div>
      </section>`;
    return;
  }

  const bySubject = SUBJECTS.map((s) => {
    let tries = 0;
    let right = 0;
    let solved = 0;
    for (const q of QUESTIONS.filter((x) => x.subject === s)) {
      const st = store.stats[q.id];
      if (!st) continue;
      solved += 1;
      tries += st.tries;
      right += st.correct;
    }
    return { s, tries, right, solved, total: QUESTIONS.filter((x) => x.subject === s).length };
  });
  const rounds = [...new Set(QUESTIONS.map((q) => q.round))].sort();

  contentEl.innerHTML = `
    <section class="view">
      <div class="page-head">
        <h1>학습 통계</h1>
        <button class="btn small danger" data-act="reset">🗑 학습 기록 초기화</button>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="label">푼 문제</div><div class="value">${sm.solved}<small> / ${QUESTIONS.length || 300}</small></div></div>
        <div class="stat-card"><div class="label">누적 정답률</div><div class="value">${sm.rate}<small>%</small></div></div>
        <div class="stat-card"><div class="label">총 풀이 횟수</div><div class="value">${sm.tries}<small>회</small></div></div>
        <div class="stat-card"><div class="label">모의고사 응시 / 최고점</div><div class="value">${sm.exams}<small>회 · ${sm.best ?? "-"}점</small></div></div>
      </div>

      <h2>과목별 정답률</h2>
      <div class="card" style="padding:0.5rem 1.25rem">
        <table>
          <thead><tr><th>과목</th><th class="num">푼 문제</th><th class="num">누적 정답률</th><th style="width:35%"></th></tr></thead>
          <tbody>
            ${bySubject
              .map(
                (r) => `<tr><td>${h(r.s)}</td><td class="num">${r.solved} / ${r.total}</td><td class="num">${r.tries ? pct(r.right, r.tries) + "%" : "-"}</td>
                  <td><div class="bar ${r.tries ? barClass(r.right / r.tries) : ""}"><div style="width:${pct(r.right, r.tries)}%"></div></div></td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <h2>회차별 진행</h2>
      <div class="card" style="padding:0.5rem 1.25rem">
        <table>
          <thead><tr><th>회차</th><th class="num">푼 문제</th><th class="num">최근 정답률</th><th style="width:35%"></th></tr></thead>
          <tbody>
            ${rounds
              .map((r) => {
                const st = roundStat(r);
                return `<tr><td>${r}회차</td><td class="num">${st.solved} / ${st.total}</td><td class="num">${st.solved ? st.rate + "%" : "-"}</td>
                  <td><div class="bar"><div style="width:${pct(st.solved, st.total)}%"></div></div></td></tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>

      <h2>최근 풀이 기록</h2>
      <div class="card" style="padding:0.5rem 1.25rem;overflow-x:auto">
        ${
          store.history.length
            ? `<table>
                <thead><tr><th>날짜</th><th>구분</th><th>모드</th><th class="num">점수</th><th class="num">정답률</th><th class="num">소요</th><th></th></tr></thead>
                <tbody>
                  ${store.history
                    .slice(0, 50)
                    .map(
                      (r) => `<tr><td class="small muted">${fmtDate(r.at)}</td><td>${h(r.title)}</td><td class="small">${MODES[r.mode]?.label || ""}</td>
                        <td class="num">${r.correct} / ${r.total}</td><td class="num">${pct(r.correct, r.total)}%</td><td class="num small">${fmtTime(r.seconds)}</td>
                        <td>${r.passed == null ? "" : `<span class="${r.passed ? "pass" : "fail"}">${r.passed ? "합격" : "불합격"}</span>`}</td></tr>`
                    )
                    .join("")}
                </tbody>
              </table>`
            : `<p class="muted small" style="padding:1rem 0">아직 끝낸 풀이가 없습니다.</p>`
        }
      </div>
    </section>`;

  contentEl.onclick = async (e) => {
    if (e.target.closest("[data-act=reset]") && (await confirmBox("학습 기록 초기화", "풀이 기록, 정답률, 틀린 문제 목록을 지웁니다. 다시 볼 문제 폴더는 유지됩니다.", "초기화", true))) {
      Object.assign(store, { stats: {}, wrong: [], history: [], session: null });
      save();
      render();
    }
  };
}

// ─── 화면: 설정 ─────────────────────────────────────────

function viewSettings() {
  contentEl.innerHTML = `
    <section class="view">
      <h1>⚙️ 설정</h1>

      <h2>📄 문제 데이터</h2>
      <div class="card">
        ${
          QUESTIONS.length
            ? `<p><b>${h(META?.fileName || "문제집")}</b> · ${QUESTIONS.length}문항 · ${META?.loadedAt ? fmtDate(META.loadedAt) + " 불러옴" : ""}</p>
               ${META?.problems?.length ? `<p class="small" style="color:var(--gold);margin-top:0.4rem">확인이 필요한 문항 ${META.problems.length}개: ${h(META.problems.join(", "))}</p>` : ""}
               <p class="muted small" style="margin-top:0.4rem">문제 데이터와 PDF는 이 브라우저(IndexedDB)에만 저장되어 있습니다.</p>
               <div class="btn-row" style="margin-top:1rem">
                 <button class="btn" data-act="reload">다른 PDF로 다시 불러오기</button>
                 <button class="btn danger" data-act="clear-data">문제 데이터 삭제</button>
               </div>
               <div id="reload-zone" style="margin-top:1rem" hidden>${dropzoneHTML()}</div>`
            : dropzoneHTML()
        }
      </div>

      <h2>💾 학습 기록</h2>
      <div class="card">
        <p class="muted small">풀이 기록과 다시 볼 문제 폴더는 이 브라우저에만 저장됩니다. 다른 기기로 옮길 때는 내보낸 파일을 가져오세요. (문제 내용은 들어 있지 않습니다)</p>
        <div class="btn-row" style="margin-top:1rem">
          <button class="btn" data-act="export">기록 내보내기</button>
          <label class="btn">기록 가져오기<input type="file" id="import-json" accept="application/json" hidden></label>
          <button class="btn danger" data-act="reset-all">기록·폴더 모두 삭제</button>
        </div>
      </div>
    </section>`;

  bindDropzone(() => render());

  document.getElementById("import-json").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data.stats !== "object" || !Array.isArray(data.folders)) throw new Error();
      if (!(await confirmBox("기록 가져오기", "지금 기록을 파일 내용으로 바꿉니다.", "가져오기"))) return;
      Object.assign(store, { stats: data.stats, wrong: data.wrong || [], folders: data.folders, history: data.history || [], session: null });
      save();
      toast("기록을 가져왔습니다.");
      render();
    } catch {
      alertBox("올바른 기록 파일이 아닙니다");
    }
  };

  contentEl.onclick = async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "reload") {
      document.getElementById("reload-zone").hidden = false;
    } else if (act === "clear-data") {
      if (await confirmBox("문제 데이터 삭제", "이 브라우저에 저장된 PDF와 문제 데이터를 지웁니다. 풀이 기록은 남습니다.", "삭제", true)) {
        await clearData();
        renderSidebar();
        render();
      }
    } else if (act === "export") {
      const { stats, wrong, folders, history } = store;
      const blob = new Blob([JSON.stringify({ app: "cppg-master", exportedAt: Date.now(), stats, wrong, folders, history }, null, 1)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `cppg-기록-${new Date().toISOString().slice(0, 10)}.json` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } else if (act === "reset-all") {
      if (await confirmBox("기록·폴더 모두 삭제", "풀이 기록, 틀린 문제, 다시 볼 문제 폴더를 모두 지웁니다.", "모두 삭제", true)) {
        Object.assign(store, { stats: {}, wrong: [], folders: [], history: [], session: null });
        save();
        render();
      }
    }
  };
}

// ─── 원본 페이지 라이트박스 ─────────────────────────────

const lightboxEl = document.getElementById("lightbox");
const lb = { page: 1, scale: 1.4, q: null, renderTask: null };

async function openLightbox(q) {
  lb.q = q;
  lb.page = q.pages[0] || 1;
  lightboxEl.hidden = false;
  await drawLightbox();
  document.getElementById("lightbox-stage").scrollTo(0, 0);
}

function closeLightbox() {
  lightboxEl.hidden = true;
}

async function drawLightbox() {
  const title = document.getElementById("lightbox-title");
  title.textContent = `${label(lb.q)} 원본 · ${lb.page}쪽 · ${Math.round(lb.scale * 100)}%`;
  try {
    const pdf = await getPdfDoc();
    lb.page = Math.min(Math.max(1, lb.page), pdf.numPages);
    const page = await pdf.getPage(lb.page);
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: lb.scale * ratio });
    const canvas = document.getElementById("lightbox-canvas");
    lb.renderTask?.cancel();
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / ratio}px`;
    canvas.style.height = `${viewport.height / ratio}px`;
    lb.renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport });
    await lb.renderTask.promise;
  } catch (e) {
    if (e?.name === "RenderingCancelledException") return;
    title.textContent = `원본을 열 수 없습니다: ${e.message || e}`;
  }
}

function zoomLightbox(factor) {
  lb.scale = Math.min(4, Math.max(0.6, lb.scale * factor));
  drawLightbox();
}

function lightboxKey(e) {
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowLeft") (lb.page -= 1), drawLightbox();
  else if (e.key === "ArrowRight") (lb.page += 1), drawLightbox();
  else if (e.key === "+" || e.key === "=") zoomLightbox(1.2);
  else if (e.key === "-") zoomLightbox(1 / 1.2);
  else return;
  e.preventDefault();
}

lightboxEl.querySelector(".lightbox-tools").onclick = (e) => {
  const act = e.target.closest("[data-lb]")?.dataset.lb;
  if (act === "close") closeLightbox();
  else if (act === "prev") (lb.page -= 1), drawLightbox();
  else if (act === "next") (lb.page += 1), drawLightbox();
  else if (act === "zoom-in") zoomLightbox(1.2);
  else if (act === "zoom-out") zoomLightbox(1 / 1.2);
};

(function bindLightboxStage() {
  const stage = document.getElementById("lightbox-stage");
  let wheelTimer = null;
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      lb.scale = Math.min(4, Math.max(0.6, lb.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(drawLightbox, 60);
    },
    { passive: false }
  );
  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.classList.add("dragging");
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    stage.scrollLeft = drag.left - (e.clientX - drag.x);
    stage.scrollTop = drag.top - (e.clientY - drag.y);
  });
  const end = () => {
    drag = null;
    stage.classList.remove("dragging");
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
})();

// ─── 시작 ───────────────────────────────────────────────

(async function init() {
  await loadData();
  renderSidebar();
  render();
})();
