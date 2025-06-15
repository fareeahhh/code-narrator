from fastapi import FastAPI, HTTPException, Request, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Union
import torch
import transformers
from transformers import AutoTokenizer, AutoModelForCausalLM, AutoModelForSeq2SeqLM
import logging
import time
import os
import json
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Code Narrator AI Models API", 
              description="API for serving LLAMA and CodeT5 models for code analysis and enhancement")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Define request models
class TextGenerationRequest(BaseModel):
    prompt: str
    max_tokens: int = 256
    temperature: float = 0.7
    top_p: float = 0.9
    top_k: int = 50

class CodeGenerationRequest(BaseModel):
    code_snippet: str
    task: str = "complete"  # Options: "complete", "summarize", "explain", "refactor"
    target_language: Optional[str] = None  # For translation task
    max_tokens: int = 512

class FileCommentRequest(BaseModel):
    repo_url: str
    file_path: Optional[str] = None
    
# Model configurations
MODEL_CONFIG = {
    "llama": {
        "model_path": os.environ.get("LLAMA_MODEL_PATH", "./models/llama"),
        "tokenizer_class": AutoTokenizer,
        "model_class": AutoModelForCausalLM,
        "load_8bit": True,
        "device_map": "auto"
    },
    "code_t5": {
        "model_path": os.environ.get("CODET5_MODEL_PATH", "./models/code_t5"),
        "tokenizer_class": AutoTokenizer,
        "model_class": AutoModelForSeq2SeqLM,
        "load_8bit": False,
        "device_map": "auto"
    }
}

# Global variables to store models
models = {}
tokenizers = {}

# Load model function
def load_model(model_type):
    """Load a model of the specified type"""
    logger.info(f"Loading {model_type} model...")
    
    if model_type not in MODEL_CONFIG:
        raise ValueError(f"Unknown model type: {model_type}")
    
    config = MODEL_CONFIG[model_type]
    
    try:
        # Load tokenizer
        tokenizer = config["tokenizer_class"].from_pretrained(config["model_path"])
        tokenizers[model_type] = tokenizer
        
        # Load model
        model_args = {
            "torch_dtype": torch.float16,
            "device_map": config["device_map"]
        }
        
        # Add 8-bit loading if specified
        if config.get("load_8bit", False):
            model_args["load_in_8bit"] = True
            
        model = config["model_class"].from_pretrained(config["model_path"], **model_args)
        
        # Store the model
        models[model_type] = model
        logger.info(f"{model_type} model loaded successfully")
        
    except Exception as e:
        logger.error(f"Failed to load {model_type} model: {e}")
        raise

@app.on_event("startup")
async def startup_event():
    """Load all models on startup"""
    for model_type in MODEL_CONFIG.keys():
        load_model(model_type)

# Health check endpoint
@app.get("/health")
async def health_check():
    """Check if the API and models are ready"""
    status = {
        "api_status": "ok",
        "models": {
            model_type: "loaded" if model_type in models else "not_loaded"
            for model_type in MODEL_CONFIG.keys()
        }
    }
    return status

# LLAMA model inference endpoint
@app.post("/api/generate")
async def generate_text(request: TextGenerationRequest):
    """Generate text using the LLAMA model"""
    if "llama" not in models:
        raise HTTPException(status_code=503, detail="LLAMA model not loaded")
    
    try:
        logger.info(f"Processing text generation with prompt length: {len(request.prompt)}")
        start_time = time.time()
        
        model = models["llama"]
        tokenizer = tokenizers["llama"]
        
        # Tokenize input
        inputs = tokenizer(request.prompt, return_tensors="pt").to(model.device)
        
        # Generate text
        with torch.no_grad():
            outputs = model.generate(
                inputs.input_ids,
                max_new_tokens=request.max_tokens,
                temperature=request.temperature,
                top_p=request.top_p,
                top_k=request.top_k,
                do_sample=request.temperature > 0.0,
                pad_token_id=tokenizer.eos_token_id
            )
        
        # Decode the generated tokens
        generated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)
        response_text = generated_text[len(tokenizer.decode(inputs.input_ids[0], skip_special_tokens=True)):]
        
        processing_time = time.time() - start_time
        logger.info(f"Text generation completed in {processing_time:.2f}s")
        
        return {
            "generated_text": response_text,
            "processing_time": processing_time
        }
    except Exception as e:
        logger.error(f"Error in text generation: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Text generation failed: {str(e)}")

