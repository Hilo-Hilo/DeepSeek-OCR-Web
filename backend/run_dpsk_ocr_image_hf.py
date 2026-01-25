import os
import sys
import torch
import warnings
from transformers import AutoModel, AutoTokenizer
from config import *
import contextlib

class Colors:
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    RESET = "\033[0m"

# Disable JIT if needed (for Blackwell compatibility)
os.environ["PYTORCH_JIT"] = "0"
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "0") # Respect outer environment, only set default

warnings.filterwarnings("ignore")

def _cuda_arch() -> str | None:
    try:
        cap = torch.cuda.get_device_capability(0)
        return f"sm_{cap[0]}{cap[1]}"
    except Exception:
        return None


def _force_safe_sdpa_kernels(reason: str) -> None:
    """Force SDPA to use math kernels (avoid flash/mem-efficient)."""
    try:
        torch.backends.cuda.enable_flash_sdp(False)
        torch.backends.cuda.enable_mem_efficient_sdp(False)
        torch.backends.cuda.enable_math_sdp(True)
        print(f"{Colors.YELLOW}SDPA set to math-only for stability ({reason}).{Colors.RESET}")
    except Exception as e:
        print(f"{Colors.YELLOW}Warning: failed to configure SDPA kernels ({e}).{Colors.RESET}")


def configure_cuda_stability() -> None:
    """Best-effort knobs to reduce GPU kernel crashes on newer architectures."""
    if not torch.cuda.is_available():
        return
    arch = _cuda_arch()
    try:
        arch_list = torch.cuda.get_arch_list()
    except Exception:
        arch_list = []

    # If this GPU arch isn't explicitly supported by this PyTorch build, prefer safer kernels.
    if arch and arch_list and arch not in arch_list:
        _force_safe_sdpa_kernels(f"GPU arch {arch} not in PyTorch arch list ({', '.join(arch_list)})")


def restart_self_cpu_only() -> None:
    """Restart this script in CPU-only mode (fresh process, no CUDA context)."""
    if os.environ.get("DEEPSEEK_OCR_FORCE_CPU", "").lower() in ("1", "true", "yes"):
        return
    print(f"{Colors.YELLOW}Restarting in CPU-only mode to recover from CUDA failure...{Colors.RESET}")
    env = os.environ.copy()
    env["DEEPSEEK_OCR_FORCE_CPU"] = "1"
    # Hide GPUs from PyTorch so it won't touch a potentially broken CUDA context.
    env["CUDA_VISIBLE_DEVICES"] = ""
    os.execvpe(sys.executable, [sys.executable] + sys.argv, env)


def pick_device() -> str:
    """Pick a safe device for inference.

    Prefer CUDA when available. Some PyTorch builds may warn that a newer SM
    (e.g. sm_121) is not explicitly listed; in practice CUDA may still work
    (e.g. via compatible cubins/PTX). We therefore only fall back to CPU when
    CUDA actually fails at runtime.
    """
    if os.environ.get("DEEPSEEK_OCR_FORCE_CPU", "").lower() in ("1", "true", "yes"):
        return "cpu"
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
    configure_cuda_stability()
    print(f'{Colors.BLUE}Loading DeepSeek OCR model (Hugging Face Transformers)...{Colors.RESET}')
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
    # Force eager attention (safer than flash kernels on new GPUs).
    model = AutoModel.from_pretrained(
        MODEL_PATH,
        trust_remote_code=True,
        use_safetensors=True,
        attn_implementation="eager",
    )
    
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

    try:
        res = model.infer(
            tokenizer,
            prompt=PROMPT,
            image_file=INPUT_PATH,
            output_path=OUTPUT_PATH,
            base_size=BASE_SIZE,
            image_size=IMAGE_SIZE,
            crop_mode=CROP_MODE,
            save_results=True,
        )
        print(f'{Colors.GREEN}OCR complete! Results saved to {OUTPUT_PATH}{Colors.RESET}')
    except Exception as e:
        # CUDA launch failures can leave the CUDA context irrecoverable; restarting CPU-only
        # avoids trying to copy tensors off a broken GPU.
        if device == "cuda" and _is_cuda_failure(e):
            print(f"{Colors.YELLOW}CUDA inference failed ({e}).{Colors.RESET}")
            restart_self_cpu_only()
        print(f'{Colors.RED}Inference failed: {e}{Colors.RESET}')
        sys.exit(1)
