import os
import sys
import json
import ast
import time
import sqlite3
import datetime
import requests
import argparse
from dotenv import load_dotenv
import traceback

# Load environment variables from .env file
load_dotenv()
FASTAPI_AUTH = os.getenv("FASTAPI_AUTH")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")  # Optional but recommended for higher rate limits

if not FASTAPI_AUTH:
    raise ValueError("FASTAPI_AUTH not found. Make sure to set it in the .env file.")

# Constants - using a more reliable path approach
current_dir = os.path.dirname(os.path.abspath(__file__))
COMMENTS_FOLDER = os.path.join(current_dir, "COMMENTED_CODE")
DB_PATH = os.path.join(COMMENTS_FOLDER, "comments_database.db")

# Set up sys.stdout to handle Unicode properly
# Use utf-8 encoding with error handler to replace problematic characters
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def setup_database():
    """Create database and tables if they don't exist"""
    os.makedirs(COMMENTS_FOLDER, exist_ok=True)  # Ensure the folder exists
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Check if table exists
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='commented_files'")
    table_exists = cursor.fetchone() is not None
    
    if not table_exists:
        # Create new table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS commented_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_url TEXT,
            file_path TEXT,
            file_name TEXT,
            last_modified TIMESTAMP,
            commented_content TEXT,
            model_used TEXT,
            UNIQUE(repo_url, file_path)
        )
        ''')
    else:
        # Check if the required columns exist
        cursor.execute("PRAGMA table_info(commented_files)")
        columns = [info[1] for info in cursor.fetchall()]
        
        # Add any missing columns
        if "repo_url" not in columns:
            cursor.execute("ALTER TABLE commented_files ADD COLUMN repo_url TEXT")
        if "last_modified" not in columns:
            cursor.execute("ALTER TABLE commented_files ADD COLUMN last_modified TIMESTAMP")
        if "commented_content" not in columns:
            cursor.execute("ALTER TABLE commented_files ADD COLUMN commented_content TEXT")
        if "model_used" not in columns:
            cursor.execute("ALTER TABLE commented_files ADD COLUMN model_used TEXT")
    
    conn.commit()
    conn.close()
    
    print(f"Database initialized at {DB_PATH}")

def parse_github_url(repo_url):
    """Extract owner and repo name from GitHub URL with enhanced error checking."""
    import re
    
    # Check if the URL is provided
    if not repo_url:
        raise ValueError("GitHub repository URL is required.")
    
    # Remove trailing slash if present
    repo_url = repo_url.rstrip("/")
    
    # Basic URL validation using regex
    url_pattern = re.compile(
        r'^https?://'  # http:// or https://
        r'([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,6}'  # domain
        r'(/[^/]+)*$'  # path
    )
    
    if not url_pattern.match(repo_url):
        raise ValueError("Invalid URL format. The URL should start with http:// or https://")
    
    # Check if it's a GitHub URL
    if "github.com" not in repo_url:
        raise ValueError("Not a GitHub URL. Please enter a valid GitHub repository URL.")
    
    # Handle different GitHub URL formats
    try:
        parts = repo_url.split("github.com/")[-1].split("/")
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise ValueError("Invalid GitHub repository URL format. URL should be in the format: https://github.com/owner/repo")
        
        owner = parts[0]
        repo = parts[1]
        
        # Remove .git extension if present
        if repo.endswith(".git"):
            repo = repo[:-4]
        
        # Check for valid owner/repo names
        if not re.match(r'^[a-zA-Z0-9_.-]+$', owner) or not re.match(r'^[a-zA-Z0-9_.-]+$', repo):
            raise ValueError("Invalid GitHub repository name or owner. Repository and owner names should contain only alphanumeric characters, hyphens, dots, and underscores.")
        
        return owner, repo, repo_url
    except Exception as e:
        if isinstance(e, ValueError) and "GitHub" in str(e):
            raise e
        raise ValueError("Invalid GitHub repository URL. Format should be: https://github.com/owner/repo")

# def find_all_python_files(owner, repo):
#     """Find all Python files in the repository with improved error handling."""
#     headers = {}
#     if GITHUB_TOKEN:
#         headers["Authorization"] = f"token {GITHUB_TOKEN}"
    
#     python_files = []
    
#     # Queue to store directories that need to be searched
#     dirs_to_process = [""]  # Start with root directory
    
#     # First try to access the repository to confirm it exists and is accessible
#     try:
#         test_url = f"https://api.github.com/repos/{owner}/{repo}"
#         response = requests.get(test_url, headers=headers)
        
#         if response.status_code == 404:
#             raise ValueError(f"Repository not found: {owner}/{repo}. The repository might be private or doesn't exist.")
#         elif response.status_code == 403:
#             raise ValueError("Access forbidden. GitHub API rate limit may have been exceeded.")
#         elif response.status_code != 200:
#             raise ValueError(f"Error accessing repository: HTTP {response.status_code}. {response.text}")
#     except requests.exceptions.RequestException as e:
#         raise ValueError(f"Network error while accessing GitHub API: {str(e)}")
    
#     # Continue with file searching if repository exists
#     while dirs_to_process:
#         current_dir = dirs_to_process.pop(0)
#         url = f"https://api.github.com/repos/{owner}/{repo}/contents/{current_dir}"
        
#         try:
#             response = requests.get(url, headers=headers)
            
#             if response.status_code != 200:
#                 print(f"Error fetching directory contents: {response.text}")
#                 continue
                
#             items = response.json()
            
#             # Process items in this directory
#             for item in items:
#                 if item["type"] == "file" and item["name"].endswith(".py"):
#                     python_files.append({
#                         "path": item["path"],
#                         "name": item["name"],
#                         "download_url": item["download_url"]
#                     })
#                 elif item["type"] == "dir":
#                     # Add subdirectory to queue
#                     dirs_to_process.append(item["path"])
#         except Exception as e:
#             print(f"Error processing directory {current_dir}: {str(e)}")
#             continue
    
#     # Sort files by path for consistent output
#     return sorted(python_files, key=lambda x: x["path"])

# Updated find_all_python_files function in comments.py
def find_all_python_files(owner, repo):
    """Find all Python files in the repository with improved error handling and recursive search."""
    headers = {}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    
    python_files = []
    
    # Queue to store directories that need to be searched
    dirs_to_process = [""]  # Start with root directory
    
    # First try to access the repository to confirm it exists and is accessible
    try:
        test_url = f"https://api.github.com/repos/{owner}/{repo}"
        response = requests.get(test_url, headers=headers)
        
        if response.status_code == 404:
            raise ValueError(f"Repository not found: {owner}/{repo}. The repository might be private or doesn't exist.")
        elif response.status_code == 403:
            raise ValueError("Access forbidden. GitHub API rate limit may have been exceeded.")
        elif response.status_code != 200:
            raise ValueError(f"Error accessing repository: HTTP {response.status_code}. {response.text}")
    except requests.exceptions.RequestException as e:
        raise ValueError(f"Network error while accessing GitHub API: {str(e)}")
    
    # Continue with file searching if repository exists
    processed_dirs = set()  # Keep track of directories we've already processed
    
    # Continue with file searching if repository exists
    while dirs_to_process:
        current_dir = dirs_to_process.pop(0)
        
        # Skip if we've already processed this directory
        if current_dir in processed_dirs:
            continue
            
        processed_dirs.add(current_dir)
        
        url = f"https://api.github.com/repos/{owner}/{repo}/contents/{current_dir}"
        print(f"Fetching directory contents: {url}")
        
        try:
            response = requests.get(url, headers=headers)
            
            if response.status_code != 200:
                print(f"Error fetching directory contents: {response.text}")
                continue
                
            items = response.json()
            
            # Handle the case where the API returns a single file instead of a list
            if not isinstance(items, list):
                items = [items]
            
            # Process items in this directory
            for item in items:
                try:
                    if item["type"] == "file" and item["name"].endswith(".py"):
                        print(f"Found Python file: {item['path']}")
                        python_files.append({
                            "path": item["path"],
                            "name": item["name"],
                            "download_url": item["download_url"]
                        })
                    elif item["type"] == "dir":
                        # Add subdirectory to queue
                        dir_path = item["path"]
                        if dir_path not in processed_dirs:
                            print(f"Adding directory to queue: {dir_path}")
                            dirs_to_process.append(dir_path)
                except Exception as item_error:
                    print(f"Error processing item: {str(item_error)}")
                    continue
        except Exception as e:
            print(f"Error processing directory {current_dir}: {str(e)}")
            continue
    
    # Sort files by path for consistent output
    result = sorted(python_files, key=lambda x: x["path"])
    print(f"Total Python files found: {len(result)}")
    return result

def find_python_file(owner, repo, specific_file=None):
    """Find a Python file in the repository to comment."""
    try:
        print(f"Finding Python file: owner={owner}, repo={repo}, specific_file={specific_file}")
        
        if specific_file:
            # If a specific file is requested, try to find it directly
            headers = {}
            if GITHUB_TOKEN:
                headers["Authorization"] = f"token {GITHUB_TOKEN}"
            
            # Get the file contents API URL - handle with or without path
            specific_file_clean = specific_file.strip()
            
            # If it's just a filename without a path, try to find the file by name
            if '/' not in specific_file_clean:
                print(f"Looking for file by name only: {specific_file_clean}")
                all_python_files = find_all_python_files(owner, repo)
                for py_file in all_python_files:
                    if py_file['name'] == specific_file_clean:
                        # Use ASCII-safe characters to avoid encoding issues
                        print(f"Found matching file: {py_file['path']} -> {py_file['download_url']}")
                        return py_file['name'], py_file['download_url']
                
                print(f"No exact filename match for: {specific_file_clean}")
                # Continue with direct API access
            
            # Try direct API access with specific file path
            url = f"https://api.github.com/repos/{owner}/{repo}/contents/{specific_file_clean}"
            print(f"Trying direct API access: {url}")
            
            try:
                response = requests.get(url, headers=headers)
                print(f"API response status: {response.status_code}")
                
                if response.status_code == 200:
                    file_data = response.json()
                    if file_data["type"] == "file" and file_data["name"].endswith(".py"):
                        print(f"Found requested file via API: {file_data['name']} -> {file_data['download_url']}")
                        return file_data["name"], file_data["download_url"]
                    else:
                        print(f"File is not a Python file: {file_data['name']}")
                else:
                    print(f"Error fetching file via API: {response.text}")
            except Exception as e:
                print(f"Exception in API request: {str(e)}")
                
            # Try raw GitHub URL for main branch as fallback
            try:
                raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/main/{specific_file_clean}"
                print(f"Trying raw GitHub URL: {raw_url}")
                raw_response = requests.get(raw_url)
                
                if raw_response.status_code == 200:
                    print(f"File found via raw GitHub URL: {specific_file_clean}")
                    return specific_file_clean, raw_url
                else:
                    print(f"Raw GitHub URL failed with status: {raw_response.status_code}")
            except Exception as e:
                print(f"Exception in raw URL request: {str(e)}")
                
            # If we get here with specific_file set, try one more approach - search all Python files
            try:
                print("Searching all Python files as fallback...")
                all_files = find_all_python_files(owner, repo)
                for file in all_files:
                    print(f"Checking: {file['path']}")
                    if file['name'] == specific_file_clean or file['path'].endswith(f"/{specific_file_clean}"):
                        print(f"Found a match in file search: {file['path']}")
                        return file['name'], file['download_url']
            except Exception as e:
                print(f"Exception in file search: {str(e)}")
        
        # If no specific file or if specific file not found, use the default file finding logic
        print("Falling back to default file finding logic")
        headers = {}
        if GITHUB_TOKEN:
            headers["Authorization"] = f"token {GITHUB_TOKEN}"
        
        try:
            url = f"https://api.github.com/repos/{owner}/{repo}/contents"
            response = requests.get(url, headers=headers)
            
            if response.status_code != 200:
                print(f"Error fetching repository contents: {response.text}")
                return None, None
            
            files = response.json()
            
            # Priority for finding a main file
            main_file_candidates = ["main.py", "app.py", "index.py", "server.py", "api.py"]
            python_files = []
            
            for file in files:
                if file["type"] == "file" and file["name"].endswith(".py"):
                    python_files.append(file)
                    if file["name"] in main_file_candidates:
                        return file["name"], file["download_url"]
            
            # If we didn't find a main file candidate, use the first Python file
            if python_files:
                return python_files[0]["name"], python_files[0]["download_url"]
        except Exception as e:
            print(f"Exception in default file finding: {str(e)}")
        
        # No suitable files found at root level, try to search in subdirectories
        try:
            files = find_all_python_files(owner, repo)
            if files:
                return files[0]["name"], files[0]["download_url"]
        except Exception as e:
            print(f"Exception in subdirectory search: {str(e)}")
        
        # No suitable files found
        print("No Python files found in the repository")
        return None, None
    except Exception as e:
        print(f"Unhandled error in find_python_file: {str(e)}")
        import traceback
        traceback.print_exc()
        return None, None

def get_file_content(download_url):
    """Fetch the content of a file from GitHub."""
    response = requests.get(download_url)
    
    if response.status_code != 200:
        print(f"Error fetching file content: {response.text}")
        return None
    
    return response.text

def extract_code_structure(code_content):
    """Extract functions and classes from the Python code string."""
    try:
        tree = ast.parse(code_content)
        code_elements = []
        
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                code_elements.append({
                    "type": "function",
                    "name": node.name,
                    "line_number": node.lineno,
                    "end_line": node.end_lineno,
                    "args": [arg.arg for arg in node.args.args],
                    "body": ast.get_source_segment(code_content, node),
                    "existing_docstring": ast.get_docstring(node)
                })
            elif isinstance(node, ast.ClassDef):
                code_elements.append({
                    "type": "class",
                    "name": node.name,
                    "line_number": node.lineno,
                    "end_line": node.end_lineno,
                    "body": ast.get_source_segment(code_content, node),
                    "existing_docstring": ast.get_docstring(node)
                })
        
        return code_elements
    except SyntaxError:
        print("SyntaxError: Could not parse Python code. File may be invalid.")
        return []

def get_comments_from_db(repo_url, file_name):
    """Check if comments for this repo file already exist in the database."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT file_name, last_modified, commented_content FROM commented_files WHERE repo_url = ? AND file_name = ?", 
                  (repo_url, file_name))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        name, last_modified, commented_content = result
        return {
            "file_name": name,
            "last_modified": last_modified,
            "commented_content": commented_content,
            "exists": True
        }
    
    return {"exists": False}

def save_comments_to_db(repo_url, file_path, file_name, last_modified, commented_content, model="gpt-4o"):
    """Save commented code to the database."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("""
    INSERT OR REPLACE INTO commented_files 
    (repo_url, file_path, file_name, last_modified, commented_content, model_used) 
    VALUES (?, ?, ?, ?, ?, ?)
    """, (repo_url, file_path, file_name, last_modified, commented_content, model))
    
    conn.commit()
    conn.close()

def generate_comments(code_elements, file_name):
    
    system_prompt = """
    You are an expert Python developer specializing in writing concise, informative code comments.
    
    For each function or class provided, write a SINGLE LINE comment that:
    1. Is strictly less than 80 characters long
    2. Clearly explains the purpose of the function/class
    3. Does not include information already obvious from the name
    4. Uses professional, technical language
    
    DO NOT write multi-line docstrings - only provide single-line comments that would appear above
    the function/class definition with a # prefix.
    
    Always be precise and concise. Never exceed one line per comment.
    """
    
    # Extract code samples for context
    samples = []
    for element in code_elements:
        samples.append(f"Type: {element['type']}\nName: {element['name']}\nCode:\n{element['body']}\n")
    
    # Truncate if there are too many samples
    if len(samples) > 15:
        samples = samples[:15]
        
    user_prompt = f"""
    I need single-line comments for functions and classes in this Python file: {file_name}
    
    Here are the code elements to comment:
    
    {'\n---\n'.join(samples)}
    
    For each function or class, provide ONLY a single-line comment (< 80 chars) in this format:
    [ElementType] [ElementName]: [Comment]
    
    For example:
    function calculate_total: Computes sum of all items and applies discount if applicable
    class UserManager: Handles user creation, authentication, and profile updates
    """
    
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {FASTAPI_AUTH}"
    }
    data = {
        "model": "gpt-4o",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.3,  # Lower temperature for more consistent, concise comments
        "max_tokens": 1000
    }
    
    try:
        print("Generating comments...")
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        
        result = response.json()
        
        if "choices" in result and len(result["choices"]) > 0:
            comment_text = result["choices"][0]["message"]["content"]
            
            # Parse the comment responses
            comments = {}
            for line in comment_text.strip().split('\n'):
                if not line or ':' not in line:
                    continue
                    
                try:
                    element_info, comment = line.split(':', 1)
                    element_parts = element_info.strip().split(' ')
                    
                    if len(element_parts) >= 2:
                        element_type = element_parts[0]
                        element_name = element_parts[1]
                        comments[element_name] = comment.strip()
                except Exception:
                    continue
                    
            return comments
        else:
            print(f"Error: Unexpected API response format: {json.dumps(result, indent=2)}")
            return {}
            
    except requests.exceptions.RequestException as e:
        print(f"Error calling API: {str(e)}")
        if hasattr(e, 'response') and e.response:
            print(f"Response status: {e.response.status_code}")
            print(f"Response body: {e.response.text}")
        return {}

def apply_comments_to_code(code_content, comments):
    """Apply the generated comments to the Python code string."""
    try:
        # Parse the code
        tree = ast.parse(code_content)
        
        # Build a mapping of line numbers to function/class definitions
        line_mapping = {}
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                line_mapping[node.lineno] = node.name
        
        # Sort the line numbers in descending order to avoid position shifts
        sorted_lines = sorted(line_mapping.keys(), reverse=True)
        
        # Convert content to lines for easier manipulation
        lines = code_content.split('\n')
        
        # Add comments to the file
        for line_num in sorted_lines:
            if line_num > len(lines):
                continue
                
            element_name = line_mapping[line_num]
            if element_name in comments:
                comment = comments[element_name]
                # Insert the comment line above the function/class definition
                lines.insert(line_num - 1, f"# {comment}")
        
        # Join lines back together
        commented_content = '\n'.join(lines)
        
        return commented_content
    except SyntaxError:
        print("SyntaxError: Could not parse Python code. Returning original code.")
        return code_content

# def list_python_files_in_repo(repo_url):
#     """List all Python files in the repository with improved error handling."""
#     try:
#         # Log to stderr instead of stdout
#         import sys
#         import traceback
#         sys.stderr.write(f"Listing Python files in repository: {repo_url}\n")
        
#         try:
#             owner, repo_name, _ = parse_github_url(repo_url)
#             print(f"Listing Python files in repository: {owner}/{repo_name}")
            
#             try:
#                 # First, check if the repository exists
#                 headers = {}
#                 if GITHUB_TOKEN:
#                     headers["Authorization"] = f"token {GITHUB_TOKEN}"
                
#                 test_url = f"https://api.github.com/repos/{owner}/{repo_name}"
#                 response = requests.get(test_url, headers=headers)
                
#                 if response.status_code == 404:
#                     sys.stderr.write(f"Repository not found: {owner}/{repo_name}\n")
#                     return []
#                 elif response.status_code == 403:
#                     sys.stderr.write(f"API rate limit exceeded for: {owner}/{repo_name}\n")
#                     return []
#                 elif response.status_code != 200:
#                     sys.stderr.write(f"Error accessing repository: {response.status_code} - {response.text}\n")
#                     return []
                
#                 # If repository exists, proceed to find Python files
#                 python_files = find_all_python_files(owner, repo_name)
                
#                 if not python_files:
#                     sys.stderr.write("No Python files found in the repository.\n")
#                     return []
                    
#                 sys.stderr.write(f"Found {len(python_files)} Python files.\n")
#                 return python_files
                
#             except Exception as e:
#                 # Catch any other exceptions within file finding
#                 sys.stderr.write(f"Error finding Python files: {str(e)}\n")
#                 # Don't print the traceback to avoid exposing it to users
#                 return []
                
#         except ValueError as e:
#             # Handle URL parsing errors
#             sys.stderr.write(f"Error: {str(e)}\n")
#             return []
            
#     except Exception as e:
#         # Catch any unexpected exceptions
#         sys.stderr.write(f"Error listing Python files: {str(e)}\n")
#         return []

# Update the list_python_files_in_repo function to provide more debugging information
def list_python_files_in_repo(repo_url):
    """List all Python files in the repository with improved error handling and verbose logging."""
    try:
        # Log to stderr instead of stdout
        import sys
        import traceback
        sys.stderr.write(f"Listing Python files in repository: {repo_url}\n")
        
        try:
            owner, repo_name, _ = parse_github_url(repo_url)
            print(f"Listing Python files in repository: {owner}/{repo_name}")
            
            try:
                # First, check if the repository exists
                headers = {}
                if GITHUB_TOKEN:
                    headers["Authorization"] = f"token {GITHUB_TOKEN}"
                
                test_url = f"https://api.github.com/repos/{owner}/{repo_name}"
                response = requests.get(test_url, headers=headers)
                
                if response.status_code == 404:
                    sys.stderr.write(f"Repository not found: {owner}/{repo_name}\n")
                    return []
                elif response.status_code == 403:
                    sys.stderr.write(f"API rate limit exceeded for: {owner}/{repo_name}\n")
                    return []
                elif response.status_code != 200:
                    sys.stderr.write(f"Error accessing repository: {response.status_code} - {response.text}\n")
                    return []
                
                # If repository exists, proceed to find Python files
                sys.stderr.write(f"Repository exists. Searching for Python files...\n")
                python_files = find_all_python_files(owner, repo_name)
                
                if not python_files:
                    sys.stderr.write("No Python files found in the repository.\n")
                    return []
                    
                sys.stderr.write(f"Found {len(python_files)} Python files.\n")
                # Log some sample file paths for debugging
                if len(python_files) > 0:
                    sys.stderr.write(f"Sample files:\n")
                    for i, file in enumerate(python_files[:5]):  # Show up to 5 sample files
                        sys.stderr.write(f"  {i+1}. {file['path']}\n")
                    if len(python_files) > 5:
                        sys.stderr.write(f"  ... and {len(python_files) - 5} more\n")
                
                return python_files
                
            except Exception as e:
                # Catch any other exceptions within file finding
                sys.stderr.write(f"Error finding Python files: {str(e)}\n")
                traceback.print_exc(file=sys.stderr)
                return []
                
        except ValueError as e:
            # Handle URL parsing errors
            sys.stderr.write(f"Error parsing URL: {str(e)}\n")
            return []
            
    except Exception as e:
        # Catch any unexpected exceptions
        sys.stderr.write(f"Error listing Python files: {str(e)}\n")
        traceback.print_exc(file=sys.stderr)
        return []


def generate_comments_for_repo(repo_url, specific_file=None):
    """Main function to generate comments for a file in the repository."""
    try:
        # Set up the database if it doesn't exist
        setup_database()
        
        # Parse repository URL
        owner, repo_name, full_url = parse_github_url(repo_url)
        print(f"Processing repository: {owner}/{repo_name}")
        if specific_file:
            print(f"Looking for specific file: '{specific_file}'")
        
        # Find a Python file to comment
        file_name, download_url = find_python_file(owner, repo_name, specific_file)
        
        if not file_name or not download_url:
            print("No Python files found in the repository.")
            return None, "No Python files found in the repository."
            
        print(f"Found Python file: {file_name} at URL: {download_url}")
        
        # Get the file content
        code_content = get_file_content(download_url)
        
        if not code_content:
            print("Failed to download file content.")
            return None, "Failed to download file content."
        
        print(f"Successfully downloaded file content ({len(code_content)} bytes)")
            
        # Generate new comments
        print("Generating new comments...")
        print("Extracting code structure...")
        code_elements = extract_code_structure(code_content)
        
        if not code_elements:
            print("No functions or classes found in the file. Nothing to comment.")
            # Return the original code if no functions/classes found
            output_path = os.path.join(COMMENTS_FOLDER, f"commented_{file_name}")
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(code_content)
            
            print(f"Saved original code to: {output_path}")
            return output_path, code_content
        
        print(f"Found {len(code_elements)} code elements to comment.")
        # Generate comments
        comments = generate_comments(code_elements, file_name)
        
        if not comments:
            print("Failed to generate comments. Returning original code.")
            # Return the original code if comment generation fails
            output_path = os.path.join(COMMENTS_FOLDER, f"commented_{file_name}")
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(code_content)
            
            print(f"Saved original code to: {output_path}")
            return output_path, code_content
            
        # Apply comments to the code
        commented_content = apply_comments_to_code(code_content, comments)
        
        # Save commented file with a name that reflects the original file path
        output_path = os.path.join(COMMENTS_FOLDER, f"commented_{file_name}")
        
        print(f"Saving commented code to: {output_path}")
        
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(commented_content)
        
        print(f"\nCommented code saved to: {output_path}")
        return output_path, commented_content
        
    except ValueError as e:
        print(f"Error: {str(e)}")
        return None, str(e)
    except Exception as e:
        print(f"An error occurred: {str(e)}")
        import traceback
        traceback.print_exc()
        return None, str(e)

# Modify the main function and entry point in comments.py
if __name__ == "__main__":
    # Set up argument parser
    parser = argparse.ArgumentParser(description="Generate comments for Python files in a GitHub repository")
    parser.add_argument("repo_url", help="URL of the GitHub repository")
    parser.add_argument("--list-files", action="store_true", help="List all Python files in the repository")
    parser.add_argument("--file", help="Specific Python file path to comment")
    
    try:
        args = parser.parse_args()
        
        # If --list-files flag is provided, list all Python files and exit
        if args.list_files:
            try:
                # Redirect logs to stderr
                import sys
                old_stdout = sys.stdout
                sys.stdout = sys.stderr
                
                python_files = list_python_files_in_repo(args.repo_url)
                
                # Restore stdout for the JSON output only
                sys.stdout = old_stdout
                
                # Even if empty, return valid JSON
                print(json.dumps(python_files))
                sys.exit(0)
            except Exception as e:
                sys.stderr.write(f"Error listing files: {str(e)}\n")
                # Don't print full traceback to avoid exposing it
                # Output empty array on error to ensure valid JSON
                print("[]")
                sys.exit(1)
        
        # Otherwise, generate comments for a specific file or the default file
        try:
            sys.stderr.write(f"Starting comment generation for {args.repo_url}, file: {args.file or 'default'}\n")
            
            output_path, commented_code = generate_comments_for_repo(args.repo_url, args.file)
            
            if output_path:
                print(f"Commented code saved to: {output_path}")
                sys.exit(0)
            else:
                print(f"Error generating comments: {commented_code}")
                sys.exit(1)
        except Exception as e:
            sys.stderr.write(f"Fatal error in comment generation: {str(e)}\n")
            traceback.print_exc(file=sys.stderr)
            print(f"Error generating comments: {str(e)}")
            sys.exit(1)
    except Exception as e:
        sys.stderr.write(f"Unhandled exception: {str(e)}\n")
        traceback.print_exc(file=sys.stderr)
        print(f"Error: {str(e)}")
        sys.exit(1)
