"""
run_dpsk_ocr_image_hf.py
------------------------
Image OCR using Hugging Face Transformers (no vLLM dependency).
Uses the official model.infer() method from DeepSeek-OCR.
https://github.com/deepseek-ai/DeepSeek-OCR
"""

import os

# Disable JIT compilation for Blackwell GPU compatibility
os.environ["PYTORCH_JIT"] = "0"
# Respect outer environment (docker-compose / subprocess env). Only set a default.
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "0")

import torch

# Suppress dynamo errors
torch._dynamo.config.suppress_errors = True

from transformers import AutoModel, AutoTokenizer
from config import MODEL_PATH, INPUT_PATH, OUTPUT_PATH, PROMPT


class Colors:
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    RESET = '\033[0m'


def ensure_cuda_supported() -> None:
    """DeepSeek-OCR's `model.infer()` uses CUDA tensors internally.

    CPU-only execution is not supported; make failures explicit and actionable.
    """
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available. DeepSeek-OCR infer() requires a CUDA-capable PyTorch build.")

    # Some platforms (e.g. GB10 sm_121) may not appear in torch.cuda.get_arch_list()
    # even though CUDA ops work via PTX/JIT. Run a tiny smoke test instead.
    cap = torch.cuda.get_device_capability(0)
    arch = f"sm_{cap[0]}{cap[1]}"
    arch_list = torch.cuda.get_arch_list()
    if arch not in arch_list:
        print(
            f"{Colors.YELLOW}⚠️  GPU arch {arch} not explicitly listed in this PyTorch build "
            f"({', '.join(arch_list)}). Verifying CUDA works with a quick smoke test...{Colors.RESET}"
        )

    try:
        x = torch.zeros((1,), device="cuda")
        torch.cuda.synchronize()
        _ = x.item()
    except Exception as e:
        raise RuntimeError(f"CUDA smoke test failed: {e}") from e


# Initialize model globally using official method
ensure_cuda_supported()
print(f'{Colors.BLUE}Loading DeepSeek OCR model (Hugging Face Transformers)...{Colors.RESET}')
tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
model = AutoModel.from_pretrained(MODEL_PATH, trust_remote_code=True, use_safetensors=True)
model = model.eval().cuda().to(torch.bfloat16)
print(f'{Colors.GREEN}✅ Model loaded successfully on CUDA!{Colors.RESET}')


if __name__ == "__main__":
    os.makedirs(OUTPUT_PATH, exist_ok=True)
    os.makedirs(f'{OUTPUT_PATH}/images', exist_ok=True)
    
    print(f'{Colors.RED}Loading image: {INPUT_PATH}{Colors.RESET}')
    
    # Run inference using official method
    print(f'{Colors.GREEN}Running OCR inference...{Colors.RESET}')
    
    try:
        result = model.infer(
            tokenizer,
            prompt=PROMPT,
            image_file=INPUT_PATH,
            output_path=OUTPUT_PATH,
            base_size=1024,
            image_size=640,
            crop_mode=True,
            save_results=True,
            test_compress=False
        )
        
        print(f'{Colors.GREEN}✅ OCR complete! Results saved to {OUTPUT_PATH}{Colors.RESET}')
        
    except Exception as e:
        print(f"{Colors.RED}Error: {e}{Colors.RESET}")
        import traceback
        traceback.print_exc()
