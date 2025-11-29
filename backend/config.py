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
INPUT_PATH = r'/home/hansonwen/DeepSeek-OCR-Web/workspace/uploads/user_upload_20251128_215536_801d622d.pdf'
OUTPUT_PATH = r'/home/hansonwen/DeepSeek-OCR-Web/workspace/results/ocr_task_7ce26ba1_20251128_215538_7ed1d3aa'
PROMPT = """<image>
<|grounding|>Convert the document to markdown."""

from transformers import AutoTokenizer
TOKENIZER = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)