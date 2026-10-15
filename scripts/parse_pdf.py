"""CPPG 실전 300제 PDF를 파싱해 기출 풀이 사이트용 데이터를 생성한다.

사용법: python scripts/parse_pdf.py <PDF 경로>

생성물 (저작권 보호를 위해 git에 올리지 않는다):
  data/questions.js    사이트가 읽는 문제 데이터
  data/questions.json  같은 내용의 JSON
  data/pages/*.png     표·그림 확인용 원본 페이지 이미지
"""
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

CIRCLED = "①②③④⑤"
NOISE = [
    re.compile(r"^\d{1,3}$"),                       # 페이지 번호
    re.compile(r"^ⓒ\s*\d{4}\..*rights reserved\.?$"),
    re.compile(r"^\S+@\S+\.\S+$"),                  # 워터마크 이메일
    re.compile(r"^.*실전 300제$"),
    re.compile(r"^0[1-3] 회차\s+정답과 해설$"),
    re.compile(r"^(수고하셨습니다|정답|과|해설)$"),
]
ANSWER_PAIR = re.compile(r"(\d{2,3})\s*([①②③④⑤])")
ANSWER_LINE = re.compile(r"(\d{2,3}\s*[①②③④⑤]\s*)+")

# 회차당 과목별 문항 범위 (시험 배점표 기준)
SUBJECTS = [
    (1, 10, "개인정보보호의 이해"),
    (11, 30, "개인정보보호 제도"),
    (31, 55, "개인정보 라이프 사이클 관리"),
    (56, 85, "개인정보의 보호조치"),
    (86, 100, "개인정보 관리체계"),
]

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"


def subject_of(n):
    return next(name for lo, hi, name in SUBJECTS if lo <= n <= hi)


class Line(str):
    """원문 줄 끝에 공백이 있었는지(=단어 경계에서 줄바꿈) 기억하는 문자열."""

    def __new__(cls, text, page, spaced):
        obj = super().__new__(cls, text)
        obj.page, obj.spaced = page, spaced
        return obj


def clean_lines(text, page):
    out = []
    for raw in text.splitlines():
        s = raw.strip()
        if s and not any(p.match(s) for p in NOISE):
            out.append(Line(s, page, raw != raw.rstrip()))
    return out


def join(lines):
    # PDF 줄바꿈으로 끊긴 문장을 잇는다. 원문 줄 끝에 공백이 없으면 단어 중간에서 끊긴 것으로 본다.
    text = ""
    for line in lines:
        if not text:
            text = str(line)
        elif prev_spaced or not (re.search(r"[가-힣]$", text) and re.match(r"^[가-힣]", line)):
            text += " " + line
        else:
            text += line
        prev_spaced = getattr(line, "spaced", True)
    return re.sub(r"\s+", " ", text).strip()


def split_numbered(lines, count):
    """줄 맨 앞의 문항 번호(01, 02, ... count)를 순서대로 찾아 블록으로 나눈다."""
    blocks, cur, expected = {}, None, 1
    for line in lines:
        # PDF 추출 시 이전 선지 끝에 다음 문항 번호가 붙는 경우가 있다 (예: "…유형46  다음 중 …")
        glued = re.search(rf"(?<=[^\d\s제])\s*0?{expected}\s{{2,}}(?=\S)", line) if cur is not None else None
        if glued:
            blocks[cur].append(Line(line[: glued.start()], line.page, True))
            line = Line(line[glued.start():].strip(), line.page, line.spaced)
        m = re.match(r"^(\d{2,3})(?:\s+|$)(.*)$", line)
        if m and int(m.group(1)) == expected and expected <= count:
            cur = expected
            blocks[cur] = [Line(m.group(2), line.page, line.spaced)] if m.group(2) else []
            expected += 1
        elif cur is not None:
            blocks[cur].append(line)
    return blocks


