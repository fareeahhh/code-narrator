#!/usr/bin/env python3
"""
Python Repository Structure Analyzer and Callgraph Generator

This script analyzes Python repositories and generates a function call graph in DOT format.
It can analyze local repositories or clone directly from GitHub.

Features:
- Extract functions, classes, and methods from Python files
- Generate hierarchical call graphs with color-coded nodes
- Support for direct GitHub repository URL input
- Output in DOT format for visualization with Graphviz

Usage:
  python generate_callgraph.py --single-repo https://github.com/username/repo --output /path/to/output
"""

import os
import ast
import sys
import json
import argparse
import tempfile
import shutil
import subprocess
import traceback
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime


class FunctionVisitor(ast.NodeVisitor):
    """AST visitor that extracts functions and methods within classes."""
    
    def __init__(self):
        self.functions = []
        self.classes = {}
        self.current_class = None
        self.imports = {}
        self.function_calls = {}
        self.current_function = None
    
    def visit_Import(self, node):
        """Process import statements."""
        for name in node.names:
            self.imports[name.asname or name.name] = name.name
        self.generic_visit(node)
    
    def visit_ImportFrom(self, node):
        """Process from...import statements."""
        module = node.module or ''
        for name in node.names:
            import_name = name.asname or name.name
            self.imports[import_name] = f"{module}.{name.name}" if module else name.name
        self.generic_visit(node)
    
    def visit_FunctionDef(self, node):
        """Process function definitions."""
        if self.current_class:
            # This is a method in a class
            self.classes[self.current_class].append(node.name)
        else:
            # This is a standalone function
            self.functions.append(node.name)
        
        # Track the current function to record calls
        prev_function = self.current_function
        if self.current_class:
            self.current_function = f"{self.current_class}.{node.name}"
        else:
            self.current_function = node.name
        
        # Initialize the function calls list for this function
        if self.current_function not in self.function_calls:
            self.function_calls[self.current_function] = []
        
        # Continue traversing the AST
        self.generic_visit(node)
        
        # Restore the previous function context
        self.current_function = prev_function
    
    def visit_AsyncFunctionDef(self, node):
        """Handle async functions the same way as regular functions."""
        self.visit_FunctionDef(node)
    
    def visit_ClassDef(self, node):
        """Process class definitions."""
        # Store the current class name
        class_name = node.name
        self.classes[class_name] = []
        
        # Save the previous class context
        prev_class = self.current_class
        self.current_class = class_name
        
        # Visit all nodes in the class body
        self.generic_visit(node)
        
        # Restore the previous class context
        self.current_class = prev_class
    
    def visit_Call(self, node):
        """Process function calls."""
        if self.current_function:
            # Try to get the function name being called
            func_name = None
            if isinstance(node.func, ast.Name):
                func_name = node.func.id
            elif isinstance(node.func, ast.Attribute):
                if isinstance(node.func.value, ast.Name):
                    # Could be a method call on an object or module
                    obj_name = node.func.value.id
                    method_name = node.func.attr
                    if obj_name in self.imports:
                        # It's likely a module.function call
                        func_name = f"{obj_name}.{method_name}"
                    else:
                        # It's likely an object.method call
                        func_name = f"{obj_name}.{method_name}"
                else:
                    # This handles more complex cases like a.b.c()
                    func_name = f"...{node.func.attr}"
            
            if func_name:
                self.function_calls[self.current_function].append(func_name)
        
        # Continue traversing the call's arguments
        self.generic_visit(node)


def analyze_python_file(file_path):
    """Analyze a Python file and extract functions, classes, and call information."""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # Parse the AST
        tree = ast.parse(content)
        
        # Visit the AST to extract functions and classes
        visitor = FunctionVisitor()
        visitor.visit(tree)
        
        return {
            'functions': visitor.functions,
            'classes': visitor.classes,
            'function_calls': visitor.function_calls
        }
    except Exception as e:
        print(f"Error analyzing {file_path}: {e}", file=sys.stderr)
        return {'functions': [], 'classes': {}, 'function_calls': {}}


