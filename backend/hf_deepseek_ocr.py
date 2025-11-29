"""
hf_deepseek_ocr.py
------------------
Hugging Face Transformers-based DeepSeek OCR model wrapper.
This replaces vLLM for inference on systems where vLLM is incompatible.
"""

import math
import torch
import torch.nn as nn
from typing import List, Optional, Tuple
from PIL import Image
from addict import Dict

from transformers import AutoModelForCausalLM, AutoTokenizer
from deepencoder.sam_vary_sdpa import build_sam_vit_b
from deepencoder.clip_sdpa import build_clip_l
from deepencoder.build_linear import MlpProjector
from process.image_process import DeepseekOCRProcessor
from config import IMAGE_SIZE, BASE_SIZE, CROP_MODE, PRINT_NUM_VIS_TOKENS


class HFDeepseekOCR(nn.Module):
    """
    Hugging Face Transformers-based DeepSeek OCR model.
    Loads the vision encoders and language model separately for inference.
    """
    
    def __init__(self, model_path: str, device: str = "cuda", dtype: torch.dtype = torch.bfloat16):
        super().__init__()
        
        self.device = device
        self.dtype = dtype
        self.model_path = model_path
        
        print(f"🔄 Loading DeepSeek OCR model from {model_path}...")
        
        # Load tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
        self.image_token = "<image>"
        self.image_token_id = self.tokenizer.vocab.get(self.image_token)
        
        # Load vision encoders
        print("  📷 Loading SAM vision encoder...")
        self.sam_model = build_sam_vit_b()
        
        print("  📷 Loading CLIP vision encoder...")
        self.vision_model = build_clip_l()
        
        # Load projector
        n_embed = 1280
        self.projector = MlpProjector(Dict(projector_type="linear", input_dim=2048, n_embed=n_embed))
        
        # Special tokens for image formatting
        embed_std = 1 / torch.sqrt(torch.tensor(n_embed, dtype=torch.float32))
        self.image_newline = nn.Parameter(torch.randn(n_embed) * embed_std)
        self.view_seperator = nn.Parameter(torch.randn(n_embed) * embed_std)
        
        # Load language model using the model's custom class
        print("  🧠 Loading language model...")
        import sys
        sys.path.insert(0, model_path)
        
        try:
            # Try loading with trust_remote_code which should use the model's custom class
            from transformers import AutoModel
            self.language_model = AutoModel.from_pretrained(
                model_path,
                torch_dtype=dtype,
                trust_remote_code=True,
                device_map="auto",
            )
        except Exception as e:
            print(f"  ⚠️ AutoModel failed: {e}")
            # Fallback: try loading just the language component
            try:
                from transformers import AutoModelForCausalLM as AMFC
                # Load only the language config
                import json
                with open(f"{model_path}/config.json") as f:
                    config = json.load(f)
                lang_config = config.get("language_config", {})
                
                # This model uses DeepseekV2 as the language backbone
                from transformers import AutoConfig
                self.language_model = AMFC.from_pretrained(
                    model_path,
                    torch_dtype=dtype,
                    trust_remote_code=True,
                    device_map="auto",
                    ignore_mismatched_sizes=True,
                )
            except Exception as e2:
                print(f"  ❌ Language model loading failed: {e2}")
                raise RuntimeError(f"Could not load language model: {e2}")
        
        # Load vision weights from the checkpoint
        self._load_vision_weights(model_path)
        
        # Move vision components to device
        self.sam_model = self.sam_model.to(device=device, dtype=dtype)
        self.vision_model = self.vision_model.to(device=device, dtype=dtype)
        self.projector = self.projector.to(device=device, dtype=dtype)
        self.image_newline = nn.Parameter(self.image_newline.to(device=device, dtype=dtype))
        self.view_seperator = nn.Parameter(self.view_seperator.to(device=device, dtype=dtype))
        
        # Set to eval mode
        self.eval()
        
        print("✅ Model loaded successfully!")
    
    def _load_vision_weights(self, model_path: str):
        """Load vision encoder weights from the model checkpoint."""
        import os
        import glob
        
        # Find safetensors or bin files
        safetensor_files = glob.glob(os.path.join(model_path, "*.safetensors"))
        bin_files = glob.glob(os.path.join(model_path, "*.bin"))
        
        if safetensor_files:
            from safetensors.torch import load_file
            state_dict = {}
            for f in safetensor_files:
                state_dict.update(load_file(f))
        elif bin_files:
            state_dict = {}
            for f in bin_files:
                state_dict.update(torch.load(f, map_location="cpu"))
        else:
            print("  ⚠️ No checkpoint files found, using randomly initialized vision weights")
            return
        
        # Extract and load SAM weights
        sam_state = {k.replace("model.sam_model.", ""): v for k, v in state_dict.items() if "sam_model" in k}
        if sam_state:
            self.sam_model.load_state_dict(sam_state, strict=False)
            print(f"  ✅ Loaded {len(sam_state)} SAM weights")
        
        # Extract and load CLIP weights
        clip_state = {k.replace("model.vision_model.", ""): v for k, v in state_dict.items() if "vision_model" in k}
        if clip_state:
            self.vision_model.load_state_dict(clip_state, strict=False)
            print(f"  ✅ Loaded {len(clip_state)} CLIP weights")
        
        # Extract and load projector weights
        proj_state = {k.replace("model.projector.", ""): v for k, v in state_dict.items() if "projector" in k and "vision" not in k}
        if proj_state:
            self.projector.load_state_dict(proj_state, strict=False)
            print(f"  ✅ Loaded {len(proj_state)} projector weights")
        
        # Load special tokens
        if "model.image_newline" in state_dict:
            self.image_newline = nn.Parameter(state_dict["model.image_newline"])
        if "model.view_seperator" in state_dict:
            self.view_seperator = nn.Parameter(state_dict["model.view_seperator"])
    
    @torch.no_grad()
    def encode_images(
        self,
        pixel_values: torch.Tensor,
        images_crop: torch.Tensor,
        images_spatial_crop: torch.Tensor,
    ) -> List[torch.Tensor]:
        """
        Encode images using vision encoders.
        
        Args:
            pixel_values: Global view images [n_images, 3, H, W]
            images_crop: Local crop images [n_images, n_crops, 3, h, w]
            images_spatial_crop: Crop grid info [n_images, 2]
        
        Returns:
            List of image embeddings
        """
        images_in_this_batch = []
        n_embed = self.projector.cfg.n_embed
        
        for jdx in range(images_spatial_crop.size(0)):
            # images_crop shape: [batch, n_crops, 3, h, w] or [batch, 1, n_crops, 3, h, w]
            # We need patches as [n_crops, 3, h, w]
            if images_crop.dim() == 5:
                patches = images_crop[jdx].to(self.dtype).to(self.device)  # [n_crops, 3, h, w]
            else:
                patches = images_crop[jdx][0].to(self.dtype).to(self.device)  # Handle nested case
            
            # pixel_values shape: [batch, 1, 3, H, W] or [batch, 3, H, W]
            if pixel_values.dim() == 5:
                image_ori = pixel_values[jdx].to(self.dtype).to(self.device)  # [1, 3, H, W]
            else:
                image_ori = pixel_values[jdx].unsqueeze(0).to(self.dtype).to(self.device)  # Add batch dim
            
            # images_spatial_crop shape: [batch, 1, 2] or [batch, 2]
            if images_spatial_crop.dim() == 3:
                crop_shape = images_spatial_crop[jdx][0]  # [2]
            else:
                crop_shape = images_spatial_crop[jdx]  # [2]
            
            if torch.sum(patches).item() != 0:  # Has crops
                # Process local patches
                local_features_1 = self.sam_model(patches)
                local_features_2 = self.vision_model(patches, local_features_1)
                local_features = torch.cat(
                    (local_features_2[:, 1:], local_features_1.flatten(2).permute(0, 2, 1)), 
                    dim=-1
                )
                local_features = self.projector(local_features)
                
                # Process global view
                global_features_1 = self.sam_model(image_ori)
                global_features_2 = self.vision_model(image_ori, global_features_1)
                global_features = torch.cat(
                    (global_features_2[:, 1:], global_features_1.flatten(2).permute(0, 2, 1)), 
                    dim=-1
                )
                global_features = self.projector(global_features)
                
                if PRINT_NUM_VIS_TOKENS:
                    print('=====================')
                    print('BASE: ', global_features.shape)
                    print('PATCHES: ', local_features.shape)
                    print('=====================')
                
                _, hw, n_dim = global_features.shape
                h = w = int(hw ** 0.5)
                
                _, hw2, n_dim2 = local_features.shape
                h2 = w2 = int(hw2 ** 0.5)
                
                width_crop_num, height_crop_num = crop_shape[0].item(), crop_shape[1].item()
                
                # Format global features with newlines
                global_features = global_features.view(h, w, n_dim)
                global_features = torch.cat(
                    [global_features, self.image_newline[None, None, :].expand(h, 1, n_dim)], 
                    dim=1
                )
                global_features = global_features.view(-1, n_dim)
                
                # Format local features with newlines
                local_features = local_features.view(
                    height_crop_num, width_crop_num, h2, w2, n_dim2
                ).permute(0, 2, 1, 3, 4).reshape(height_crop_num * h2, width_crop_num * w2, n_dim2)
                local_features = torch.cat(
                    [local_features, self.image_newline[None, None, :].expand(height_crop_num * h2, 1, n_dim2)], 
                    dim=1
                )
                local_features = local_features.view(-1, n_dim2)
                
                # Combine local + global + separator
                global_local_features = torch.cat(
                    [local_features, global_features, self.view_seperator[None, :]], 
                    dim=0
                )
            else:
                # No crops, only global view
                global_features_1 = self.sam_model(image_ori)
                global_features_2 = self.vision_model(image_ori, global_features_1)
                global_features = torch.cat(
                    (global_features_2[:, 1:], global_features_1.flatten(2).permute(0, 2, 1)), 
                    dim=-1
                )
                global_features = self.projector(global_features)
                
                if PRINT_NUM_VIS_TOKENS:
                    print('=====================')
                    print('BASE: ', global_features.shape)
                    print('NO PATCHES')
                    print('=====================')
                
                _, hw, n_dim = global_features.shape
                h = w = int(hw ** 0.5)
                
                global_features = global_features.view(h, w, n_dim)
                global_features = torch.cat(
                    [global_features, self.image_newline[None, None, :].expand(h, 1, n_dim)], 
                    dim=1
                )
                global_features = global_features.view(-1, n_dim)
                
                global_local_features = torch.cat(
                    [global_features, self.view_seperator[None, :]], 
                    dim=0
                )
            
            images_in_this_batch.append(global_local_features)
        
        return images_in_this_batch
    
    def get_input_embeddings(
        self,
        input_ids: torch.Tensor,
        image_embeddings: Optional[List[torch.Tensor]] = None,
    ) -> torch.Tensor:
        """
        Get input embeddings, merging image embeddings at <image> token positions.
        """
        # Get text embeddings
        inputs_embeds = self.language_model.get_input_embeddings()(input_ids)
        
        if image_embeddings is not None and len(image_embeddings) > 0:
            # Find image token positions and merge
            batch_size = input_ids.shape[0]
            
            for batch_idx in range(batch_size):
                image_mask = input_ids[batch_idx] == self.image_token_id
                image_positions = torch.where(image_mask)[0]
                
                if len(image_positions) > 0 and batch_idx < len(image_embeddings):
                    img_embed = image_embeddings[batch_idx]
                    
                    # Replace image tokens with image embeddings
                    num_image_tokens = len(image_positions)
                    if num_image_tokens == img_embed.shape[0]:
                        inputs_embeds[batch_idx, image_positions] = img_embed
                    else:
                        # Handle mismatch - expand embeddings
                        start_pos = image_positions[0].item()
                        end_pos = image_positions[-1].item() + 1
                        
                        # Create new embeddings tensor
                        new_seq_len = inputs_embeds.shape[1] - num_image_tokens + img_embed.shape[0]
                        new_embeds = torch.zeros(
                            (new_seq_len, inputs_embeds.shape[2]),
                            dtype=inputs_embeds.dtype,
                            device=inputs_embeds.device
                        )
                        
                        # Copy before image tokens
                        new_embeds[:start_pos] = inputs_embeds[batch_idx, :start_pos]
                        # Insert image embeddings
                        new_embeds[start_pos:start_pos + img_embed.shape[0]] = img_embed
                        # Copy after image tokens
                        new_embeds[start_pos + img_embed.shape[0]:] = inputs_embeds[batch_idx, end_pos:]
                        
                        inputs_embeds = new_embeds.unsqueeze(0)
        
        return inputs_embeds
    
    @torch.no_grad()
    def generate(
        self,
        images: List[Image.Image],
        prompt: str,
        max_new_tokens: int = 8192,
        temperature: float = 0.0,
        do_sample: bool = False,
        **kwargs
    ) -> str:
        """
        Generate OCR output for images.
        
        Args:
            images: List of PIL images
            prompt: The prompt text (should contain <image> token)
            max_new_tokens: Maximum tokens to generate
            temperature: Sampling temperature (0 for greedy)
            do_sample: Whether to sample
        
        Returns:
            Generated text
        """
        # Process images using the processor
        processor = DeepseekOCRProcessor()
        image_data = processor.tokenize_with_images(
            images=images,
            bos=True,
            eos=True,
            cropping=CROP_MODE
        )
        
        # Unpack processed data
        input_ids, pixel_values, images_crop, images_seq_mask, images_spatial_crop, num_image_tokens, _ = image_data[0]
        
        # Move to device
        input_ids = input_ids.to(self.device)
        pixel_values = pixel_values.unsqueeze(0).to(self.device)
        images_crop = images_crop.to(self.device)
        images_spatial_crop = images_spatial_crop.unsqueeze(0).to(self.device)
        
        # Encode images
        image_embeddings = self.encode_images(pixel_values, images_crop, images_spatial_crop)
        
        # Get input embeddings with images merged
        inputs_embeds = self.get_input_embeddings(input_ids, image_embeddings)
        
        # Generate
        generation_config = {
            "max_new_tokens": max_new_tokens,
            "do_sample": do_sample,
            "pad_token_id": self.tokenizer.pad_token_id,
            "eos_token_id": self.tokenizer.eos_token_id,
        }
        
        if temperature > 0:
            generation_config["temperature"] = temperature
            generation_config["do_sample"] = True
        
        # Use inputs_embeds for generation
        outputs = self.language_model.generate(
            inputs_embeds=inputs_embeds,
            **generation_config
        )
        
        # Decode output
        generated_text = self.tokenizer.decode(outputs[0], skip_special_tokens=False)
        
        return generated_text
    
    @torch.no_grad()
    def generate_batch(
        self,
        batch_inputs: List[dict],
        max_new_tokens: int = 8192,
        temperature: float = 0.0,
    ) -> List[str]:
        """
        Generate OCR output for a batch of inputs.
        
        Args:
            batch_inputs: List of dicts with 'prompt' and 'multi_modal_data'
            max_new_tokens: Maximum tokens to generate
            temperature: Sampling temperature
        
        Returns:
            List of generated texts
        """
        results = []
        
        for batch_item in batch_inputs:
            # Extract data from batch item
            image_data = batch_item.get("multi_modal_data", {}).get("image", None)
            
            if image_data is None:
                results.append("")
                continue
            
            # Unpack processed data
            input_ids, pixel_values, images_crop, images_seq_mask, images_spatial_crop, num_image_tokens, _ = image_data[0]
            
            # Move to device
            input_ids = input_ids.to(self.device)
            pixel_values = pixel_values.unsqueeze(0).to(self.device)
            images_crop = images_crop.to(self.device)
            images_spatial_crop = images_spatial_crop.unsqueeze(0).to(self.device)
            
            # Encode images
            image_embeddings = self.encode_images(pixel_values, images_crop, images_spatial_crop)
            
            # Get input embeddings with images merged
            inputs_embeds = self.get_input_embeddings(input_ids, image_embeddings)
            
            # Generate
            generation_config = {
                "max_new_tokens": max_new_tokens,
                "do_sample": temperature > 0,
                "pad_token_id": self.tokenizer.pad_token_id,
                "eos_token_id": self.tokenizer.eos_token_id,
            }
            
            if temperature > 0:
                generation_config["temperature"] = temperature
            
            outputs = self.language_model.generate(
                inputs_embeds=inputs_embeds,
                **generation_config
            )
            
            generated_text = self.tokenizer.decode(outputs[0], skip_special_tokens=False)
            results.append(generated_text)
        
        return results


# Simple output wrapper to match vLLM's output format
class HFOutput:
    """Wrapper to match vLLM's output format."""
    def __init__(self, text: str):
        self.outputs = [HFOutputItem(text)]


class HFOutputItem:
    """Single output item."""
    def __init__(self, text: str):
        self.text = text

