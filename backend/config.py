# Auto-generated config for DeepSeek OCR
BASE_SIZE = 1024
IMAGE_SIZE = 640
CROP_MODE = True
MIN_CROPS = 2
MAX_CROPS = 6
MAX_CONCURRENCY = 10
NUM_WORKERS = 32
PRINT_NUM_VIS_TOKENS = False
SKIP_REPEAT = True

MODEL_PATH = r'/home/hansonwen/DeepSeek-OCR-Web/deepseek-ocr'
INPUT_PATH = r'/home/hansonwen/DeepSeek-OCR-Web/workspace/uploads/user_upload_20251129_145417_2e1f8489.pdf'
OUTPUT_PATH = r'/home/hansonwen/DeepSeek-OCR-Web/workspace/results/ocr_task_9533fd7d_20251129_145420_09ac5b3f'
PROMPT = """<image>
<|grounding|>Convert the document to markdown."""

from transformers import AutoTokenizer
TOKENIZER = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)