def find_python_files(repo_path):
    """Find all Python files in the repository."""
    python_files = []
    
    for root, _, files in os.walk(repo_path):
        for file in files:
            if file.endswith('.py'):
                python_files.append(os.path.join(root, file))
    
    return python_files


def generate_dot_file(repo_path, output_file):
    """Generate a DOT file showing the structure of the repository."""
    python_files = find_python_files(repo_path)
    repo_name = os.path.basename(os.path.abspath(repo_path))
    
    if not python_files:
        print(f"Warning: No Python files found in {repo_path}", file=sys.stderr)
        # Create a minimal DOT file to indicate no Python files
        with open(output_file, 'w', encoding='utf-8') as dot_file:
            dot_file.write(f'digraph {repo_name.replace("-", "_")} {{\n')
            dot_file.write('  node [shape=box];\n')
            dot_file.write('  rankdir=LR;\n')
            dot_file.write('  label="No Python files found in this repository";\n')
            dot_file.write('}\n')
        return
    
    with open(output_file, 'w', encoding='utf-8') as dot_file:
        # Write DOT file header
        dot_file.write(f'digraph {repo_name.replace("-", "_").replace(".", "_")} {{\n')
        dot_file.write('  node [shape=box, fontname="Arial", fontsize=10];\n')
        dot_file.write('  edge [fontname="Arial", fontsize=9];\n')
        dot_file.write('  rankdir=LR;\n')
        dot_file.write(f'  label="Call Graph for {repo_name}\\nGenerated on {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}";\n')
        dot_file.write('  labelloc="t";\n\n')
        
        # Process each Python file
        file_nodes = {}  # To keep track of created file nodes
        for file_path in python_files:
            # Get relative path from repo root
            rel_path = os.path.relpath(file_path, repo_path)
            
            # Remove file extension for node names
            file_node = os.path.splitext(rel_path)[0].replace('/', '.').replace('\\', '.')
            file_nodes[rel_path] = file_node
            
            # Analyze the file
            analysis = analyze_python_file(file_path)
            
            # Add file node with improved style
            dot_file.write(f'  "{file_node}" [label="{rel_path}", style=filled, fillcolor=lightblue, shape=folder];\n')
            
            # Add function nodes and edges
            for func in analysis['functions']:
                func_node = f"{file_node}->{func}"
                dot_file.write(f'  "{func_node}" [label="{func}()", style=filled, fillcolor="#E6F3FF"];\n')
                dot_file.write(f'  "{file_node}" -> "{func_node}" [color="#666666"];\n')
            
            # Add class nodes and edges
            for class_name, methods in analysis['classes'].items():
                class_node = f"{file_node}_{class_name}"
                dot_file.write(f'  "{class_node}" [label="{class_name}", style=filled, fillcolor="#D0F0C0", shape=box];\n')
                dot_file.write(f'  "{file_node}" -> "{class_node}" [color="#666666"];\n')
                
                for method in methods:
                    method_node = f"{class_node}->{method}"
                    dot_file.write(f'  "{method_node}" [label="{method}()", style=filled, fillcolor="#F0F0F0"];\n')
                    dot_file.write(f'  "{class_node}" -> "{method_node}" [color="#666666"];\n')
        
        # Add function call edges
        for file_path in python_files:
            rel_path = os.path.relpath(file_path, repo_path)
            file_node = file_nodes[rel_path]
            
            analysis = analyze_python_file(file_path)
            
            # Process function calls
            for caller, callees in analysis['function_calls'].items():
                caller_parts = caller.split('.')
                
                if len(caller_parts) > 1 and caller_parts[0] in analysis['classes']:
                    # It's a method in a class
                    caller_node = f"{file_node}_{caller_parts[0]}->{caller_parts[1]}"
                else:
                    # It's a standalone function
                    caller_node = f"{file_node}->{caller}"
                
                for callee in callees:
                    # For now, we'll only add edges between functions within the same file
                    # A more sophisticated approach would resolve cross-file calls
                    callee_parts = callee.split('.')
                    
                    if len(callee_parts) > 1 and callee_parts[0] in analysis['classes']:
                        # It's a method in a class
                        callee_node = f"{file_node}_{callee_parts[0]}->{callee_parts[1]}"
                        # Add edge only if the callee node exists
                        dot_file.write(f'  "{caller_node}" -> "{callee_node}" [color="blue", style="dashed"];\n')
                    elif callee in analysis['functions']:
                        # It's a standalone function
                        callee_node = f"{file_node}->{callee}"
                        # Add edge
                        dot_file.write(f'  "{caller_node}" -> "{callee_node}" [color="blue", style="dashed"];\n')
        
        # Write DOT file footer
        dot_file.write('}\n')
    
    return True


