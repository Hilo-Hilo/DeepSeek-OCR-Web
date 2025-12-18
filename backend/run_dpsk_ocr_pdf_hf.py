import os
import sys
import io
import re
import torch
import warnings
import fitz
from PIL import Image
from transformers import AutoModel, AutoTokenizer
from config import *

class Colors:
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    RESET = "\033[0m"

# Disable JIT if needed
os.environ["PYTORCH_JIT"] = "0"
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "0") # Respect outer environment, only set default

warnings.filterwarnings("ignore")

def pdf_to_images_high_quality(pdf_path: str, dpi: int = 144) -> list[Image.Image]:
    """Render a PDF into a list of PIL images (one per page)."""
    images: list[Image.Image] = []
    doc = fitz.open(pdf_path)
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    Image.MAX_IMAGE_PIXELS = None
    try:
        for page_num in range(doc.page_count):
            page = doc[page_num]
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            img = Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")
            images.append(img)
    finally:
        doc.close()
    return images

def rewrite_markdown_image_paths(markdown: str, page_rel_dir: str) -> str:
    """Rewrite markdown image links like (images/0.jpg) to (pages/page_001/images/0.jpg).

    This matches frontend logic which converts relative image paths relative to the task's resultDir root.
    """
    prefix = page_rel_dir.strip("/").rstrip("/")

    def repl(match: re.Match[str]) -> str:
        alt = match.group(1) or ""
        raw_path = (match.group(2) or "").strip()
        if not raw_path:
            return match.group(0)
        if raw_path.startswith("data:") or raw_path.startswith("http://") or raw_path.startswith("https://"):
            return match.group(0)
        # Normalize ./images/... and images/...
        path = raw_path
        if path.startswith("./"):
            path = path[2:]
        if not path.startswith("/"):
            path = f"{prefix}/{path}"
        return f"![{alt}]({path})"

    return re.sub(r"!\[(.*?)\]\((.*?)\)", repl, markdown)

def pick_device() -> str:
    """Pick a safe device for inference.

    Prefer CUDA when available. Some PyTorch builds may warn that a newer SM
    (e.g. sm_121) is not explicitly listed; in practice CUDA may still work
    (e.g. via compatible cubins/PTX). We therefore only fall back to CPU when
    CUDA actually fails at runtime.
    """
    if not torch.cuda.is_available():
        return "cpu"
    try:
        cap = torch.cuda.get_device_capability(0)
        arch = f"sm_{cap[0]}{cap[1]}"
        arch_list = torch.cuda.get_arch_list()
        if arch not in arch_list:
            print(
                f"{Colors.YELLOW}Warning: GPU arch {arch} not explicitly listed in this PyTorch build "
                f"({', '.join(arch_list)}). Attempting CUDA anyway; will fall back to CPU if CUDA fails.{Colors.RESET}"
            )
    except Exception as e:
        print(f"{Colors.YELLOW}Warning: Failed to detect CUDA arch ({e}). Attempting CUDA anyway.{Colors.RESET}")
    return "cuda"