def parse_question(lines):
    # 선지 기호(①~⑤)를 기준으로 발문과 선지를 나눈다. 줄 단위 정보를 유지하기 위해 줄을 쪼갠다.
    pieces = []
    for line in lines:
        for part in re.split(r"(?=[①②③④⑤])", line):
            if part.strip():
                pieces.append(Line(part.strip(), line.page, line.spaced if part is not None else True))
    stem, choices = [], []
    for p in pieces:
        if p[0] in CIRCLED:
            choices.append([Line(p[1:].strip(), p.page, p.spaced)])
        elif choices:
            choices[-1].append(p)
        else:
            stem.append(p)
    return join(stem), [join(c) for c in choices]


def render_pages(pdf_path, page_numbers):
    try:
        import pypdfium2 as pdfium
    except ImportError:
        print("pypdfium2가 없어 원본 페이지 이미지를 건너뜁니다 (pip install pypdfium2)")
        return False
    pages_dir = OUT / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    pdf = pdfium.PdfDocument(pdf_path)
    for n in sorted(page_numbers):
        target = pages_dir / f"p{n:03d}.png"
        if not target.exists():
            pdf[n - 1].render(scale=1.6).to_pil().save(target, optimize=True)
    return True


def main(pdf_path):
    reader = PdfReader(pdf_path)
    pages = [clean_lines(p.extract_text() or "", i + 1) for i, p in enumerate(reader.pages)]

    # 회차 표지(“합격결정기준” 안내 페이지)와 정답표 페이지로 구간을 나눈다.
    round_starts = [i + 1 for i, p in enumerate(pages) if any(l.startswith("합격결정기준") for l in p)]
    answer_starts = [i for i, p in enumerate(pages) if len(ANSWER_PAIR.findall(" ".join(p[:20]))) >= 50]
    assert len(round_starts) == 3 and len(answer_starts) == 3, (round_starts, answer_starts)
    omr = next(i for i, p in enumerate(pages) if i > answer_starts[-1] and not any(re.match(r"^\d{2}\s", l) for l in p))

    q_ranges = [(round_starts[0], round_starts[1] - 1), (round_starts[1], round_starts[2] - 1), (round_starts[2], answer_starts[0])]
    a_ranges = [(answer_starts[0], answer_starts[1]), (answer_starts[1], answer_starts[2]), (answer_starts[2], omr)]

    questions, problems, used_pages = [], [], set()
    for r, ((qs, qe), (as_, ae)) in enumerate(zip(q_ranges, a_ranges), start=1):
        q_lines = [l for p in pages[qs:qe] for l in p]
        a_lines = [l for p in pages[as_:ae] for l in p]

        key_lines = [l for l in a_lines[:40] if ANSWER_LINE.fullmatch(l)]
        answers = {int(n): CIRCLED.index(c) + 1 for l in key_lines for n, c in ANSWER_PAIR.findall(l)}
        expl_lines = [l for l in a_lines if l not in key_lines]

        q_blocks = split_numbered(q_lines, 100)
        e_blocks = split_numbered(expl_lines, 100)
        for n in range(1, 101):
            block = q_blocks.get(n, [])
            stem, choices = parse_question(block)
            q_pages = sorted({l.page for l in block})
            used_pages.update(q_pages)
            q = {
                "id": f"{r}-{n}",
                "round": r,
                "no": n,
                "subject": subject_of(n),
                "stem": stem,
                "choices": choices,
                "answer": answers.get(n),
                "explanation": join(e_blocks.get(n, [])),
                "pages": q_pages,
            }
            if len(choices) != 5 or not q["answer"] or not stem:
                problems.append(f"{q['id']}: choices={len(choices)} answer={q['answer']} stem={bool(stem)}")
            if not q["explanation"]:
                problems.append(f"{q['id']}: 해설 없음")
            questions.append(q)

    OUT.mkdir(exist_ok=True)
    payload = json.dumps(questions, ensure_ascii=False, indent=1)
    (OUT / "questions.json").write_text(payload, encoding="utf-8")
    (OUT / "questions.js").write_text(f"window.CPPG_QUESTIONS = {payload};\n", encoding="utf-8")
    print(f"{len(questions)}문항 생성 → {OUT / 'questions.js'}")

    if render_pages(pdf_path, used_pages):
        print(f"원본 페이지 이미지 {len(used_pages)}장 → {OUT / 'pages'}")

    if problems:
        print(f"확인 필요 {len(problems)}건:")
        print("\n".join("  " + p for p in problems))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
