from __future__ import annotations

import argparse
import os
import sys
import time
import subprocess
import io
import re
import warnings
import contextlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from PIL import Image

class Colors:
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    RESET = "\033[0m"

# Disable JIT if needed
os.environ["PYTORCH_JIT"] = "0"

DEFAULT_MODEL_ID = "deepseek-ai/DeepSeek-OCR-2"

def _load_legacy_config() -> dict | None:
    """Best-effort backward compat: allow running without CLI args via legacy `config.py`."""
    try:
        import config as legacy  # type: ignore
    except Exception:
        return None

    def get(name: str, default=None):
        return getattr(legacy, name, default)

    return {
        "MODEL_PATH": get("MODEL_PATH"),
        "INPUT_PATH": get("INPUT_PATH"),
        "OUTPUT_PATH": get("OUTPUT_PATH"),
        "PROMPT": get("PROMPT"),
        "BASE_SIZE": get("BASE_SIZE", 1024),
        "IMAGE_SIZE": get("IMAGE_SIZE", 768),
        "CROP_MODE": get("CROP_MODE", True),
    }

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="DeepSeek-OCR-2 PDF inference (HF Transformers).")
    p.add_argument("--model-path", dest="model_path", default=None, help="HF repo id or local path")
    p.add_argument("--input-path", dest="input_path", default=None, help="Input PDF or image path")
    p.add_argument("--output-path", dest="output_path", default=None, help="Output directory")
    p.add_argument("--prompt", dest="prompt", default=None, help="Prompt text (include <image> tag)")
    p.add_argument("--base-size", dest="base_size", type=int, default=None, help="Base size (default 1024)")
    p.add_argument("--image-size", dest="image_size", type=int, default=None, help="Crop tile size (default 768)")
    crop = p.add_mutually_exclusive_group()
    crop.add_argument("--crop-mode", dest="crop_mode", action="store_true", help="Enable crop mode")
    crop.add_argument("--no-crop-mode", dest="crop_mode", action="store_false", help="Disable crop mode")
    p.set_defaults(crop_mode=None)
    p.add_argument(
        "--attn-implementation",
        dest="attn_implementation",
        default=None,
        choices=["eager", "sdpa", "flash_attention_2"],
        help="Attention implementation (default: eager; set flash_attention_2 if flash-attn is installed)",
    )
    p.add_argument("--pdf-dpi", dest="pdf_dpi", type=int, default=144, help="PDF render DPI (default: 144)")
    return p.parse_args()

def _truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes")


def _force_cpu() -> bool:
    return _truthy_env("DEEPSEEK_OCR_FORCE_CPU")


def _ensure_cuda_visible_devices_default() -> None:
    """If CUDA_VISIBLE_DEVICES is empty/unset, default to GPU 0.

    Note: an *empty* CUDA_VISIBLE_DEVICES hides all GPUs from CUDA/PyTorch.
    """
    if _force_cpu():
        # Hide GPUs from PyTorch so it won't touch a potentially broken CUDA context.
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
        return
    cvd = os.environ.get("CUDA_VISIBLE_DEVICES")
    if cvd is None or cvd.strip() == "":
        os.environ["CUDA_VISIBLE_DEVICES"] = "0"


# Respect outer environment, but treat empty value as "unset".
_ensure_cuda_visible_devices_default()

warnings.filterwarnings("ignore")

def _get_torch():
    import torch  # type: ignore
    return torch

def _cuda_arch() -> str | None:
    try:
        torch = _get_torch()
        cap = torch.cuda.get_device_capability(0)
        return f"sm_{cap[0]}{cap[1]}"
    except Exception:
        return None


def _force_safe_sdpa_kernels(reason: str) -> None:
    """Force SDPA to use math kernels (avoid flash/mem-efficient)."""
    try:
        torch = _get_torch()
        torch.backends.cuda.enable_flash_sdp(False)
        torch.backends.cuda.enable_mem_efficient_sdp(False)
        torch.backends.cuda.enable_math_sdp(True)
        print(f"{Colors.YELLOW}SDPA set to math-only for stability ({reason}).{Colors.RESET}")
    except Exception as e:
        print(f"{Colors.YELLOW}Warning: failed to configure SDPA kernels ({e}).{Colors.RESET}")


def configure_cuda_stability() -> None:
    """Best-effort knobs to reduce GPU kernel crashes on newer architectures."""
    if _force_cpu():
        return
    try:
        torch = _get_torch()
        if not torch.cuda.is_available():
            return
    except Exception as e:
        print(f"{Colors.YELLOW}Warning: CUDA probe failed during stability setup ({e}).{Colors.RESET}")
        return
    arch = _cuda_arch()
    try:
        arch_list = torch.cuda.get_arch_list()
    except Exception:
        arch_list = []

    if arch and arch_list and arch not in arch_list:
        _force_safe_sdpa_kernels(f"GPU arch {arch} not in PyTorch arch list ({', '.join(arch_list)})")


