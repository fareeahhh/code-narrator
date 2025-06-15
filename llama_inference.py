#!/usr/bin/env python3
"""
Llama Inference Script for README Generation

This script takes repository analysis data, function summaries, and call graph information
to generate comprehensive README files using the Meta Llama 2 model.
"""

import os
import json
import sys
import argparse
import re
from typing import Dict, Any, List, Optional
import requests
from pathlib import Path
from urllib.parse import urlparse

# Constants
README_FOLDER = os.path.join(os.getcwd(), "README_FOLDER")
os.makedirs(README_FOLDER, exist_ok=True)

class LlamaREADMEGenerator:
    """Generate README using Llama 2 model based on repository analysis."""
    
    def __init__(self, repo_url: str, hf_token: str = None):
        """
        Initialize the README generator with repository URL and optional HuggingFace token.
        
        Args:
            repo_url: URL to the GitHub repository
            hf_token: HuggingFace API token for accessing Llama model
        """
        self.repo_url = repo_url
        self.repo_name = repo_url.split('/')[-1]
        self.hf_token = hf_token
        
        # Paths to analysis files
        self.repo_analysis_path = os.path.join("REPO_ANALYSIS_FOLDER", f"{self.repo_name}.json")
        self.function_summaries_path = os.path.join("FUNCTION_SUMMARIES_FOLDER", f"{self.repo_name}.json")
        self.callgraph_path = os.path.join("CALLGRAPHS_FOLDER", f"{self.repo_name}.dot")
        
        # Output path for README
        self.readme_output_path = os.path.join(README_FOLDER, f"llama_{self.repo_name}.md")
        
        # Hugging Face API endpoint
        self.api_url = "https://api-inference.huggingface.co/models/meta-llama/Llama-2-7b-chat-hf"
        self.headers = {
            "Authorization": f"Bearer {self.hf_token}",
            "Content-Type": "application/json"
        }
    
    def load_analysis_data(self) -> Dict[str, Any]:
        """Load and combine all repository analysis data for input to the model."""
        data = {
            "repo_url": self.repo_url,
            "repo_name": self.repo_name
        }
        
        # Load repository structure and analysis
        if os.path.exists(self.repo_analysis_path):
            with open(self.repo_analysis_path, 'r', encoding='utf-8') as f:
                data["repo_analysis"] = json.load(f)
            print("Repository analysis data loaded successfully.")
        else:
            print(f"Warning: Repository analysis file not found at {self.repo_analysis_path}")
            data["repo_analysis"] = {}
        
        # Load function summaries
        if os.path.exists(self.function_summaries_path):
            with open(self.function_summaries_path, 'r', encoding='utf-8') as f:
                data["function_summaries"] = json.load(f)
            print("Function summaries loaded successfully.")
        else:
            print(f"Warning: Function summaries file not found at {self.function_summaries_path}")
            data["function_summaries"] = {}
        
        # Load call graph file as text
        if os.path.exists(self.callgraph_path):
            with open(self.callgraph_path, 'r', encoding='utf-8') as f:
                data["callgraph"] = f.read()
            print("Call graph data loaded successfully.")
        else:
            print(f"Warning: Call graph file not found at {self.callgraph_path}")
            data["callgraph"] = ""
        
        return data
    
    def generate_prompt(self, data: Dict[str, Any]) -> str:
        """Generate a well-crafted prompt for Llama based on analysis data."""
        # Extract key structural information for a more concise prompt
        # Get folder structure
        folders = list(data['repo_analysis'].keys()) if 'repo_analysis' in data else []
        
        # Count Python files
        python_file_count = 0
        for folder in folders:
            python_file_count += len(data['repo_analysis'].get(folder, {}))
            
        # Extract key functions
        key_functions = []
        for folder, files in data.get('function_summaries', {}).items():
            for file_name, functions in files.items():
                for func_name, func_info in functions.items():
                    if 'summary' in func_info:
                        key_functions.append({
                            'path': f"{folder}/{file_name}" if folder != "." else file_name,
                            'name': func_name,
                            'summary': func_info.get('summary', '')
                        })
        
        # Create a structured prompt for the Llama model
        prompt = f"""<s>[INST] You are an expert software developer and documentation specialist. 
Your task is to create a comprehensive, professional README.md file for the GitHub repository: {data['repo_url']}

I have provided you with detailed analysis of the repository, including:
1. The repository structure with files, imports, functions, and classes
2. Function summaries and their code
3. A call graph showing relationships between functions

Use this information to create a detailed README.md that will help users understand what the repository does,
how to install it, how to use it, its features, and how to contribute.

Repository Name: {data['repo_name']}
Number of Python Files: {python_file_count}
Main Folders: {', '.join(folders[:10]) if len(folders) <= 10 else ', '.join(folders[:10]) + '...'}

The README should include the following sections:
1. Description - A clear explanation of what the project does and its purpose
2. Installation - How to install and set up the project
3. Usage - How to use the project with examples
4. Features - Key features and capabilities of the project
5. Contributing - How others can contribute to the project

Make sure to:
- Use proper Markdown formatting including headings, lists, code blocks, etc.
- Begin with a title that includes the repository name
- Include badges if appropriate
- Organize information logically and highlight important points
- Be concise but comprehensive
- Include usage examples with proper code formatting
- Include a table of contents if the README is long
- Maintain a professional tone

Key Functions:
"""
        
        # Add key functions information (limited to 10 functions for brevity)
        for i, func in enumerate(key_functions[:10]):
            prompt += f"\n- {func['name']} ({func['path']}): {func['summary']}"
        
        # Add a sample of the repository analysis data 
        prompt += f"""

Here's an excerpt of the repository structure:
```json
{json.dumps(list(data['repo_analysis'].keys()), indent=2)}
```

Based on all this information, generate a complete README.md file.
[/INST]

I'll create a comprehensive README.md file for the {data['repo_name']} repository based on the provided analysis.

"""
        return prompt
    
    def run_llama_inference(self, prompt: str) -> str:
        """Run inference with Llama model through the Hugging Face API."""
        print("Running Llama inference to generate README...")
        try:
            # Prepare the payload for the API
            payload = {
                "inputs": prompt,
                "parameters": {
                    "max_new_tokens": 2048,
                    "temperature": 0.7,
                    "top_p": 0.9,
                    "do_sample": True
                }
            }
            
            # Make the API request
            response = requests.post(self.api_url, headers=self.headers, json=payload)
            
            # Check for errors
            if response.status_code != 200:
                print(f"API Error: {response.status_code} - {response.text}")
                return f"Error generating README: API returned status code {response.status_code}"
            
            # Extract generated text
            result = response.json()
            if isinstance(result, list) and len(result) > 0:
                generated_text = result[0].get('generated_text', '')
                # Remove the input prompt from the generated text
                if generated_text.startswith(prompt):
                    generated_text = generated_text[len(prompt):].strip()
                return generated_text
            else:
                print(f"Unexpected API response format: {result}")
                return "Error: Unexpected API response format"
            
        except Exception as e:
            print(f"Error during Llama inference: {str(e)}")
            return f"Error generating README: {str(e)}"
    
    def generate_fallback_readme(self, data: Dict[str, Any]) -> str:
        """Generate a fallback README if the Llama inference fails."""
        # Extract repository name and key information
        repo_name = data['repo_name']
        folders = list(data['repo_analysis'].keys()) if 'repo_analysis' in data else []
        
        # Create a basic README structure
        readme = f"""# {repo_name}

## Description
This is a Python repository containing various utilities and functions.

## Installation
```bash
# Clone the repository
git clone {data['repo_url']}

# Navigate to the project directory
cd {repo_name}

# Install dependencies (if there's a requirements.txt file)
pip install -r requirements.txt
```

## Usage
```python
# Import modules from the repository
# Example usage will depend on the specific functionality
```

## Features
- Python utility functions
- Multiple modules organized in folders
- Documentation and examples

## Contributing
1. Fork the repository
2. Create a new branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Commit your changes (`git commit -m 'Add some feature'`)
5. Push to the branch (`git push origin feature/your-feature`)
6. Open a Pull Request
"""
        return readme
    
    def save_readme(self, content: str) -> str:
        """Save the generated README to a file and return the file path."""
        try:
            with open(self.readme_output_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"README saved to: {self.readme_output_path}")
            return self.readme_output_path
        except Exception as e:
            print(f"Error saving README: {str(e)}")
            # Try to save to an alternative location
            alt_path = f"llama_{self.repo_name}_README.md"
            try:
                with open(alt_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"README saved to alternative location: {alt_path}")
                return alt_path
            except:
                print("Failed to save README to any location")
                return ""
    
    def generate(self) -> str:
        """Run the complete README generation process."""
        print(f"Generating README for repository: {self.repo_url}")
        
        # Load all analysis data
        data = self.load_analysis_data()
        
        # Generate prompt based on the data
        prompt = self.generate_prompt(data)
        
        # Run Llama inference
        readme_content = self.run_llama_inference(prompt)
        
        # If the inference failed or returned an error message, use the fallback
        if readme_content.startswith("Error"):
            print("Llama inference failed. Using fallback README generation.")
            readme_content = self.generate_fallback_readme(data)
        
        # Save README to file
        readme_path = self.save_readme(readme_content)
        
        return readme_path

def main():
    parser = argparse.ArgumentParser(description='Generate README using Llama 2 based on repository analysis')
    parser.add_argument('repo_url', help='URL of the GitHub repository')
    parser.add_argument('--token', help='HuggingFace API token for accessing Llama model')
    
    args = parser.parse_args()
    
    # Initialize the generator
    generator = LlamaREADMEGenerator(args.repo_url, args.token)
    
    # Generate README
    readme_path = generator.generate()
    
    if readme_path:
        print(f"README generation completed. File saved to: {readme_path}")
        # Print the file path for the calling script
        print(f"README saved to: {readme_path}")
        return 0
    else:
        print("README generation failed.")
        return 1

if __name__ == "__main__":
    sys.exit(main())