# CodeT5 model inference endpoint
@app.post("/api/code")
async def process_code(request: CodeGenerationRequest):
    """Process code using the CodeT5 model"""
    if "code_t5" not in models:
        raise HTTPException(status_code=503, detail="CodeT5 model not loaded")
    
    try:
        logger.info(f"Processing code for task: {request.task}")
        start_time = time.time()
        
        model = models["code_t5"]
        tokenizer = tokenizers["code_t5"]
        
        # Create task-specific prompt
        prompt = request.code_snippet
        
        if request.task == "translate":
            if not request.target_language:
                raise HTTPException(status_code=400, detail="Target language is required for translation task")
            prompt = f"Translate the following code to {request.target_language}: {request.code_snippet}"
        
        elif request.task == "summarize":
            prompt = f"Summarize the following code: {request.code_snippet}"
        
        elif request.task == "explain":
            prompt = f"Explain the following code: {request.code_snippet}"
        
        elif request.task == "refactor":
            prompt = f"Refactor the following code: {request.code_snippet}"
        
        elif request.task != "complete":
            raise HTTPException(status_code=400, detail=f"Unsupported task: {request.task}")
        
        # Tokenize input
        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
        
        # Generate code
        with torch.no_grad():
            outputs = model.generate(
                inputs.input_ids,
                max_length=inputs.input_ids.shape[1] + request.max_tokens,
                do_sample=True,
                temperature=0.7,
                top_p=0.95
            )
        
        # Decode the generated tokens
        generated_code = tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        processing_time = time.time() - start_time
        logger.info(f"Code processing completed in {processing_time:.2f}s")
        
        return {
            "generated_code": generated_code,
            "task": request.task,
            "processing_time": processing_time
        }
    except Exception as e:
        logger.error(f"Error in code processing: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Code processing failed: {str(e)}")

# Generate comments for repository files using CodeT5
@app.post("/api/generate-comments-ai")
async def generate_comments_ai(request: FileCommentRequest):
    """Generate code comments for a specific file in a repository using CodeT5"""
    if "code_t5" not in models:
        raise HTTPException(status_code=503, detail="CodeT5 model not loaded")
    
    try:
        logger.info(f"Generating comments for repo: {request.repo_url}, file: {request.file_path or 'all'}")
        
        # Here we would normally fetch the code from GitHub
        # For this example, we'll assume the code is already available or
        # use the existing functionality in your app.js
        
        # You should integrate with your existing Python scripts that fetch code files
        # For now, we'll use a mock implementation
        
        model = models["code_t5"]
        tokenizer = tokenizers["code_t5"]
        
        # Mock code content - in practice, fetch from GitHub
        code_content = "def example_function(x, y):\n    return x + y"
        
        # Prepare the prompt for code commenting
        prompt = f"Add explanatory comments to the following code:\n\n{code_content}"
        
        # Tokenize input
        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
        
        # Generate commented code
        with torch.no_grad():
            outputs = model.generate(
                inputs.input_ids,
                max_length=inputs.input_ids.shape[1] + 512,
                do_sample=True,
                temperature=0.7,
                top_p=0.95
            )
        
        # Decode the generated tokens
        commented_code = tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        # In practice, you would store this to a file like in your existing app
        # For now, we'll just return it
        
        return {
            "commented_code": commented_code,
            "filename": request.file_path.split("/")[-1] if request.file_path else "example.py",
            "originalPath": request.file_path or "unknown"
        }
    except Exception as e:
        logger.error(f"Error generating comments: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Comment generation failed: {str(e)}")

# Integration with existing endpoints for form-based submission
@app.post("/generate-comments")
async def generate_comments_form(
    repo_url: str = Form(...), 
    file_path: Optional[str] = Form(None)
):
    """Form-compatible version of the generate-comments endpoint"""
    request = FileCommentRequest(repo_url=repo_url, file_path=file_path)
    return await generate_comments_ai(request)

# Integration with your existing README generation
@app.post("/generate-readme-ai")
async def generate_readme_ai(repo_url: str = Form(...)):
    """Generate a README for a repository using LLAMA model"""
    if "llama" not in models:
        raise HTTPException(status_code=503, detail="LLAMA model not loaded")
    
    try:
        logger.info(f"Generating AI README for repo: {repo_url}")
        
        # Here we would fetch repository info
        # For this example, we'll use a mock implementation
        repo_name = repo_url.split("/")[-1]
        
        # Prepare a prompt for README generation
        prompt = f"""Create a comprehensive README.md for a GitHub repository named {repo_name}.
        The README should include:
        1. A title and description
        2. Installation instructions
        3. Usage examples
        4. Features list
        5. Contribution guidelines
        """
        
        model = models["llama"]
        tokenizer = tokenizers["llama"]
        
        # Tokenize input
        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
        
        # Generate README
        with torch.no_grad():
            outputs = model.generate(
                inputs.input_ids,
                max_new_tokens=1024,
                temperature=0.7,
                top_p=0.9,
                do_sample=True,
                pad_token_id=tokenizer.eos_token_id
            )
        
        # Decode the generated tokens
        readme_content = tokenizer.decode(outputs[0], skip_special_tokens=True)
        readme_content = readme_content[len(tokenizer.decode(inputs.input_ids[0], skip_special_tokens=True)):]
        
        # In a real implementation, you might save this to a file
        
        return {
            "readme": readme_content,
            "type": "ai-generated"
        }
    except Exception as e:
        logger.error(f"Error generating README: {str(e)}")
        raise HTTPException(status_code=500, detail=f"README generation failed: {str(e)}")

# Mount your existing static files if needed
try:
    app.mount("/static", StaticFiles(directory="static"), name="static")
    logger.info("Static files mounted successfully")
except Exception as e:
    logger.warning(f"Could not mount static files: {e}")

# Default route to serve your UI
@app.get("/")
async def serve_ui():
    """Redirect to the UI or serve the index page"""
    # In production, you might configure this differently
    return {"message": "API is running. Access the UI at your frontend URL."}

# Run the application
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 3001))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)