def restart_self_cpu_only() -> None:
    """Restart this script in CPU-only mode (fresh process, no CUDA context)."""
    if _force_cpu():
        return
    print(f"{Colors.YELLOW}Restarting in CPU-only mode to recover from CUDA failure...{Colors.RESET}")
    env = os.environ.copy()
    env["DEEPSEEK_OCR_FORCE_CPU"] = "1"
    # Hide GPUs from PyTorch so it won't touch a potentially broken CUDA context.
    env["CUDA_VISIBLE_DEVICES"] = ""
    os.execvpe(sys.executable, [sys.executable] + sys.argv, env)


def restart_self_cuda_reinit(reason: str) -> None:
    """Restart this script once to re-initialize CUDA in a fresh process."""
    if _truthy_env("DEEPSEEK_OCR_CUDA_REINIT"):
        return
    print(f"{Colors.YELLOW}Restarting once to re-initialize CUDA ({reason})...{Colors.RESET}")
    env = os.environ.copy()
    env["DEEPSEEK_OCR_CUDA_REINIT"] = "1"
    env.pop("DEEPSEEK_OCR_FORCE_CPU", None)
    # If CUDA_VISIBLE_DEVICES is empty (hides GPUs), default back to GPU 0.
    if env.get("CUDA_VISIBLE_DEVICES", "").strip() == "":
        env["CUDA_VISIBLE_DEVICES"] = "0"
    os.execvpe(sys.executable, [sys.executable] + sys.argv, env)


def _nvidia_smi_summary() -> str | None:
    """Best-effort GPU visibility info (only used when CUDA looks unavailable)."""
    try:
        out = subprocess.check_output(["nvidia-smi", "-L"], stderr=subprocess.STDOUT, text=True, timeout=5)
        out = (out or "").strip()
        return out or None
    except Exception:
        return None


def _cuda_available_with_retry(retries: int = 3, delay_s: float = 1.0) -> bool:
    """Retry CUDA availability check to handle transient init failures after long idle."""
    last: str | None = None
    for attempt in range(1, retries + 1):
        try:
            torch = _get_torch()
            if torch.cuda.is_available():
                return True
            last = "torch.cuda.is_available() returned False"
        except Exception as e:
            last = str(e)
        if attempt < retries:
            print(f"{Colors.YELLOW}CUDA not available (attempt {attempt}/{retries}: {last}); retrying...{Colors.RESET}")
            time.sleep(delay_s)
    return False

def _pick_attn_implementation(requested: str | None) -> str:
    v = (requested or os.environ.get("DEEPSEEK_OCR_ATTN_IMPLEMENTATION") or "eager").strip().lower()
    if v in ("flash", "fa2"):
        return "flash_attention_2"
    if v not in ("eager", "sdpa", "flash_attention_2"):
        return "eager"
    return v

def _from_pretrained_with_attn(model_path: str, attn_impl: str):
    """Load model with the best-supported attn kwarg.

    DeepSeek-OCR-2 docs use `_attn_implementation`; some Transformers versions prefer
    `attn_implementation`. Try both, but only fall back when the error is about an
    unsupported kwarg.
    """
    from transformers import AutoModel  # type: ignore
    try:
        return AutoModel.from_pretrained(
            model_path,
            trust_remote_code=True,
            use_safetensors=True,
            _attn_implementation=attn_impl,
        )
    except Exception as e:
        msg = str(e)
        if "_attn_implementation" not in msg and "unexpected keyword" not in msg.lower():
            raise
        return AutoModel.from_pretrained(
            model_path,
            trust_remote_code=True,
            use_safetensors=True,
            attn_implementation=attn_impl,
        )

def _load_model(model_path: str, attn_impl: str):
    from transformers import AutoTokenizer  # type: ignore
    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
    try:
        model = _from_pretrained_with_attn(model_path, attn_impl)
        return tokenizer, model
    except Exception as e:
        if attn_impl == "flash_attention_2":
            print(
                f"{Colors.YELLOW}Warning: failed to load with flash_attention_2 ({e}). "
                f"Falling back to eager attention.{Colors.RESET}"
            )
            tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
            model = _from_pretrained_with_attn(model_path, "eager")
            return tokenizer, model
        raise


