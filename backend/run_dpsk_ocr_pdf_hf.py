import os
import sys
import torch
import warnings
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
        # If CUDA was attempted but failed, retry once on CPU.
        if device == "cuda" and _is_cuda_failure(e):
            print(f"{Colors.YELLOW}CUDA inference failed ({e}). Retrying once on CPU...{Colors.RESET}")
            try:
                model = model.to("cpu").to(torch.float32)
                device = "cpu"
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
            except Exception as e2:
                print(f'{Colors.RED}Inference failed: {e2}{Colors.RESET}')
                sys.exit(1)
        else:
            print(f'{Colors.RED}Inference failed: {e}{Colors.RESET}')
            sys.exit(1)