def parse_github_url(github_url):
    """Parse a GitHub URL and extract owner and repo name."""
    if not github_url:
        return None, None
    
    try:
        parsed_url = urlparse(github_url)
        path_parts = parsed_url.path.strip('/').split('/')
        
        if len(path_parts) >= 2 and parsed_url.netloc == 'github.com':
            return path_parts[0], path_parts[1]
        else:
            print(f"Error: Invalid GitHub repository URL format: {github_url}", file=sys.stderr)
            return None, None
    except Exception as e:
        print(f"Error parsing GitHub URL: {e}", file=sys.stderr)
        return None, None


def clone_github_repo(github_url, target_dir):
    """Clone a GitHub repository to the target directory."""
    owner, repo = parse_github_url(github_url)
    if not owner or not repo:
        raise ValueError(f"Invalid GitHub repository URL: {github_url}")
    
    repo_path = os.path.join(target_dir, repo)
    
    # Remove existing directory if it exists
    if os.path.exists(repo_path):
        shutil.rmtree(repo_path)
    
    # Clone the repository
    try:
        print(f"Cloning repository {owner}/{repo}...")
        subprocess.run(['git', 'clone', github_url, repo_path], 
                      check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return repo_path
    except subprocess.CalledProcessError as e:
        error_message = e.stderr.decode() if e.stderr else str(e)
        print(f"Error cloning repository: {error_message}", file=sys.stderr)
        
        if "not found" in error_message.lower() or "404" in error_message:
            raise ValueError(f"Repository not found: {github_url}. Make sure the repository exists and is public.")
        elif "authentication" in error_message.lower():
            raise ValueError(f"Authentication error. Make sure the repository is public.")
        else:
            raise ValueError(f"Failed to clone repository: {error_message}")


def process_dataset(dataset_dir, output_dir):
    """Process all repositories in the dataset directory."""
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Get all immediate subdirectories in the dataset directory (each is a repo)
    repos = [d for d in os.listdir(dataset_dir) if os.path.isdir(os.path.join(dataset_dir, d))]
    
    if not repos:
        print(f"No repositories found in {dataset_dir}", file=sys.stderr)
        return
    
    print(f"Found {len(repos)} repositories in {dataset_dir}")
    
    # Process each repository
    for repo_name in repos:
        repo_path = os.path.join(dataset_dir, repo_name)
        output_file = os.path.join(output_dir, f"{repo_name}.dot")
        
        print(f"Processing repository: {repo_name}")
        try:
            generate_dot_file(repo_path, output_file)
            print(f"Generated DOT file: {output_file}")
        except Exception as e:
            print(f"Error processing repository {repo_name}: {e}", file=sys.stderr)


def main():
    """Main function to parse arguments and process repositories."""
    parser = argparse.ArgumentParser(description='Analyze Python repository structure and generate callgraph DOT files.')
    parser.add_argument('--dataset', 
                       help='Path to the dataset directory containing repositories')
    # parser.add_argument('--output', default='/Users/malaikahussain/Documents/Semester08/FYP2/pre-jobfair/Sample-App-FYP/CallGraphs_Folder',
    #                    help='Output directory for DOT files')
    parser.add_argument('--output', default='C:/Users/dell/Documents/7th Semester/FYP/Sample-App-FYP/CALLGRAPHS_FOLDER',
                       help='Output directory for DOT files')
    parser.add_argument('--single-repo', 
                       help='Process a single repository (local path or GitHub URL)')
    parser.add_argument('--github-url', 
                       help='GitHub repository URL to clone and analyze')
    parser.add_argument('--format', choices=['dot', 'png', 'svg'], default='dot',
                       help='Output format (requires Graphviz for png/svg)')
    parser.add_argument('--verbose', action='store_true',
                       help='Enable verbose output')
    
    args = parser.parse_args()
    
    # Make sure the output directory exists
    os.makedirs(args.output, exist_ok=True)
    
    try:
        if args.github_url or (args.single_repo and args.single_repo.startswith('http')):
            # Use github_url if provided, otherwise use single_repo if it's a URL
            github_url = args.github_url or args.single_repo
            
            # Create output directory if needed
            os.makedirs(args.output, exist_ok=True)
            
            with tempfile.TemporaryDirectory() as temp_dir:
                try:
                    # Clone the repository
                    print(f"Processing GitHub repository: {github_url}")
                    repo_path = clone_github_repo(github_url, temp_dir)
                    repo_name = os.path.basename(repo_path)
                    
                    # Generate DOT file with simple naming convention as requested
                    output_file = os.path.join(args.output, f"{repo_name}.dot")
                    if generate_dot_file(repo_path, output_file):
                        print(f"Generated DOT file: {output_file}")
                        
                        # Convert to other formats if requested
                        if args.format in ['png', 'svg']:
                            try:
                                output_image = os.path.splitext(output_file)[0] + f".{args.format}"
                                print(f"Converting DOT to {args.format.upper()}...")
                                subprocess.run(['dot', f'-T{args.format}', output_file, '-o', output_image], 
                                             check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                                print(f"Generated {args.format.upper()} file: {output_image}")
                            except subprocess.CalledProcessError:
                                print(f"Warning: Failed to convert DOT to {args.format.upper()}. Is Graphviz installed?", file=sys.stderr)
                            except Exception as e:
                                print(f"Error converting to {args.format.upper()}: {e}", file=sys.stderr)
                    
                    # Return output information as JSON for API use
                    result = {
                        "success": True,
                        "repository": github_url,
                        "dot_file": output_file,
                        "message": f"Callgraph generated successfully for {repo_name}"
                    }
                    print(json.dumps(result))
                    
                except Exception as e:
                    error_message = str(e)
                    print(f"Error processing GitHub repository: {error_message}", file=sys.stderr)
                    
                    if args.verbose:
                        traceback.print_exc()
                    
                    # Return error information as JSON for API use
                    error_result = {
                        "success": False,
                        "repository": github_url,
                        "error": error_message
                    }
                    print(json.dumps(error_result))
                    sys.exit(1)
                
        elif args.single_repo:
            # Process single local repository
            repo_path = args.single_repo
            repo_name = os.path.basename(os.path.abspath(repo_path))
            output_file = os.path.join(args.output, f"{repo_name}.dot")
            
            if not os.path.isdir(repo_path):
                print(f"Error: '{repo_path}' is not a valid directory.", file=sys.stderr)
                sys.exit(1)
            
            os.makedirs(args.output, exist_ok=True)
            print(f"Processing single repository: {repo_path}")
            
            if generate_dot_file(repo_path, output_file):
                print(f"Generated DOT file: {output_file}")
                
                # Convert to other formats if requested
                if args.format in ['png', 'svg']:
                    try:
                        output_image = os.path.splitext(output_file)[0] + f".{args.format}"
                        subprocess.run(['dot', f'-T{args.format}', output_file, '-o', output_image], 
                                      check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                        print(f"Generated {args.format.upper()} file: {output_image}")
                    except subprocess.CalledProcessError:
                        print(f"Warning: Failed to convert DOT to {args.format.upper()}. Is Graphviz installed?", file=sys.stderr)
                    except Exception as e:
                        print(f"Error converting to {args.format.upper()}: {e}", file=sys.stderr)
            
        elif args.dataset:
            # Process all repositories in the dataset
            dataset_dir = args.dataset
            output_dir = args.output
            
            if not os.path.isdir(dataset_dir):
                print(f"Error: Dataset directory '{dataset_dir}' is not a valid directory.", file=sys.stderr)
                sys.exit(1)
            
            process_dataset(dataset_dir, output_dir)
        else:
            print("Error: No input specified. Use --single-repo, --github-url, or --dataset.", file=sys.stderr)
            sys.exit(1)
            
    except Exception as e:
        print(f"Unhandled error: {e}", file=sys.stderr)
        if args.verbose:
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()