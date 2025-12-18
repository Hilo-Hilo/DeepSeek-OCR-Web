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

# Disable JIT if needed (for Blackwell compatibility)
os.environ["PYTORCH_JIT"] = "0"
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "0") # Respect outer environment, only set default

warnings.filterwarnings("ignore")

def pick_device() -> str:
    """Pick a safe device for inference.

    If the current PyTorch build does not include kernels for the GPU's SM
    version (e.g. sm_121), running on CUDA will crash. In that case, prefer CPU.
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
                f"({', '.join(arch_list)}). Falling back to CPU.{Colors.RESET}"
            )
            return "cpu"
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
        model = model.cuda().to(torch.bfloat16)
        print(f'{Colors.GREEN}Model loaded successfully on CUDA!{Colors.RESET}')
    else:
        model = model.to("cpu").to(torch.float32)
        print(f'{Colors.GREEN}Model loaded successfully on CPU.{Colors.RESET}')

    print(f'{Colors.BLUE}Running OCR inference...{Colors.RESET}')
    
    try:
        res = model.infer(
            tokenizer,
            prompt=PROMPT,
            image_file=INPUT_PATH,
            output_path=OUTPUT_PATH,
            base_size=BASE_SIZE,
            image_size=IMAGE_SIZE,
            crop_mode=CROP_MODE,
            min_crops=MIN_CROPS,
            max_crops=MAX_CROPS,
            num_workers=NUM_WORKERS,
            print_num_vis_tokens=PRINT_NUM_VIS_TOKENS,
            skip_repeat=SKIP_REPEAT,
            save_results=True
        )
        print(f'{Colors.GREEN}OCR complete! Results saved to {OUTPUT_PATH}{Colors.RESET}')
    except Exception as e:
        print(f'{Colors.RED}Inference failed: {e}{Colors.RESET}')
        sys.exit(1)
