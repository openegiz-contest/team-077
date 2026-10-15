import os
import sys
import zlib
import base64
import re
import pytest
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate
from reportlab.lib.styles import ParagraphStyle
import io
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import team.generate_presentation as gp


def test_supports_cyrillic():
    """Verify supports_cyrillic accurately validates Cyrillic glyph presence."""
    win_dir = os.environ.get("WINDIR", "C:\\Windows")
    arial = os.path.join(win_dir, "Fonts", "arial.ttf")
    if os.path.isfile(arial):
        assert gp.supports_cyrillic(arial) is True

    # Non-existent file
    assert gp.supports_cyrillic("non_existent_font.ttf") is False
    assert gp.supports_cyrillic("") is False

    # Font without Cyrillic (ReportLab's bundled Vera.ttf)
    import reportlab
    vera = os.path.join(os.path.dirname(reportlab.__file__), "fonts", "Vera.ttf")
    if os.path.isfile(vera):
        assert gp.supports_cyrillic(vera) is False


def test_setup_cyrillic_fonts():
    """Verify font registration and return values."""
    fn_normal, fn_bold, fn_mono, fn_mono_bold = gp.setup_cyrillic_fonts()
    assert fn_normal in pdfmetrics.getRegisteredFontNames()
    assert fn_bold in pdfmetrics.getRegisteredFontNames()
    assert fn_mono in pdfmetrics.getRegisteredFontNames()


def test_dynamic_search_and_fallback(tmp_path):
    """Verify that font search properly rejects non-Cyrillic fonts and falls back gracefully."""
    import reportlab
    import shutil

    # Put a non-Cyrillic font (Vera.ttf) in a temp directory named as DejaVuSans.ttf
    fake_dir = tmp_path / "fonts"
    fake_dir.mkdir()
    fake_dejavu = fake_dir / "DejaVuSans.ttf"
    vera = os.path.join(os.path.dirname(reportlab.__file__), "fonts", "Vera.ttf")
    if os.path.isfile(vera):
        shutil.copy(vera, fake_dejavu)

    # 1. When candidates are empty and search_dirs contains only non-Cyrillic font, it rejects it and falls back to Helvetica
    res = gp.setup_cyrillic_fonts(sans_candidates=[], mono_candidates=[], search_dirs=[str(fake_dir)])
    assert res == ("Helvetica", "Helvetica-Bold", "Courier", "Courier-Bold")

    # 2. When search_dirs contains a real Cyrillic font (e.g. copied from Windows fonts), it discovers and uses it
    win_dir = os.environ.get("WINDIR", "C:\\Windows")
    arial = os.path.join(win_dir, "Fonts", "arial.ttf")
    if os.path.isfile(arial):
        real_cyr = fake_dir / "CustomSans.ttf"
        shutil.copy(arial, real_cyr)
        res2 = gp.setup_cyrillic_fonts(sans_candidates=[], mono_candidates=[], search_dirs=[str(fake_dir)])
        assert res2[0] == "CyrillicSans"
        assert res2[1] == "CyrillicSans-Bold"