def pdf_to_images_high_quality(pdf_path: str, dpi: int = 144) -> list[Image.Image]:
    """Render a PDF into a list of PIL images (one per page)."""
    import fitz  # type: ignore
    from PIL import Image  # type: ignore
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
    if _force_cpu():
        print(f"{Colors.YELLOW}CPU forced by DEEPSEEK_OCR_FORCE_CPU=1.{Colors.RESET}")
        return "cpu"

    _ensure_cuda_visible_devices_default()

    if not _cuda_available_with_retry(retries=3, delay_s=1.0):
        smi = _nvidia_smi_summary()
        if smi and not _truthy_env("DEEPSEEK_OCR_CUDA_REINIT"):
            # CUDA init can intermittently fail after long idle; a fresh process often recovers.
            restart_self_cuda_reinit("CUDA reported unavailable but nvidia-smi sees GPU(s)")
        msg = "CUDA not available; falling back to CPU"
        if smi:
            msg += f" (nvidia-smi: {smi.splitlines()[0]})"
        print(f"{Colors.YELLOW}{msg}.{Colors.RESET}")
        return "cpu"

    try:
        torch = _get_torch()
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
        args = _parse_args()
        legacy = _load_legacy_config() or {}

        model_path = (
            args.model_path
            or os.environ.get("MODEL_PATH")
            or legacy.get("MODEL_PATH")
            or DEFAULT_MODEL_ID
        )
        input_path = args.input_path or legacy.get("INPUT_PATH")
        output_path = args.output_path or legacy.get("OUTPUT_PATH")
        prompt = args.prompt or legacy.get("PROMPT") or "<image>\n<|grounding|>Convert the document to markdown."
        base_size = int(args.base_size or legacy.get("BASE_SIZE") or 1024)
        image_size = int(args.image_size or legacy.get("IMAGE_SIZE") or 768)
        crop_mode = bool(args.crop_mode if args.crop_mode is not None else legacy.get("CROP_MODE", True))
        attn_impl = _pick_attn_implementation(args.attn_implementation)
        pdf_dpi = int(args.pdf_dpi or 144)

        if not input_path or not output_path:
            print(f"{Colors.RED}Missing required arguments: --input-path and --output-path{Colors.RESET}")
            sys.exit(2)

        configure_cuda_stability()

        print(f'{Colors.BLUE}Loading DeepSeek-OCR-2 model (Hugging Face Transformers)...{Colors.RESET}')
        print(f"{Colors.BLUE}Model: {model_path}{Colors.RESET}")
        tokenizer, model = _load_model(model_path, attn_impl)

        device = pick_device()
        model = model.eval()
        if device == "cuda":
            try:
                torch = _get_torch()
                model = model.cuda().to(torch.bfloat16)
                print(f'{Colors.GREEN}Model loaded successfully on CUDA!{Colors.RESET}')
            except Exception as e:
                print(f"{Colors.YELLOW}Warning: Failed to move model to CUDA ({e}). Falling back to CPU.{Colors.RESET}")
                device = "cpu"
                torch = _get_torch()
                model = model.to("cpu").to(torch.float32)
                print(f'{Colors.GREEN}Model loaded successfully on CPU.{Colors.RESET}')
        else:
            torch = _get_torch()
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
            """Run a single-page inference. On fatal CUDA failure, restart CPU-only."""
            nonlocal device, model
            try:
                model.infer(
                    tokenizer,
                    prompt=prompt,
                    image_file=image_path,
                    output_path=out_dir,
                    base_size=base_size,
                    image_size=image_size,
                    crop_mode=crop_mode,
                    save_results=True,
                )
            except Exception as e:
                if device == "cuda" and _is_cuda_failure(e):
                    print(f"{Colors.YELLOW}CUDA inference failed ({e}).{Colors.RESET}")
                    # First, try one clean restart to re-init CUDA. If we've already tried, go CPU-only.
                    if not _truthy_env("DEEPSEEK_OCR_CUDA_RECOVERY"):
                        env = os.environ.copy()
                        env["DEEPSEEK_OCR_CUDA_RECOVERY"] = "1"
                        env.pop("DEEPSEEK_OCR_FORCE_CPU", None)
                        if env.get("CUDA_VISIBLE_DEVICES", "").strip() == "":
                            env["CUDA_VISIBLE_DEVICES"] = "0"
                        print(f"{Colors.YELLOW}Attempting one CUDA recovery restart...{Colors.RESET}")
                        os.execvpe(sys.executable, [sys.executable] + sys.argv, env)
                    restart_self_cpu_only()
                raise

        if input_path.lower().endswith(".pdf"):
            try:
                pages = pdf_to_images_high_quality(input_path, dpi=pdf_dpi)
            except Exception as e:
                print(f"{Colors.RED}Inference failed: Failed to render PDF ({e}){Colors.RESET}")
                sys.exit(1)

            combined_parts: list[str] = []
            os.makedirs(output_path, exist_ok=True)

            for idx, page_img in enumerate(pages, start=1):
                page_rel = f"pages/page_{idx:03d}"
                page_out_dir = os.path.join(output_path, page_rel)
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
                open(os.path.join(output_path, "result.mmd"), "w", encoding="utf-8").write(combined)

            print(f'{Colors.GREEN}OCR complete! Results saved to {output_path}{Colors.RESET}')
        else:
            # Fallback: treat input as an image (should not happen for PDF tasks, but keeps script robust).
            try:
                infer_once(input_path, output_path)
                print(f'{Colors.GREEN}OCR complete! Results saved to {output_path}{Colors.RESET}')
            except Exception as e:
                print(f'{Colors.RED}Inference failed: {e}{Colors.RESET}')
                sys.exit(1)

    main()