if __name__ == "__main__":
    def main() -> None:
        print(f'{Colors.BLUE}Loading DeepSeek OCR model (Hugging Face Transformers)...{Colors.RESET}')
        tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
        model = AutoModel.from_pretrained(MODEL_PATH, trust_remote_code=True, use_safetensors=True)

        device = pick_device()
        model = model.eval()
        if device == "cuda":
            try:
                model = model.cuda().to(torch.bfloat16)
                print(f'{Colors.GREEN}Model loaded successfully on CUDA!{Colors.RESET}')
            except Exception as e:
                print(f"{Colors.YELLOW}Warning: Failed to move model to CUDA ({e}). Falling back to CPU.{Colors.RESET}")
                device = "cpu"
                model = model.to("cpu").to(torch.float32)
                print(f'{Colors.GREEN}Model loaded successfully on CPU.{Colors.RESET}')
        else:
            model = model.to("cpu").to(torch.float32)
            print(f'{Colors.GREEN}Model loaded successfully on CPU.{Colors.RESET}')

        print(f'{Colors.BLUE}Running OCR inference...{Colors.RESET}')

        def _is_cuda_failure(err: Exception) -> bool:
            msg = str(err).lower()
            return any(
                s in msg
                for s in [
                    "cuda",
                    "cudnn",
                    "cublas",
                    "no kernel image is available",
                    "not compatible with the current pytorch installation",
                    "device-side assert",
                    "illegal memory access",
                ]
            )

        def infer_once(image_path: str, out_dir: str) -> None:
            """Run a single-page inference. On CUDA runtime failure, retry once on CPU."""
            nonlocal device, model
            try:
                model.infer(
                    tokenizer,
                    prompt=PROMPT,
                    image_file=image_path,
                    output_path=out_dir,
                    base_size=BASE_SIZE,
                    image_size=IMAGE_SIZE,
                    crop_mode=CROP_MODE,
                    save_results=True,
                )
            except Exception as e:
                if device == "cuda" and _is_cuda_failure(e):
                    print(f"{Colors.YELLOW}CUDA inference failed ({e}). Falling back to CPU for this task...{Colors.RESET}")
                    model = model.to("cpu").to(torch.float32)
                    device = "cpu"
                    model.infer(
                        tokenizer,
                        prompt=PROMPT,
                        image_file=image_path,
                        output_path=out_dir,
                        base_size=BASE_SIZE,
                        image_size=IMAGE_SIZE,
                        crop_mode=CROP_MODE,
                        save_results=True,
                    )
                    return
                raise

        input_path = str(INPUT_PATH)
        if input_path.lower().endswith(".pdf"):
            try:
                pages = pdf_to_images_high_quality(input_path, dpi=144)
            except Exception as e:
                print(f"{Colors.RED}Inference failed: Failed to render PDF ({e}){Colors.RESET}")
                sys.exit(1)

            combined_parts: list[str] = []
            os.makedirs(OUTPUT_PATH, exist_ok=True)

            for idx, page_img in enumerate(pages, start=1):
                page_rel = f"pages/page_{idx:03d}"
                page_out_dir = os.path.join(OUTPUT_PATH, page_rel)
                os.makedirs(page_out_dir, exist_ok=True)

                page_image_path = os.path.join(page_out_dir, f"page_{idx:03d}.png")
                try:
                    page_img.save(page_image_path)
                except Exception:
                    pass

                print(f"{Colors.BLUE}Processing PDF page {idx}/{len(pages)}...{Colors.RESET}")
                try:
                    infer_once(page_image_path, page_out_dir)
                except Exception as e:
                    print(f"{Colors.RED}Inference failed: {e}{Colors.RESET}")
                    sys.exit(1)

                # Rewrite the page result.mmd so image links resolve from the resultDir root.
                page_mmd_path = os.path.join(page_out_dir, "result.mmd")
                if os.path.exists(page_mmd_path):
                    try:
                        txt = open(page_mmd_path, "r", encoding="utf-8", errors="ignore").read()
                        rewritten = rewrite_markdown_image_paths(txt, page_rel)
                        open(page_mmd_path, "w", encoding="utf-8").write(rewritten)
                        combined_parts.append(rewritten)
                    except Exception:
                        try:
                            combined_parts.append(open(page_mmd_path, "r", encoding="utf-8", errors="ignore").read())
                        except Exception:
                            pass

            # Write a combined root-level result.mmd for convenience (download/preview).
            if combined_parts:
                combined = ("\n\n<--- Page Split --->\n\n").join(combined_parts).strip() + "\n"
                open(os.path.join(OUTPUT_PATH, "result.mmd"), "w", encoding="utf-8").write(combined)

            print(f'{Colors.GREEN}OCR complete! Results saved to {OUTPUT_PATH}{Colors.RESET}')
        else:
            # Fallback: treat input as an image (should not happen for PDF tasks, but keeps script robust).
            try:
                infer_once(input_path, OUTPUT_PATH)
                print(f'{Colors.GREEN}OCR complete! Results saved to {OUTPUT_PATH}{Colors.RESET}')
            except Exception as e:
                print(f'{Colors.RED}Inference failed: {e}{Colors.RESET}')
                sys.exit(1)

    main()
