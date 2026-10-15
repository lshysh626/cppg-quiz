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

  // 그리기 명령(operator list)에서 글자와 줄 이동을 읽어 줄 단위 텍스트를 만든다.
  // getTextContent()는 줄 끝 공백을 지워서 줄바꿈 자리가 띄어쓰기였는지 알 수 없기 때문이다.
  function pageLines(opList, OPS, page) {
    const raw = [""];
    let y = null;
    const newline = () => raw[raw.length - 1] !== "" && raw.push("");
    opList.fnArray.forEach((fn, i) => {
      const args = opList.argsArray[i];
      if (fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
        if (fn !== OPS.showText && fn !== OPS.showSpacedText) newline();
        const glyphs = args[args.length - 1];
        for (const g of glyphs) {
          if (typeof g === "number") {
            if (g < -250) raw[raw.length - 1] += " "; // 큰 자간 이동은 띄어쓰기로 본다
          } else if (g) {
            // 유니코드 매핑이 없는 글리프(가운뎃점 등)는 앞뒤 단어가 붙지 않도록 공백으로 둔다
            raw[raw.length - 1] += g.unicode || " ";
          }
        }
      } else if (fn === OPS.moveText || fn === OPS.setLeadingMoveText) {
        if (Math.abs(args[1]) > 0.01) newline();
      } else if (fn === OPS.nextLine || fn === OPS.beginText) {
        newline();
      } else if (fn === OPS.setTextMatrix) {
        if (y === null || Math.abs(args[5] - y) > 0.5) newline();
        y = args[5];
      }
    });
    const lines = [];
    for (const text of raw) {
      const s = normalizeJamo(text.normalize("NFC")).trim();
      if (s && !NOISE.some((re) => re.test(s))) lines.push({ text: s, page, spaced: /\s$/.test(text) });
    }
    return lines;
  }

  // 줄 맨 앞의 문항 번호(01, 02, …)를 순서대로 찾아 블록으로 나눈다.
  function splitNumbered(lines, count) {
    const blocks = {};
    let cur = null;
    let expected = 1;
    for (let line of lines) {
      // 이전 선지 끝에 다음 문항 번호가 붙어 나오는 경우 (예: "…유형46  다음 중 …")
      if (cur !== null && expected <= count) {
        const re = new RegExp(`(?<=[^\\d\\s제])\\s*0?${expected}\\s{2,}(?=\\S)`);
        const m = re.exec(line.text);
        if (m) {
          blocks[cur].push({ text: line.text.slice(0, m.index), page: line.page, spaced: true });
          line = { ...line, text: line.text.slice(m.index).trim() };
        }
      }
      const m = /^(\d{2,3})(?:\s+|$)([\s\S]*)$/.exec(line.text);
      if (m && Number(m[1]) === expected && expected <= count) {
        cur = expected++;
        blocks[cur] = m[2] ? [{ ...line, text: m[2] }] : [];
      } else if (cur !== null) {
        blocks[cur].push(line);
      }
    }
    return blocks;
  }

  function parseQuestion(lines) {
    const stem = [];
    const choices = [];
    for (const line of lines) {
      const parts = line.text.split(/(?=[①②③④⑤])/);
      parts.forEach((part, i) => {
        const text = part.trim();
        if (!text) return;
        // 줄 중간에서 잘린 조각 뒤에는 다음 선지가 오므로 띄어쓰기로 취급한다
        const piece = { text, spaced: i === parts.length - 1 ? line.spaced : true };
        if (CIRCLED.includes(text[0])) choices.push([{ ...piece, text: text.slice(1).trim() }]);
        else if (choices.length) choices[choices.length - 1].push(piece);
        else stem.push(piece);
      });
    }
    return { stem: join(stem), choices: choices.map(join) };
  }

  async function parse(pdf, onProgress = () => {}) {
    const OPS = window.pdfjsLib.OPS;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const opList = await page.getOperatorList();
      pages.push(pageLines(opList, OPS, n));
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
      const qLines = pages.slice(...qRanges[r - 1]).flat();
      const aLines = pages.slice(...aRanges[r - 1]).flat();

      const keyLines = new Set(aLines.slice(0, 60).filter((l) => ANSWER_LINE.test(l.text)));
      const answers = {};
      for (const l of keyLines) {
        for (const [, n, c] of l.text.matchAll(ANSWER_PAIR)) answers[Number(n)] = CIRCLED.indexOf(c) + 1;
      }
      const qBlocks = splitNumbered(qLines, 100);
      const eBlocks = splitNumbered(aLines.filter((l) => !keyLines.has(l)), 100);

      for (let n = 1; n <= 100; n++) {
        const block = qBlocks[n] || [];
        const { stem, choices } = parseQuestion(block);
        const q = {
          id: `${r}-${n}`,
          round: r,
          no: n,
          subject: subjectOf(n),
          stem,
          choices,
          answer: answers[n] || null,
          explanation: join(eBlocks[n] || []),
          pages: [...new Set(block.map((l) => l.page))].sort((a, b) => a - b),
        };
        if (choices.length !== 5 || !q.answer || !stem) problems.push(`${q.id}: 선지 ${choices.length}개, 정답 ${q.answer ?? "없음"}`);
        if (!q.explanation) problems.push(`${q.id}: 해설 없음`);
        questions.push(q);
      }
    }
    return { questions, problems };
  }

  window.CPPGParser = { parse, SUBJECTS: SUBJECTS.map((s) => s[2]) };
})();
