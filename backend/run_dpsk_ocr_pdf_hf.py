"""
run_dpsk_ocr_pdf_hf.py
----------------------
PDF OCR using Hugging Face Transformers (no vLLM dependency).
Uses the official model.infer() method from DeepSeek-OCR.
https://github.com/deepseek-ai/DeepSeek-OCR
"""

import os

# Disable JIT compilation for Blackwell GPU compatibility
os.environ["PYTORCH_JIT"] = "0"
os.environ["CUDA_VISIBLE_DEVICES"] = '0'

import fitz
import io
import torch
from tqdm import tqdm
from PIL import Image

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


# Initialize model globally using official method
print(f'{Colors.BLUE}Loading DeepSeek OCR model (Hugging Face Transformers)...{Colors.RESET}')
tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
model = AutoModel.from_pretrained(MODEL_PATH, trust_remote_code=True, use_safetensors=True)
model = model.eval().cuda().to(torch.bfloat16)
print(f'{Colors.GREEN}✅ Model loaded successfully!{Colors.RESET}')


def pdf_to_images_high_quality(pdf_path, dpi=144):
    """Convert PDF to high-quality images."""
    images = []
    pdf_document = fitz.open(pdf_path)
    
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    
    for page_num in range(pdf_document.page_count):
        page = pdf_document[page_num]
        pixmap = page.get_pixmap(matrix=matrix, alpha=False)
        Image.MAX_IMAGE_PIXELS = None
        img_data = pixmap.tobytes("png")
        img = Image.open(io.BytesIO(img_data))
        images.append(img)
    
    pdf_document.close()
    return images


if __name__ == "__main__":
    os.makedirs(OUTPUT_PATH, exist_ok=True)
    os.makedirs(f'{OUTPUT_PATH}/images', exist_ok=True)
    
    print(f'{Colors.RED}PDF loading .....{Colors.RESET}')
    images = pdf_to_images_high_quality(INPUT_PATH)
    print(f'{Colors.YELLOW}Loaded {len(images)} pages{Colors.RESET}')
    
    # Process each page
    print(f'{Colors.GREEN}Running OCR inference...{Colors.RESET}')
    all_results = []
    
    for idx, img in enumerate(tqdm(images, desc="OCR inference")):
        try:
            # Save image temporarily
            temp_img_path = f'/tmp/ocr_page_{idx}.jpg'
            img.save(temp_img_path)
            
            # Run inference using official method
            result = model.infer(
                tokenizer,
                prompt=PROMPT,
                image_file=temp_img_path,
                output_path=OUTPUT_PATH,
                base_size=1024,
                image_size=640,
                crop_mode=True,
                save_results=False,
                test_compress=False
            )
            
            # The infer method prints output but returns None when save_results=False
            # We need to capture the output differently
            # For now, just run with save_results=True for the last page to get the format
            
            all_results.append(result if result else "")
            
            # Clean up temp file
            os.remove(temp_img_path)
            
        except Exception as e:
            print(f"{Colors.RED}Error processing page {idx + 1}: {e}{Colors.RESET}")
            all_results.append("")
    
    # For multi-page PDFs, run each page and save results
    print(f'{Colors.BLUE}Processing complete. Running final save...{Colors.RESET}')
    
    # Process all pages and combine results
    mmd_path = OUTPUT_PATH + '/' + INPUT_PATH.split('/')[-1].replace('.pdf', '.mmd')
    
    contents = ''
    for idx, img in enumerate(tqdm(images, desc="Saving results")):
        temp_img_path = f'/tmp/ocr_final_{idx}.jpg'
        img.save(temp_img_path)
        
        try:
            # Run with save_results to get proper output
            page_output_path = f'{OUTPUT_PATH}/page_{idx}'
            os.makedirs(page_output_path, exist_ok=True)
            
            model.infer(
                tokenizer,
                prompt=PROMPT,
                image_file=temp_img_path,
                output_path=page_output_path,
                base_size=1024,
                image_size=640,
                crop_mode=True,
                save_results=True,
                test_compress=False
            )
            
            # Read the result
            result_file = f'{page_output_path}/result.mmd'
            if os.path.exists(result_file):
                with open(result_file, 'r') as f:
                    page_content = f.read()
                contents += page_content + f'\n\n<--- Page {idx + 1} --->\n\n'
        except Exception as e:
            print(f"{Colors.RED}Error saving page {idx + 1}: {e}{Colors.RESET}")
        
        os.remove(temp_img_path)
    
    # Save combined results
    with open(mmd_path, 'w', encoding='utf-8') as f:
        f.write(contents)
    
    print(f'{Colors.GREEN}✅ OCR complete! Results saved to {OUTPUT_PATH}{Colors.RESET}')
