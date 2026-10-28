"use strict";

// CPPG 실전 300제 PDF → 문제 데이터. 브라우저에서 PDF.js로 텍스트를 뽑아 파싱한다 (파일은 업로드되지 않는다).
(function () {
  const CIRCLED = "①②③④⑤";
  const SUBJECTS = [
    [1, 10, "개인정보보호의 이해"],
    [11, 30, "개인정보보호 제도"],
    [31, 55, "개인정보 라이프 사이클 관리"],
    [56, 85, "개인정보의 보호조치"],
    [86, 100, "개인정보 관리체계"],
  ];
  const NOISE = [
    /^\d{1,3}$/, // 페이지 번호
    /rights reserved\.?$/,
    /^\S+@\S+\.\S+$/, // 구매자 워터마크
    /실전 300제$/,
    /^0[1-3] 회차\s+정답과 해설$/,
    /^(수고하셨습니다|정답|과|해설)$/,
  ];
  const ANSWER_PAIR = /(\d{2,3})\s*([①②③④⑤])/g;
  const ANSWER_LINE = /^(\d{2,3}\s*[①②③④⑤]\s*)+$/;

  // 보기 기호 ᄀ·ᄂ(첫소리 자모)를 일반 한글 자모 ㄱ·ㄴ으로 바꾼다.
  const CHOSEONG = "ᄀᄁᄂᄃᄄᄅᄆᄇᄈᄉᄊᄋᄌᄍᄎᄏᄐᄑᄒ";
  const COMPAT = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  const normalizeJamo = (s) => s.replace(/[ᄀ-ᄒ](?![ᅡ-ᅵ])/g, (c) => COMPAT[CHOSEONG.indexOf(c)]);

  const subjectOf = (n) => SUBJECTS.find(([lo, hi]) => n >= lo && n <= hi)[2];

  // PDF 줄바꿈으로 끊긴 문장을 잇는다. 원문 줄 끝에 공백이 없으면 단어 중간에서 끊긴 것으로 보고 붙인다.
  function join(lines) {
    let text = "";
    let prevSpaced = true;
    for (const line of lines) {
      if (!text) text = line.text;
      else if (prevSpaced || !(/[가-힣]$/.test(text) && /^[가-힣]/.test(line.text))) text += " " + line.text;
      else text += line.text;
      prevSpaced = line.spaced ?? true;
    }
    return text.replace(/\s+/g, " ").trim();
  }

  // 2차원 변환 행렬 [a, b, c, d, e, f]: mul(m, n)은 n을 먼저 적용하고 m을 적용한다 (PDF 규약)
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  // 그리기 명령(operator list)에서 글자와 줄 이동을 읽어 줄 단위 텍스트를 만든다.
  // getTextContent()는 줄 끝 공백을 지워서 줄바꿈 자리가 띄어쓰기였는지 알 수 없기 때문이다.
  // 줄마다 위치(x, y: 페이지 왼쪽 위 기준)와 글꼴을 같이 기록하고, 본문에 들어간 그림의 위치도 모은다.
  function pageLines(opList, OPS, page, view) {
    const top = view[3];
    const raw = [{ text: "" }];
    const images = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let tlm = [1, 0, 0, 1, 0, 0];
    let leading = 0;
    let font = null;
    let fontSize = 1;
    let y = null;
    const cur = () => raw[raw.length - 1];
    const newline = () => cur().text !== "" && raw.push({ text: "" });
    const move = (tx, ty) => (tlm = mul(tlm, [1, 0, 0, 1, tx, ty]));
    const append = (s) => {
      const line = cur();
      if (line.text === "") {
        const m = mul(ctm, tlm);
        const [px, py] = apply(m, 0, 0);
        line.x = px;
        line.y = top - py;
        line.font = font;
        line.size = Math.round(fontSize * Math.hypot(m[2], m[3]) * 10) / 10;
      }
      line.text += s;
    };
    opList.fnArray.forEach((fn, i) => {
      const args = opList.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        if (args[0]) ctm = mul(ctm, args[0]);
      } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
        const pts = [apply(ctm, 0, 0), apply(ctm, 1, 1)];
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => top - p[1]);
        images.push({ page, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
      } else if (fn === OPS.setFont) {
        font = args[0];
        fontSize = args[1];
      } else if (fn === OPS.setLeading) leading = args[0];
      else if (fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
        if (fn !== OPS.showText && fn !== OPS.showSpacedText) {
          move(0, -leading);
          newline();
        }
        const glyphs = args[args.length - 1];
        for (const g of glyphs) {
          if (typeof g === "number") {
            if (g < -250) append(" "); // 큰 자간 이동은 띄어쓰기로 본다
          } else if (g) {
            // 유니코드 매핑이 없는 글리프(가운뎃점 등)는 앞뒤 단어가 붙지 않도록 공백으로 둔다
            append(g.unicode || " ");
          }
        }
      } else if (fn === OPS.moveText || fn === OPS.setLeadingMoveText) {
        if (fn === OPS.setLeadingMoveText) leading = -args[1];
        move(args[0], args[1]);
        if (Math.abs(args[1]) > 0.01) newline();
      } else if (fn === OPS.nextLine) {
        move(0, -leading);
        newline();
      } else if (fn === OPS.beginText) {
        tlm = [1, 0, 0, 1, 0, 0];
        newline();
      } else if (fn === OPS.setTextMatrix) {
        tlm = args.slice();
        if (y === null || Math.abs(args[5] - y) > 0.5) newline();
        y = args[5];
      }
    });
    const lines = [];
    for (const { text, x, y, font, size } of raw) {
      const s = normalizeJamo(text.normalize("NFC")).trim();
      if (s && !NOISE.some((re) => re.test(s))) lines.push({ text: s, page, spaced: /\s$/.test(text), x, y, font, size });
    }
    return { lines, images };
  }

  // 줄 맨 앞의 문항 번호(01, 02, …)를 순서대로 찾아 블록으로 나눈다.
  // 그림({ fig })은 들어 있는 블록에 그대로 넣고, 기출 배지({ badge })는 바로 다음 문항에 표시한다.
  function splitNumbered(lines, count) {
    const blocks = {};
    const badges = new Set();
    let badge = false;
    let cur = null;
    let expected = 1;
    for (let line of lines) {
      if (line.badge) {
        badge = true;
        continue;
      }
      if (line.fig) {
        if (cur !== null) blocks[cur].push(line);
        continue;
      }
      // 이전 선지 끝에 다음 문항 번호가 붙어 나오는 경우 (예: "…유형46  다음 중 …")
      if (cur !== null && expected <= count) {
        const re = new RegExp(`(?<=[^\\d\\s제])\\s*0?${expected}\\s{2,}(?=\\S)`);
        const m = re.exec(line.text);
        if (m) {
          blocks[cur].push({ ...line, text: line.text.slice(0, m.index), spaced: true });
          line = { ...line, text: line.text.slice(m.index).trim() };
        }
      }
      const m = /^(\d{2,3})(?:\s+|$)([\s\S]*)$/.exec(line.text);
      if (m && Number(m[1]) === expected && expected <= count) {
        cur = expected++;
        blocks[cur] = m[2] ? [{ ...line, text: m[2] }] : [];
        if (badge) badges.add(cur);
        badge = false;
      } else if (cur !== null) {
        blocks[cur].push(line);
      }
    }
    return { blocks, badges };
  }

  // 지문 상자 안에서 새 항목이 시작되는 줄 (ㄱ. · 1. (가) 제3조 등)
  const ITEM_START = /^(?:[ㄱ-ㅎ][.)]|[가-하][.)]\s|\([가-하ㄱ-ㅎA-Za-z0-9]{1,2}\)|\d{1,2}[.)]\s|[·•●○■□▪◦∙※\-–]|제\d+조|[A-Z][.)]\s|[<〈【[]|_{2,})/;

  // 지문 상자 줄을 항목 단위로 묶는다. 항목 기호가 있으면 기호마다, 없으면 문단 간격이나 내어쓰기에서 나눈다.
  function boxItems(lines) {
    const marked = lines.some((l) => ITEM_START.test(l.text));
    const items = [];
    let prev = null;
    for (const line of lines) {
      const gap = prev && line.page === prev.page ? line.y - prev.y : 0;
      const start =
        !prev ||
        (marked ? ITEM_START.test(line.text) : line.x < prev.x - 2 || gap > (line.size || 9) * 2.3);
      if (start) items.push([line]);
      else items[items.length - 1].push(line);
      prev = line;
    }
    return items.map(join);
  }

  // 문제 블록 → 발문·지문 상자·그림을 순서대로 담은 parts와 선지.
  // 발문은 10pt 이상이거나 왼쪽(x≈54)에 붙어 있고, 지문 상자(회색 상자·보기 목록)는 들여 쓴 9pt 글자로 되어 있다.
  function parseQuestion(lines) {
    const parts = [];
    const choices = [];
    const add = (kind, item) => {
      const last = parts[parts.length - 1];
      if (last && last.kind === kind && kind !== "fig") last.lines.push(item);
      else parts.push(kind === "fig" ? { kind, ...item } : { kind, lines: [item] });
    };
    for (const line of lines) {
      if (line.fig) {
        const { page, x0, y0, x1, y1 } = line;
        add("fig", { page, rect: [x0, y0, x1, y1].map((v) => Math.round(v * 10) / 10) });
        continue;
      }
      const pieces = line.text.split(/(?=[①②③④⑤])/);
      pieces.forEach((part, i) => {
        const text = part.trim();
        if (!text) return;
        // 줄 중간에서 잘린 조각 뒤에는 다음 선지가 오므로 띄어쓰기로 취급한다
        const piece = { ...line, text, spaced: i === pieces.length - 1 ? line.spaced : true };
        if (CIRCLED.includes(text[0])) choices.push([{ ...piece, text: text.slice(1).trim() }]);
        else if (choices.length) choices[choices.length - 1].push(piece);
        else add(line.size < 9.5 && line.x >= 56.5 ? "box" : "text", piece);
      });
    }
    const body = parts.map((p) =>
      p.kind === "fig" ? { kind: "fig", page: p.page, rect: p.rect } : p.kind === "box" ? { kind: "box", items: boxItems(p.lines) } : { kind: "text", text: join(p.lines) }
    );
    const stem = body
      .map((p) => (p.kind === "box" ? p.items.join(" ") : p.text || ""))
      .filter(Boolean)
      .join(" ");
    return { stem, body, choices: choices.map(join) };
  }

  // 페이지 배경·기출 배지가 아닌 이미지를 그림으로 보고, 위치(y)에 맞춰 줄 사이에 끼워 넣는다.
  function withFigures(lines, images, view) {
    const width = view[2] - view[0];
    const height = view[3] - view[1];
    const out = lines.slice();
    for (const im of images) {
      const w = im.x1 - im.x0;
      const hgt = im.y1 - im.y0;
      if ((w > width * 0.8 && hgt > height * 0.8) || im.x1 <= 1 || im.x0 >= width - 1 || w < 15 || hgt < 10) continue; // 배경·장식
      const item = w < 75 && hgt < 45 && im.x0 < 150 ? { badge: true, page: im.page, y: im.y0 } : { fig: true, ...im, y: im.y0 };
      const at = out.findIndex((l) => l.y > im.y0);
      out.splice(at < 0 ? out.length : at, 0, item);
    }
    return out;
  }

  async function parse(pdf, onProgress = () => {}) {
    const OPS = window.pdfjsLib.OPS;
    const pages = [];
    const figPages = []; // 문제 페이지용: 줄 사이에 그림·배지를 끼운 것
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const opList = await page.getOperatorList();
      const { lines, images } = pageLines(opList, OPS, n, page.view);
      pages.push(lines);
      figPages.push(withFigures(lines, images, page.view));
      page.cleanup();
      onProgress(n / pdf.numPages);
    }

    // 회차 표지("합격결정기준" 안내)와 정답표 페이지로 구간을 나눈다.
    const roundStarts = [];
    const answerStarts = [];
    pages.forEach((p, i) => {
      if (p.some((l) => l.text.startsWith("합격결정기준"))) roundStarts.push(i + 1);
      const head = p.slice(0, 25).map((l) => l.text).join(" ");
      if ((head.match(ANSWER_PAIR) || []).length >= 50) answerStarts.push(i);
    });
    if (roundStarts.length !== 3 || answerStarts.length !== 3) {
      throw new Error("CPPG 실전 300제 문제집 형식이 아닙니다. (회차 또는 정답표를 찾지 못했습니다)");
    }
    const omr = pages.findIndex((p, i) => i > answerStarts[2] && !p.some((l) => /^\d{2}\s/.test(l.text)));
    const qRanges = [
      [roundStarts[0], roundStarts[1] - 1],
      [roundStarts[1], roundStarts[2] - 1],
      [roundStarts[2], answerStarts[0]],
    ];
    const aRanges = [
      [answerStarts[0], answerStarts[1]],
      [answerStarts[1], answerStarts[2]],
      [answerStarts[2], omr < 0 ? pages.length : omr],
    ];

    const questions = [];
    const problems = [];
    for (let r = 1; r <= 3; r++) {
      const qLines = figPages.slice(...qRanges[r - 1]).flat();
      const aLines = pages.slice(...aRanges[r - 1]).flat();

      const keyLines = new Set(aLines.slice(0, 60).filter((l) => ANSWER_LINE.test(l.text)));
      const answers = {};
      for (const l of keyLines) {
        for (const [, n, c] of l.text.matchAll(ANSWER_PAIR)) answers[Number(n)] = CIRCLED.indexOf(c) + 1;
      }
      const { blocks: qBlocks, badges } = splitNumbered(qLines, 100);
      const { blocks: eBlocks } = splitNumbered(aLines.filter((l) => !keyLines.has(l)), 100);

      for (let n = 1; n <= 100; n++) {
        const block = qBlocks[n] || [];
        const { stem, body, choices } = parseQuestion(block);
        const q = {
          id: `${r}-${n}`,
          round: r,
          no: n,
          subject: subjectOf(n),
          stem,
          body,
          choices,
          answer: answers[n] || null,
          explanation: join(eBlocks[n] || []),
          pages: [...new Set(block.map((l) => l.page))].sort((a, b) => a - b),
        };
        if (badges.has(n)) q.badge = true;
        if (choices.length !== 5 || !q.answer || !stem) problems.push(`${q.id}: 선지 ${choices.length}개, 정답 ${q.answer ?? "없음"}`);
        if (!q.explanation) problems.push(`${q.id}: 해설 없음`);
        questions.push(q);
      }
    }
    return { questions, problems };
  }

  // 파싱 결과 형식이 바뀌면 올린다. 저장된 문제 데이터의 버전이 다르면 저장된 PDF로 다시 분석한다.
  const VERSION = 2;

  window.CPPGParser = { parse, VERSION, SUBJECTS: SUBJECTS.map((s) => s[2]) };
})();
