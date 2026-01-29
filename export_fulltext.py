"""
OCR every page of the book into plain text files for manual cleanup.

Outputs: ./ocr_fulltext/page-XXX.txt (1-based pages).
Uses Tesseract with Traditional Chinese + English, OEM 1, PSM 4, 300dpi.
"""

import subprocess
from pathlib import Path

PDF = "一生必學的萬用英文單字  5,000單字用一輩子 (Jiang, Zhiyu, 蔣志榆) .pdf"
OUT_DIR = Path("ocr_fulltext")
TMP = Path("/tmp/ocr_pages")
OUT_DIR.mkdir(exist_ok=True)
TMP.mkdir(exist_ok=True)

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
            timeout=180,
        )
    text = res.stdout.decode("utf-8", "ignore")
    try:
        ppm_path.unlink()
    except FileNotFoundError:
        pass
    return text


def main():
    total_pages = 348
    for p in range(1, total_pages + 1):
        out_path = OUT_DIR / f"page-{p:03d}.txt"
        if out_path.exists():
            continue
        print(f"OCR page {p}/{total_pages}...")
        text = ocr_page(p)
        out_path.write_text(text, encoding="utf-8")
    print("Done.")


if __name__ == "__main__":
    main()
