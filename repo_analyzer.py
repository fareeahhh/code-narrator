#!/usr/bin/env python3
import os
import re
import ast
import json
import tempfile
import shutil
import argparse
from git import Repo
from typing import Dict, List, Tuple, Any
import torch
from transformers import T5ForConditionalGeneration, AutoTokenizer

class GitHubPythonAnalyzer:
    """Analyzes a GitHub repository and extracts function definitions from Python files."""
    
    def __init__(self, repo_url: str, use_finetuned: bool = True):
        """
        Initialize the analyzer with a GitHub repository URL.
        
        Args:
            repo_url: URL to the GitHub repository
            use_finetuned: Whether to use the personally fine-tuned model
        """
        self.repo_url = repo_url
        self.use_finetuned = use_finetuned
        
        # Get repository name from URL for file naming
        self.repo_name = repo_url.split('/')[-1]
        
        # Define output directories
        self.repo_analysis_dir = os.path.join(os.getcwd(), "REPO_ANALYSIS_FOLDER")
        self.function_summaries_dir = os.path.join(os.getcwd(), "FUNCTION_SUMMARIES_FOLDER")
        
        # Create output directories if they don't exist
        os.makedirs(self.repo_analysis_dir, exist_ok=True)
        os.makedirs(self.function_summaries_dir, exist_ok=True)
        
        # Define output file paths
        self.output_file = os.path.join(self.repo_analysis_dir, f"{self.repo_name}.json")
        self.model_output_file = os.path.join(self.function_summaries_dir, f"{self.repo_name}.json")
        
        # Always use Downloads directory
        self.clone_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
        self.temp_dir = None
        self.analysis_results = {}
        self.model_results = {}
        
        # Path to fine-tuned model
        self.finetuned_model_path = os.path.join(os.path.expanduser('~'), 'Documents', '7th Semester', 'FYP', 
                                              'Sample-App-FYP', 'code-summarization-lora-manual')
        
        # Initialize CodeT5 model
        try:
            if self.use_finetuned and os.path.exists(self.finetuned_model_path):
                print(f"Loading personally fine-tuned CodeT5 model from {self.finetuned_model_path}...")
                self.tokenizer = AutoTokenizer.from_pretrained("Salesforce/codet5-base")
                self.model = T5ForConditionalGeneration.from_pretrained("Salesforce/codet5-base-multi-sum")
                print("Fine-tuned CodeT5 model loaded successfully")
            else:
                print("Loading CodeT5 model for function summarization...")
                # Use correct tokenizer for CodeT5
                self.tokenizer = AutoTokenizer.from_pretrained("Salesforce/codet5-base")
                self.model = T5ForConditionalGeneration.from_pretrained("Salesforce/codet5-base-multi-sum")
                print("CodeT5 model loaded successfully")
        except Exception as e:
            print(f"Error: Could not load CodeT5 model: {str(e)}")
            print("Please install the required dependencies with:")
            print("pip install transformers torch sentencepiece protobuf")
            raise SystemExit("Model initialization failed. Exiting program.")
    
    def clone_repository(self) -> str:
        """
        Clone the repository to the specified directory or a temporary directory.
        If the directory already exists, use it instead of cloning again.
        
        Returns:
            Path to the cloned repository
        """
        print(f"Setting up repository: {self.repo_url}")
        
        # Get repository name from URL
        repo_name = self.repo_url.split('/')[-1]
        
        # Use Downloads directory
        if not os.path.exists(self.clone_dir):
            os.makedirs(self.clone_dir)
        
        # Create full path with repo name
        self.temp_dir = os.path.join(self.clone_dir, repo_name)
        
        # Check if directory already exists
        if os.path.exists(self.temp_dir):
            print(f"Repository directory already exists at {self.temp_dir}")
            print("Using existing directory instead of cloning again")
            return self.temp_dir
        
        # Clone if directory doesn't exist
        try:
            print(f"Cloning repository to {self.temp_dir}...")
            Repo.clone_from(self.repo_url, self.temp_dir)
            print(f"Repository cloned successfully")
            return self.temp_dir
        except Exception as e:
            print(f"Error during repository setup: {str(e)}")
            raise Exception(f"Failed to set up repository: {str(e)}")
    
    def find_python_files(self, repo_path: str) -> List[Tuple[str, str]]:
        """
        Find all Python files in the repository.
        
        Args:
            repo_path: Path to the repository
            
        Returns:
            List of tuples containing (file_path, folder_path)
        """
        python_files = []
        
        for root, _, files in os.walk(repo_path):
            for file in files:
                if file.endswith('.py'):
                    file_path = os.path.join(root, file)
                    folder_path = os.path.relpath(root, repo_path)
                    python_files.append((file_path, folder_path))
        
        print(f"Found {len(python_files)} Python files")
        return python_files
    
    def extract_functions(self, file_path: str) -> Dict[str, Dict[str, Any]]:
        """
        Extract functions and their details from a Python file.
        
        Args:
            file_path: Path to the Python file
            
        Returns:
            Dictionary containing function information
        """
        functions = {}
        imports = []
        classes = []
        
        try:
            with open(file_path, 'r', encoding='utf-8') as file:
                content = file.read()
            
            tree = ast.parse(content)
            
            # Extract imports
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for name in node.names:
                        imports.append(name.name)
                elif isinstance(node, ast.ImportFrom):
                    module = node.module or ''
                    for name in node.names:
                        if module:
                            imports.append(f"from {module} import {name.name}")
                        else:
                            imports.append(f"import {name.name}")
                elif isinstance(node, ast.ClassDef):
                    classes.append(node.name)
                elif isinstance(node, ast.FunctionDef):
                    func_name = node.name
                    
                    # Get function arguments
                    args = []
                    for arg in node.args.args:
                        args.append(arg.arg)
                    
                    # Extract function docstring if available
                    docstring = ast.get_docstring(node)
                    
                    functions[func_name] = {
                        'arguments': args,
                        'docstring': docstring
                    }
        except Exception as e:
            print(f"Error parsing {file_path}: {str(e)}")
        
        return {
            'functions': functions,
            'imports': imports,
            'classes': classes
        }
    
    def extract_function_code(self, file_path: str, function_name: str) -> str:
        """
        Extract the complete code of a specific function from a file.
        
        Args:
            file_path: Path to the Python file
            function_name: Name of the function to extract
            
        Returns:
            String containing the function code
        """
        try:
            with open(file_path, 'r', encoding='utf-8') as file:
                content = file.read()
            
            tree = ast.parse(content)
            
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef) and node.name == function_name:
                    # Get the function source code
                    func_start = node.lineno - 1  # Line numbers are 1-indexed
                    func_end = node.end_lineno
                    
                    # Get the function lines
                    lines = content.splitlines()[func_start:func_end]
                    return "\n".join(lines)
                    
            return ""
        except Exception as e:
            print(f"Error extracting function code: {str(e)}")
            return ""
    
    def summarize_function_with_t5(self, function_code: str) -> str:
        """
        Use CodeT5 model to summarize the given function code.
        
        Args:
            function_code: Python function code as string
            
        Returns:
            Summarized description of the function
        """
        try:
            # Removed the printing messages from this method
            inputs = self.tokenizer(function_code, return_tensors="pt", max_length=512, truncation=True)
            outputs = self.model.generate(
                inputs.input_ids, 
                max_length=100,
                min_length=15,
                length_penalty=2.0, 
                num_beams=4, 
                early_stopping=True
            )
            
            # Decode and return summary
            summary = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
            return summary
        except Exception as e:
            print(f"Error generating summary: {str(e)}")
            return "Error generating summary"
    
    def analyze_repository(self) -> Dict[str, Dict[str, Any]]:
        """
        Analyze the repository and extract information from Python files.
        
        Returns:
            Dictionary containing analysis results organized by folder
        """
        repo_path = self.clone_repository()
        python_files = self.find_python_files(repo_path)
        
        # Organize by folder
        folder_structure = {}
        
        for file_path, folder_path in python_files:
            file_name = os.path.basename(file_path)
            if folder_path not in folder_structure:
                folder_structure[folder_path] = {}
            
            print(f"Analyzing {file_path}")
            file_info = self.extract_functions(file_path)
            folder_structure[folder_path][file_name] = file_info
        
        self.analysis_results = folder_structure
        return folder_structure
    
    def process_functions_with_model(self):
        """Process all extracted functions with the T5 model and save results."""
        # Print the model type being used only once
        if self.use_finetuned:
            print("Processing functions with fine-tuned CodeT5 model with LoRA adaptations...")
        else:
            print("Processing functions with CodeT5 model...")
            
        model_results = {}
        
        for folder_path, files in self.analysis_results.items():
            model_results[folder_path] = {}
            
            for file_name, file_info in files.items():
                model_results[folder_path][file_name] = {}
                full_path = os.path.join(self.temp_dir, folder_path, file_name)
                
                # Process each function in the file
                for func_name in file_info.get('functions', {}):
                    print(f"Processing function: {func_name} in {folder_path}/{file_name}")
                    
                    # Extract function code
                    func_code = self.extract_function_code(full_path, func_name)
                    
                    if func_code:
                        # Generate summary with T5
                        summary = self.summarize_function_with_t5(func_code)
                        
                        # Store the results
                        model_results[folder_path][file_name][func_name] = {
                            'code': func_code,
                            'summary': summary
                        }
        
        # Save the model results
        self.model_results = model_results
        with open(self.model_output_file, 'w', encoding='utf-8') as f:
            json.dump(model_results, f, indent=2)
        
        print(f"Model summaries saved to {self.model_output_file}")
    
    def save_results(self):
        """Save the analysis results to a JSON file."""
        with open(self.output_file, 'w', encoding='utf-8') as f:
            json.dump(self.analysis_results, f, indent=2)
        print(f"Analysis results saved to {self.output_file}")
    
    def run(self):
        """Run the complete analysis process."""
        try:
            self.analyze_repository()
            self.save_results()
            self.process_functions_with_model()
            # Skip adding docstrings to files
        finally:
            print(f"Repository was cloned to {self.temp_dir} and will not be removed.")