def test_tags_support():
    """Verify inline <b>, <i>, <code> tags work without ValueError."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf)
    style = ParagraphStyle("test", fontName=gp.FONT_NORMAL)
    text = "Текст с <b>жирным</b>, <i>курсивом</i> и <code>моноширинным кодом</code>."
    p = Paragraph(text, style)
    doc.build([p])
    pdf = buf.getvalue()
    assert b"%PDF" in pdf
    # Verify no ZapfDingbats in output
    assert b"ZapfDingbats" not in pdf


def test_presentation_pdf_integrity():
    """Verify the generated presentation.pdf structure, slide count, fonts and decoded text."""
    pdf_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "presentation.pdf")
    assert os.path.isfile(pdf_path), f"Missing {pdf_path}"

    with open(pdf_path, "rb") as f:
        pdf = f.read()

    # 1. Slide count must be exactly 10
    page_count = len(re.findall(rb"/Type\s*/Page\b", pdf))
    assert page_count == 10, f"Expected 10 pages, found {page_count}"

    # 2. No Type 1 ZapfDingbats fallback
    assert b"ZapfDingbats" not in pdf

    # 3. All embedded fonts are TrueType subsets
    base_fonts = re.findall(rb"/BaseFont\s*/([A-Za-z0-9_\-+]+)", pdf)
    for bf in base_fonts:
        bf_name = bf.decode("latin1")
        assert "+" in bf_name, f"Expected font subset prefix, got {bf_name}"

    # 4. Parse CMaps and decode page texts
    fonts = {}
    f1_match = re.search(rb"1 0 obj\s*<<\s*(.*?)\s*>>", pdf, re.DOTALL)
    assert f1_match is not None, "Font resource dictionary object 1 not found"
    for m in re.finditer(rb"/([A-Za-z0-9+]+)\s+(\d+)\s+0\s+R", f1_match.group(1)):
        fname = m.group(1).decode("latin1")
        fobj = int(m.group(2))
        fobj_data = re.search(rb"\b%d\s+0\s+obj\s*<<(.*?)>>" % fobj, pdf, re.DOTALL).group(1)
        tu_obj = int(re.search(rb"/ToUnicode\s+(\d+)\s+0\s+R", fobj_data).group(1))
        tu_header = re.search(rb"\b%d\s+0\s+obj.*?/Length\s+(\d+).*?stream\r?\n" % tu_obj, pdf, re.DOTALL)
        slen = int(tu_header.group(1))
        sstart = tu_header.end()
        sdecomp = zlib.decompress(pdf[sstart : sstart + slen])
        cmap = {}
        for bf in re.finditer(rb"<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>", sdecomp):
            c = int(bf.group(1), 16)
            u = int(bf.group(2), 16)
            cmap[c] = chr(u)
        fonts[fname] = cmap

    pages = []
    for m in re.finditer(rb"<<\s*/Contents\s+(\d+)\s+0\s+R.*?/Type\s*/Page\b", pdf, re.DOTALL):
        cobj = int(m.group(1))
        cheader = re.search(rb"\b%d\s+0\s+obj.*?/Length\s+(\d+).*?stream\r?\n" % cobj, pdf, re.DOTALL)
        slen = int(cheader.group(1))
        sstart = cheader.end()
        raw = pdf[sstart : sstart + slen]
        cdecomp = zlib.decompress(base64.a85decode(raw.strip(), adobe=True))
        pages.append(cdecomp)

    assert len(pages) == 10

    expected_keywords_per_page = [
        ["ЦИФРОВОЙ ДВОЙНИК", "АКТОГАЙ", "OPENEGIZ", "Слайд 1 из 10"],
        ["Проблема", "Производственный контекст", "Слайд 2 из 10"],
        ["Горно-геологические параметры", "CAT 793F", "Слайд 3 из 10"],
        ["Архитектура решения", "Eclipse Ditto", "Слайд 4 из 10"],
        ["Физический симулятор", "Сопротивление", "Слайд 5 из 10"],
        ["Алгоритм динамической шихтовки", "0.48% Cu", "Слайд 6 из 10"],
        ["3D-визуализация", "Three.js", "Слайд 7 из 10"],
        ["Сценарное моделирование", "Что если", "Слайд 8 из 10"],
        ["Дашборд диспетчера", "Grafana", "Слайд 9 из 10"],
        ["Развертывание", "make aktogay", "Слайд 10 из 10"],
    ]

    for idx, pstream in enumerate(pages):
        cur_font = None
        tokens = re.finditer(rb"/([A-Za-z0-9+]+)\s+[0-9.]+\s+Tf|(\[(?:[^\]]+)\])\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*Tj", pstream)
        current_line = []
        for t in tokens:
            if t.group(1):
                cur_font = t.group(1).decode("latin1")
            elif t.group(2):
                for sm in re.finditer(rb"\(((?:[^()\\]|\\.)*)\)", t.group(2)):
                    raw_str = sm.group(1)
                    chars = []
                    i = 0
                    while i < len(raw_str):
                        if raw_str[i : i + 1] == b"\\" and i + 3 < len(raw_str) and raw_str[i + 1 : i + 4].isdigit():
                            code = int(raw_str[i + 1 : i + 4], 8)
                            i += 4
                        elif raw_str[i : i + 1] == b"\\" and i + 1 < len(raw_str):
                            code = raw_str[i + 1]
                            i += 2
                        else:
                            code = raw_str[i]
                            i += 1
                        chars.append(fonts.get(cur_font, {}).get(code, chr(code)))
                    current_line.append("".join(chars))
            elif t.group(3):
                raw_str = t.group(3)
                chars = []
                i = 0
                while i < len(raw_str):
                    if raw_str[i : i + 1] == b"\\" and i + 3 < len(raw_str) and raw_str[i + 1 : i + 4].isdigit():
                        code = int(raw_str[i + 1 : i + 4], 8)
                        i += 4
                    elif raw_str[i : i + 1] == b"\\" and i + 1 < len(raw_str):
                        code = raw_str[i + 1]
                        i += 2
                    else:
                        code = raw_str[i]
                        i += 1
                    chars.append(fonts.get(cur_font, {}).get(code, chr(code)))
                current_line.append("".join(chars))

        full_page_text = " ".join(current_line)
        for kw in expected_keywords_per_page[idx]:
            assert kw in full_page_text, f"Page {idx+1} missing expected text '{kw}'. Page text snippet: {full_page_text[:200]}"
