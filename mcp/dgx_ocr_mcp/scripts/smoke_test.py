from __future__ import annotations

import tempfile
from pathlib import Path

from dgx_ocr_mcp.server import convert_to_markdown


# Minimal valid single-page PDF (Hello) — tiny and self-contained.
# Source: hand-crafted minimal PDF structure.
MIN_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n"
    b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n"
    b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n"
    b"4 0 obj<< /Length 44 >>stream\n"
    b"BT /F1 18 Tf 50 100 Td (Hello) Tj ET\n"
    b"endstream endobj\n"
    b"5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n"
    b"xref\n0 6\n0000000000 65535 f \n"
    b"0000000009 00000 n \n"
    b"0000000058 00000 n \n"
    b"0000000115 00000 n \n"
    b"0000000241 00000 n \n"
    b"0000000335 00000 n \n"
    b"trailer<< /Size 6 /Root 1 0 R >>\n"
    b"startxref\n411\n%%EOF\n"
)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="dgx_ocr_smoke_") as tmpdir:
        tmp = Path(tmpdir)
        pdf_path = tmp / "sample.pdf"
        pdf_path.write_bytes(MIN_PDF)

        result = convert_to_markdown(
            source_path=str(pdf_path),
            wait=True,
            save_to_dir=str(tmp),
            timeout_s=300,
        )

        saved_path = Path(result.get("saved_path", ""))
        assert saved_path.exists(), f"Saved markdown missing: {saved_path}"

        snippet = (result.get("markdown", "") or "").strip().splitlines()[:5]
        print("task_id:", result.get("task_id"))
        print("saved_path:", saved_path)
        print("snippet:", " | ".join(snippet))


if __name__ == "__main__":
    main()
