import csv
import re
import subprocess
import sys
from pathlib import Path

PDF = "一生必學的萬用英文單字  5,000單字用一輩子 (Jiang, Zhiyu, 蔣志榆) .pdf"
TMP = Path("/tmp/ocr_pages")
TMP.mkdir(exist_ok=True)

headword_re = re.compile(r"\b([A-Za-z][A-Za-z\-']{1,20})\b")
pair_re = re.compile(r"([A-Za-z][A-Za-z\-']{1,20})\s*\[([^\]]{1,30})\]")
bracket_re = re.compile(r"\[([A-Za-z][^\]]{1,40})\]")
chinese_re = re.compile(r"[\u4e00-\u9fff]")


def parse_lines(lines):
    entries = []
    current = None
    prev_en_line = ""
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        has_ch = bool(chinese_re.search(line))

        if not has_ch:
            m = pair_re.search(line)
            if m:
                if current:
                    entries.append(current)
                head, ipa = m.group(1).lower(), m.group(2).strip()
                current = {
                    "headword": head,
                    "ipa": ipa,
                    "chinese": "",
                    "example_en": "",
                    "example_zh": "",
                }
                continue

            # Sometimes the headword is inside the bracket block when OCR drops the word.
            b = bracket_re.search(line)
            if b:
                content = b.group(1).strip()
                parts = content.split()
                head = parts[0].lower()
                ipa = " ".join(parts[1:]).strip()
                if current:
                    entries.append(current)
                current = {
                    "headword": head,
                    "ipa": ipa,
                    "chinese": "",
                    "example_en": "",
                    "example_zh": "",
                }
                continue

            m2 = headword_re.match(line)
            if m2 and (current is None or current["headword"] != m2.group(1).lower()):
                if current:
                    entries.append(current)
                current = {
                    "headword": m2.group(1).lower(),
                    "ipa": "",
                    "chinese": "",
                    "example_en": "",
                    "example_zh": "",
                }
                prev_en_line = line
                continue

            if current and any(ch in line for ch in ".!?") and len(line.split()) > 3:
                if not current["example_en"]:
                    current["example_en"] = line
            prev_en_line = line
            continue

        # Chinese-containing line
        if current:
            if current["chinese"]:
                current["chinese"] += " " + line
            else:
                current["chinese"] = line
            if current["example_en"] and not current["example_zh"]:
                current["example_zh"] = line
        else:
            # Try to backfill a headword from the previous English line
            m_prev = pair_re.search(prev_en_line) or headword_re.search(prev_en_line)
            if m_prev:
                head = m_prev.group(1).lower()
                ipa = ""
                if pair_re.search(prev_en_line):
                    ipa = pair_re.search(prev_en_line).group(2).strip()
                current = {
                    "headword": head,
                    "ipa": ipa,
                    "chinese": line,
                    "example_en": "",
                    "example_zh": "",
                }
            # if still none, skip

    if current:
        entries.append(current)

    # filter low-quality rows
    cleaned = []
    for e in entries:
        if len(e["headword"]) < 2:
            continue
        if not e["chinese"]:
            continue
        cleaned.append(e)
    return cleaned


def ocr_page(page: int) -> str:
    ppm_prefix = TMP / f"page-{page:03d}"
    subprocess.run(
        ["pdftoppm", "-r", "300", "-f", str(page), "-l", str(page), "-singlefile", PDF, str(ppm_prefix)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    ppm_path = TMP / f"page-{page:03d}.ppm"
    if not ppm_path.exists():
        candidates = list(TMP.glob(f"page-{page:03d}*.ppm"))
        if not candidates:
            return ""
        ppm_path = candidates[0]

    with open(ppm_path, "rb") as imgf:
        res = subprocess.run(
            ["tesseract", "stdin", "stdout", "-l", "eng+chi_tra", "--oem", "1", "--psm", "4"],
            stdin=imgf,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=120,
        )
    text = res.stdout.decode("utf-8", "ignore")
    try:
        ppm_path.unlink()
    except FileNotFoundError:
        pass
    return text


def main():
    start = int(sys.argv[1])
    end = int(sys.argv[2])
    out = sys.argv[3]

    entries = []
    for p in range(start, end + 1):
        print(f"OCR page {p}/{end}...")
        text = ocr_page(p)
        lines = text.split("\n")
        entries.extend({"page": p, **e} for e in parse_lines(lines))

    seen = set()
    unique = []
    for e in entries:
        key = (e["page"], e["headword"], e["chinese"][:40])
        if key in seen:
            continue
        seen.add(key)
        unique.append(e)

    write_header = not Path(out).exists()
    with open(out, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f, fieldnames=["page", "headword", "ipa", "chinese", "example_en", "example_zh"]
        )
        if write_header:
            w.writeheader()
        w.writerows(unique)
    print(f"batch wrote {len(unique)} rows -> {out}")


if __name__ == "__main__":
    main()
