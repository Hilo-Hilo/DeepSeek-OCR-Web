from __future__ import annotations

import argparse
import os
import textwrap

from dgx_ocr_mcp.server import convert_to_markdown

SAMPLE_PDF_URL = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke test for DGX OCR MCP")
    parser.add_argument("--url", default=SAMPLE_PDF_URL, help="Sample PDF URL")
    parser.add_argument("--timeout", type=int, default=300, help="Timeout in seconds")
    args = parser.parse_args()

    base_url = os.getenv("DGX_OCR_BASE_URL", "http://100.111.126.23:8002")
    print(f"Using backend: {base_url}")
    print(f"Fetching sample: {args.url}")

    result = convert_to_markdown(source_url=args.url, timeout_s=args.timeout)
    snippet = textwrap.shorten(result.get("markdown", "").replace("\n", " "), width=200, placeholder="...")

    print("Task ID:", result.get("task_id"))
    print("Selected file:", result.get("selected_file"))
    print("Result dir:", result.get("result_dir"))
    print("Markdown snippet:", snippet)


if __name__ == "__main__":
    main()