def main():
    parser = argparse.ArgumentParser(description='Analyze Python files in a GitHub repository')
    parser.add_argument('repo_url', nargs='?', help='URL of the GitHub repository')
    parser.add_argument('--use-pretrained', action='store_true', 
                        help='Use pre-trained model instead of fine-tuned model')
    parser.add_argument('--output-dir', help='Directory to save function summaries')
    parser.add_argument('--analysis-dir', help='Directory to save analysis results')
    
    args = parser.parse_args()
    
    # If repo_url is not provided as a command-line argument, ask for it interactively
    repo_url = args.repo_url
    if not repo_url:
        repo_url = input("Please enter the GitHub repository URL: ")
    
    # Determine if we should use the fine-tuned model (default) or pre-trained model
    use_finetuned = not args.use_pretrained
    model_type = "fine-tuned LoRA" if use_finetuned else "pre-trained"
    
    print(f"Repository URL: {repo_url}")
    print(f"Repository name: {repo_url.split('/')[-1]}")
    print(f"Analysis results will be saved to: REPO_ANALYSIS_FOLDER/{repo_url.split('/')[-1]}.json")
    print(f"Function summaries will be saved to: FUNCTION_SUMMARIES_FOLDER/{repo_url.split('/')[-1]}.json")
    print(f"Using {model_type} CodeT5 model")
    print(f"Repository will be cloned to the Downloads folder")
    print(f"Note: Docstring generation to files is disabled")

    analyzer = GitHubPythonAnalyzer(repo_url, use_finetuned=use_finetuned)
    
    # Use custom output directories if provided
    if args.output_dir:
        print(f"Using custom function summaries directory: {args.output_dir}")
        analyzer.function_summaries_dir = args.output_dir
    
    if args.analysis_dir:
        print(f"Using custom repo analysis directory: {args.analysis_dir}")
        analyzer.repo_analysis_dir = args.analysis_dir
        
    analyzer.run()


if __name__ == "__main__":
    main()