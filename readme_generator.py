import os
import sys
import json
import time
import sqlite3
import datetime
import requests
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()
FASTAPI_AUTH = os.getenv("FASTAPI_AUTH")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")  # Optional but recommended for higher rate limits

if not FASTAPI_AUTH:
    raise ValueError("FASTAPI_AUTH not found. Make sure to set it in the .env file.")

# Constants - using a more reliable path approach
current_dir = os.path.dirname(os.path.abspath(__file__))
README_FOLDER = os.path.join(current_dir, "README_FOLDER")
LLAMA_README_FOLDER = os.path.join(os.path.expanduser("~"), "Documents", "7th Semester", "FYP", "Sample-App-FYP", "README_FOLDER")
DB_PATH = os.path.join(README_FOLDER, "readme_database.db")
SIMPLE_DB_PATH = os.path.join(README_FOLDER, "simple_readme_database.db")

def setup_database():
    """Create database and tables if they don't exist for both types of READMEs"""
    os.makedirs(README_FOLDER, exist_ok=True)  # Ensure the folder exists
    
    # Setup full README database
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create table for storing README data
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS readmes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_url TEXT UNIQUE,
        repo_owner TEXT,
        repo_name TEXT,
        last_commit_sha TEXT,
        last_updated TIMESTAMP,
        readme_content TEXT,
        model_used TEXT
    )
    ''')
    
    # Create table for storing commit history
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS commit_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_url TEXT,
        commit_sha TEXT,
        commit_message TEXT,
        commit_date TIMESTAMP,
        files_changed TEXT,
        FOREIGN KEY (repo_url) REFERENCES readmes(repo_url)
    )
    ''')
    
    conn.commit()
    conn.close()
    
    # Setup simple README database
    conn = sqlite3.connect(SIMPLE_DB_PATH)
    cursor = conn.cursor()
    
    # Create table for storing simple README data
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS simple_readmes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_url TEXT UNIQUE,
        repo_owner TEXT,
        repo_name TEXT,
        last_commit_sha TEXT,
        last_updated TIMESTAMP,
        readme_content TEXT,
        model_used TEXT
    )
    ''')
    
    # Create table for storing commit history for simple READMEs
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS simple_commit_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_url TEXT,
        commit_sha TEXT,
        commit_message TEXT,
        commit_date TIMESTAMP,
        files_changed TEXT,
        FOREIGN KEY (repo_url) REFERENCES simple_readmes(repo_url)
    )
    ''')
    
    conn.commit()
    conn.close()
    
    print(f"Databases initialized at {DB_PATH} and {SIMPLE_DB_PATH}")

def parse_github_url(repo_url):
    """Extract owner and repo name from GitHub URL."""
    # Remove trailing slash if present
    repo_url = repo_url.rstrip("/")
    
    # Handle different GitHub URL formats
    if "github.com" in repo_url:
        parts = repo_url.split("github.com/")[-1].split("/")
        if len(parts) >= 2:
            owner = parts[0]
            repo = parts[1]
            if repo.endswith(".git"):
                repo = repo[:-4]
            return owner, repo, repo_url
    
    raise ValueError("Invalid GitHub repository URL. Format should be: https://github.com/owner/repo")

def get_latest_commit(owner, repo):
    """Get the latest commit SHA from the repository."""
    headers = {}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    
    url = f"https://api.github.com/repos/{owner}/{repo}/commits"
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        print(f"Error fetching commits: {response.text}")
        return None, None, None
    
    commits = response.json()
    if commits and len(commits) > 0:
        latest = commits[0]
        commit_sha = latest["sha"]
        commit_message = latest["commit"]["message"]
        commit_date = latest["commit"]["committer"]["date"]
        return commit_sha, commit_message, commit_date
    
    return None, None, None

def get_commit_details(owner, repo, commit_sha):
    """Get detailed information about a specific commit."""
    headers = {}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    
    url = f"https://api.github.com/repos/{owner}/{repo}/commits/{commit_sha}"
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        print(f"Error fetching commit details: {response.text}")
        return []
    
    commit_data = response.json()
    changed_files = []
    
    if "files" in commit_data:
        for file in commit_data["files"]:
            changed_files.append({
                "filename": file["filename"],
                "status": file["status"],
                "additions": file.get("additions", 0),
                "deletions": file.get("deletions", 0)
            })
    
    return changed_files

def get_readme_from_db(repo_url, simple=False):
    """Check if a README already exists in the database."""
    db_file = SIMPLE_DB_PATH if simple else DB_PATH
    table_name = "simple_readmes" if simple else "readmes"
    
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    
    cursor.execute(f"SELECT repo_owner, repo_name, last_commit_sha, last_updated, readme_content FROM {table_name} WHERE repo_url = ?", 
                  (repo_url,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        owner, name, commit_sha, last_updated, readme = result
        return {
            "owner": owner,
            "name": name,
            "last_commit_sha": commit_sha,
            "last_updated": last_updated,
            "readme": readme,
            "exists": True
        }
    
    return {"exists": False}

def save_readme_to_db(repo_url, owner, name, commit_sha, readme_content, simple=False, model="gpt-4-turbo"):
    """Save a new README to the database."""
    db_file = SIMPLE_DB_PATH if simple else DB_PATH
    table_name = "simple_readmes" if simple else "readmes"
    
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    
    now = datetime.datetime.now().isoformat()
    
    cursor.execute(f"""
    INSERT OR REPLACE INTO {table_name} 
    (repo_url, repo_owner, repo_name, last_commit_sha, last_updated, readme_content, model_used) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (repo_url, owner, name, commit_sha, now, readme_content, model))
    
    conn.commit()
    conn.close()

def save_commit_to_history(repo_url, commit_sha, commit_message, commit_date, files_changed, simple=False):
    """Save commit details to history."""
    db_file = SIMPLE_DB_PATH if simple else DB_PATH
    table_name = "simple_commit_history" if simple else "commit_history"
    
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    
    cursor.execute(f"""
    INSERT INTO {table_name} 
    (repo_url, commit_sha, commit_message, commit_date, files_changed) 
    VALUES (?, ?, ?, ?, ?)
    """, (repo_url, commit_sha, commit_message, commit_date, json.dumps(files_changed)))
    
    conn.commit()
    conn.close()

def should_update_readme(files_changed):
    """Determine if changes warrant a README update."""
    # Files that are likely to impact README content
    important_files = [
        "README.md", 
        "setup.py", 
        "requirements.txt", 
        "package.json",
        "pyproject.toml", 
        "Makefile", 
        "docker-compose.yml",
        ".github/workflows",
        "CONTRIBUTING.md",
        "CHANGELOG.md"
    ]
    
    # Check for important file changes
    for file_info in files_changed:
        filename = file_info["filename"]
        
        # Direct match with important files
        if any(filename.endswith(important) for important in important_files):
            return True
            
        # Check for changes to main code files
        if filename.endswith((".py", ".js", ".ts", ".jsx", ".tsx")) and (
            filename.startswith("src/") or 
            filename.startswith("lib/") or
            filename.startswith("app/") or
            filename.startswith("main.")
        ):
            return True
    
    # If many files changed (major update)
    if len(files_changed) > 10:
        return True
        
    return False

def get_llama_readme(repo_name):
    """Try to find and load the Llama-generated README file."""
    llama_readme_path = os.path.join(LLAMA_README_FOLDER, f"{repo_name}.md")
    
    # Check if the file exists
    if os.path.exists(llama_readme_path):
        try:
            with open(llama_readme_path, "r", encoding="utf-8") as f:
                llama_content = f.read()
            print(f"Found Llama-generated README at: {llama_readme_path}")
            return llama_content
        except Exception as e:
            print(f"Error reading Llama README: {str(e)}")
            return None
    else:
        print(f"No Llama README found at: {llama_readme_path}")
        return None



def simplify_readme_without_call_graph(llama_readme, repo_url, repo_name):
    """Create a simplified version of the README based on the Llama-generated one."""
    
    system_prompt = """
    You need to create a simpler, more basic version of the provided README. 
    
    This version should:
    1. Keep the core information but be notably less detailed than the comprehensive version
    2. Simplify the description to 1-2 sentences
    3. Use bullet points instead of detailed paragraphs where possible
    4. Provide basic installation and usage instructions but with less detail
    5. Keep proper markdown formatting
    6. Remove any advanced sections that aren't essential for basic usage
    
    The result should be a functional but clearly simplified README that contains
    the essential information but is noticeably less polished and comprehensive
    than a professional README.
    """
    
    user_prompt = f"""
    Here is a Llama-generated README for the repository {repo_url} ({repo_name}).
    
    Please create a simplified, more basic version of this README:
    
    ```markdown
    {llama_readme}
    ```
    
    Create a noticeably simplified version that still provides basic functionality but is
    clearly less detailed and comprehensive than a professional README.
    Return the complete simplified README content.
    """
    
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {FASTAPI_AUTH}"
    }
    data = {
        "model": "gpt-3.5-turbo",  # Using a smaller model for the simpler task
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.6,
        "max_tokens": 1500
    }
    
    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        
        result = response.json()
        
        if "choices" in result and len(result["choices"]) > 0:
            return result["choices"][0]["message"]["content"]
        else:
            print(f"Error: Unexpected API response format: {json.dumps(result, indent=2)}")
            return llama_readme  # Return original if simplification fails
            
    except Exception as e:
        print(f"Error simplifying README: {str(e)}")
        return llama_readme  # Return original if simplification fails



# Also, here is the reinforced version of generate_readme_with_call_graph
def generate_readme_with_call_graph(repo_url, repo_name, commit_info=None):
    
    # First, try to get the Llama-generated README
    llama_readme = get_llama_readme(repo_name)
    
    if llama_readme:
        
        return improve_readme_with_call_graph(llama_readme, repo_url, repo_name)
    else:
        # If no Llama README found, fall back to the original implementation
        system_prompt = """
        You are an expert in writing GitHub READMEs. Create a comprehensive, well-structured README
        for the GitHub repository URL provided.
        
        The README MUST include these sections in this order:
        1. Project Title - A clear, descriptive title
        2. Description - STRICTLY MAXIMUM 3 LINES. You must explain what the project does in no more than 3 lines.
        3. Installation - Minimal and straightforward instructions. Keep this section concise.
        4. Usage - Examples and instructions
        5. Features - SIMPLE BULLET POINTS ONLY with NO sub-headings, NO categories, and NO nested lists.
        6. Contributing - Guidelines for contributors
        
        CRITICAL FORMATTING REQUIREMENTS:
        - Description MUST NOT exceed 3 lines total
        - Features MUST be a flat, simple bullet list with NO headings, NO sub-sections, NO categories
        - Installation must be minimal and straightforward
        
        Use proper Markdown formatting. Make the README informative and accurate while following these strict formatting rules.
        """
        
        user_prompt = f"""
        Please generate a README for this GitHub repository: {repo_url}
        
        # Based on the repository name '{repo_name}', create a README with all required sections.
        
        CRITICAL FORMATTING REQUIREMENTS:
        - Description MUST NOT exceed 3 lines total - this is non-negotiable
        - Features MUST be a simple bullet list with NO headings, NO sub-sections, and NO categories
        - Installation must be minimal and straightforward
        
        I will check that these requirements are met, so please follow them exactly.
        """
        
        # If we have commit info, add it to help with context
        if commit_info:
            user_prompt += f"\n\nRecent commit information:\n{commit_info}"
        
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {FASTAPI_AUTH}"
        }
        data = {
            "model": "gpt-4-turbo",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.7,
            "max_tokens": 2000
        }
        
        try:
            response = requests.post(url, headers=headers, json=data)
            response.raise_for_status()
            
            result = response.json()
            
            if "choices" in result and len(result["choices"]) > 0:
                return result["choices"][0]["message"]["content"]
            else:
                print(f"Error: Unexpected API response format: {json.dumps(result, indent=2)}")
                raise Exception("Invalid API response format")
                
        except requests.exceptions.RequestException as e:
            print(f"Error calling API: {str(e)}")
            if hasattr(e, 'response') and e.response:
                print(f"Response status: {e.response.status_code}")
                print(f"Response body: {e.response.text}")
                
            # Provide a fallback README template
            return f"""# {repo_name}

## Description
{repo_name.replace('-', ' ')} is a tool for efficiently managing and processing data in a streamlined way.

## Installation
```bash
git clone {repo_url}.git
cd {repo_name}
pip install -r requirements.txt
```

## Usage
```python
from {repo_name.replace('-', '_')} import core

# Process data
result = core.process_data(your_data)
print(result)
```

## Features
- Fast data processing
- Simple API
- Cross-platform compatibility

## Contributing
Contributions are welcome! Please submit a pull request.
"""


# And the improved version of improve_readme_with_call_graph
def improve_readme_with_call_graph(llama_readme, repo_url, repo_name):
    """Improve the Llama-generated README for the callgraph version."""
    
    system_prompt = """
    You are an expert README improver. Your task is to enhance the provided README 
    to make it more professional and helpful for users while strictly following these formatting rules:
    
    CRITICAL FORMATTING REQUIREMENTS:
    1. Description MUST be MAXIMUM 3 LINES TOTAL - this is non-negotiable
    2. Installation instructions MUST be minimal and straightforward
    3. Features MUST be a simple bullet list with NO headings, NO sub-sections, and NO categories
    
    Other improvements to make:
    - Expand the usage section with practical examples
    - Add proper markdown formatting throughout
    - Add badges where appropriate (build status, version, license, etc.)
    
    You MUST follow the formatting requirements above. They are strict requirements,
    not suggestions. The README will be rejected if they are not followed.
    """
    
    user_prompt = f"""
    Here is a README for the repository {repo_url} ({repo_name}).
    
    Improve it while STRICTLY following these formatting requirements:
    - Description section MUST be MAXIMUM 3 LINES TOTAL
    - Installation section must be minimal and straightforward
    - Features section MUST be a simple bullet list with NO headings, sub-sections, or categories
    
    ```markdown
    {llama_readme}
    ```
    
    I will check that these requirements are met, so please follow them exactly.
    Return the complete improved README content.
    """
    
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {FASTAPI_AUTH}"
    }
    data = {
        "model": "gpt-4-turbo",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.7,
        "max_tokens": 2000
    }
    
    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        
        result = response.json()
        
        if "choices" in result and len(result["choices"]) > 0:
            return result["choices"][0]["message"]["content"]
        else:
            print(f"Error: Unexpected API response format: {json.dumps(result, indent=2)}")
            return llama_readme  # Return original if improvement fails
            
    except Exception as e:
        print(f"Error improving README: {str(e)}")
        return llama_readme  # Return original if improvement fails

def generate_readme_without_call_graph(repo_url, repo_name, commit_info=None):
    """Generate a simpler README based on Llama's output or fallback to original implementation."""
    
    # First, try to get the Llama-generated README
    llama_readme = get_llama_readme(repo_name)
    
    if llama_readme:
        # If Llama README exists, create a simplified version
        return simplify_readme_without_call_graph(llama_readme, repo_url, repo_name)
    else:
        # If no Llama README found, fall back to the original implementation
        system_prompt = """
        You are tasked with creating a GitHub README file that is simple overall, but matches the comprehensive version's usage and contribution sections exactly.
        
        Create a README that:
        1. Has brief title, description, installation, and features sections
        2. Uses proper markdown formatting throughout
        3. Makes the Usage section IDENTICAL to what would be in a comprehensive README, with examples and instructions
        4. Makes the Contributing section IDENTICAL to what would be in a comprehensive README, with guidelines for contributors
        
        The title, description, installation, and features sections should be minimal and basic.
        The usage and contributing sections should match exactly what would be in a high-quality comprehensive README.
        """
        
        user_prompt = f"""
        Create a README for this GitHub repository: {repo_url}
        
        The repository name is '{repo_name}'.
        
        For most sections, keep content minimal:
        - Brief title and description (1-2 sentences)
        - Simple installation steps
        - Short list of features (2-3 bullet points)
        
        However, for these sections, ensure they EXACTLY MATCH what would be in a comprehensive, high-quality README:
        - USAGE: Include examples and instructions as you would in a comprehensive README
        - CONTRIBUTING: Include guidelines for contributors exactly as you would in a comprehensive README
        
        IMPORTANT: The Usage and Contributing sections should be identical in content, detail, and formatting to what would 
        appear in a comprehensive README for this repository, while other sections remain minimal.
        """
        
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {FASTAPI_AUTH}"
        }
        data = {
            "model": "gpt-3.5-turbo",  # Using a smaller model for the simpler task
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.5,
            "max_tokens": 1500  # Increased token limit to accommodate detailed Usage and Contributing sections
        }
        
        try:
            response = requests.post(url, headers=headers, json=data)
            response.raise_for_status()
            
            result = response.json()
            
            if "choices" in result and len(result["choices"]) > 0:
                return result["choices"][0]["message"]["content"]
            else:
                print(f"Error: Unexpected API response format: {json.dumps(result, indent=2)}")
                raise Exception("Invalid API response format")
                
        except requests.exceptions.RequestException as e:
            print(f"Error calling API: {str(e)}")
            
            # Fallback template if the API call fails
            return f"""# {repo_name}

## Description
A simple project for {repo_name.replace('-', ' ')}.

## Installation
```bash
git clone {repo_url}.git
cd {repo_name}
pip install -r requirements.txt  # or npm install
```

## Features
- Core functionality for {repo_name.replace('-', ' ')}
- Easy to use API

## Usage

### Getting Started
To use {repo_name}, import the package and initialize it with your configuration:

```python
from {repo_name.replace('-', '_')} import core

# Initialize with default settings
client = core.Client()

# Process your data
results = client.process_data(your_data)
```

### Advanced Options
The library supports several advanced options for customization:

```python
# Configure with specific options
client = core.Client(
    debug=True,
    output_format="json",
    max_workers=4
)
```

For more examples, please refer to the examples directory in the repository.

## Contributing

Contributions are welcome! Here's how you can contribute to the project:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please make sure to update tests as appropriate and adhere to the existing coding style.

### Code of Conduct

Please note that this project is released with a Contributor Code of Conduct. By participating in this project you agree to abide by its terms.
"""

def update_readme(old_readme, repo_url, repo_name, commit_message, files_changed, simple=False):
    """Update an existing README based on new commits."""
    
    # Create a description of the changes
    files_summary = []
    for file in files_changed[:10]:  # Limit to 10 files to avoid long prompts
        status = file["status"]
        filename = file["filename"]
        changes = f"+{file['additions']}/-{file['deletions']}" if "additions" in file else ""
        files_summary.append(f"- {status}: {filename} {changes}")
        
    if len(files_changed) > 10:
        files_summary.append(f"- ... and {len(files_changed) - 10} more files")
        
    changes_description = "\n".join(files_summary)
    
    # Try to get the Llama-generated README for reference
    llama_readme = get_llama_readme(repo_name)
    
    if simple:
        system_prompt = """
        You are updating a minimal, basic README file.
        
        Update the existing README while maintaining its extremely minimal style. Each section should:
        1. Remain exactly one line of text (except for code blocks)
        2. Be updated only if absolutely necessary based on the repository changes
        3. Remain generic and minimal in detail
        
        Do not add additional sections or expand the existing ones.
        """
    else:
        system_prompt = """
        You are an expert in maintaining GitHub READMEs. You need to update an existing README
        based on recent changes to the repository.
        
        Review the existing README content and the description of recent changes, then:
        1. Update any information that might be outdated due to these changes
        2. Add any new features or capabilities introduced by these changes
        3. Modify installation or usage instructions if needed
        4. Keep the same overall structure and style of the original README
        5. Preserve as much of the original content as possible
        
        Only make changes that are justified by the commit information provided.
        """
    
    user_prompt = f"""
    Repository: {repo_url}
    
    Recent commit message: "{commit_message}"
    
    Files changed in this commit:
    {changes_description}
    
    Current README content:
    ```markdown
    {old_readme}
    ```
    """
    
    # If Llama README exists, include it as a reference
    if llama_readme:
        user_prompt += f"""
        For reference, here is the Llama-generated README for this repository:
        ```markdown
        {llama_readme}
        ```
        
        Please update the current README to reflect recent changes, maintaining the same style and structure.
        For the comprehensive README (with callgraph), make the README better than the Llama version if possible.
        For the simple README (without callgraph), make the README simpler than the Llama version.
        Return the complete updated README content.
        """
    else:
        user_prompt += """
        Please update this README to reflect the recent changes, maintaining the same style and structure.
        Return the complete updated README content.
        """
    
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {FASTAPI_AUTH}"
    }
    model = "gpt-3.5-turbo" if simple else "gpt-4-turbo"
    data = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.5,  # Lower temperature for more conservative updates
        "max_tokens": 1000 if simple else 2000
    }
    
    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        
        result = response.json()
        
        if "choices" in result and len(result["choices"]) > 0:
            return result["choices"][0]["message"]["content"]
        else:
            print(f"Error: Unexpected API response format: {json.dumps(result, indent=2)}")
            return old_readme  # Return original if update fails
            
    except Exception as e:
        print(f"Error updating README: {str(e)}")
        return old_readme  # Return original if update fails

def generate_readme(repo_url, simple=False, with_callgraph=True):
    """Main function to generate README for a given repository URL.
    
    Parameters:
    repo_url (str): GitHub repository URL
    simple (bool): If True, generates a simplified README
    with_callgraph (bool): If True, generates an improved README (default for both regular and with_callgraph options)
    """
    try:
        # Set up the database if it doesn't exist
        setup_database()
        
        # Parse repository URL
        owner, repo_name, full_url = parse_github_url(repo_url)
        print(f"Processing repository: {owner}/{repo_name}")
        
        # Check if we already have a README for this repo
        db_result = get_readme_from_db(full_url, simple)
        
        # Get latest commit information
        latest_commit_sha, commit_message, commit_date = get_latest_commit(owner, repo_name)
        if not latest_commit_sha:
            raise ValueError("Could not fetch latest commit information.")
            
        print(f"Latest commit: {latest_commit_sha[:8]} - {commit_message}")
        
        readme_type = "simple" if simple else "comprehensive"
        
        # If README exists in database
        if db_result["exists"]:
            print(f"Found existing {readme_type} README in database (last updated: {db_result['last_updated']})")
            
            # If commit hasn't changed, just return existing README
            if db_result["last_commit_sha"] == latest_commit_sha:
                print(f"No new commits since last {readme_type} README generation. Using cached version.")
                readme_content = db_result["readme"]
            else:
                print(f"New commits detected. Previous: {db_result['last_commit_sha'][:8]}, Latest: {latest_commit_sha[:8]}")
                
                # Get details about what changed
                files_changed = get_commit_details(owner, repo_name, latest_commit_sha)
                
                # Save this commit to history
                save_commit_to_history(full_url, latest_commit_sha, commit_message, commit_date, files_changed, simple)
                
                # Determine if README should be updated
                if should_update_readme(files_changed):
                    print(f"Changes detected that require {readme_type} README update.")
                    # Update the README
                    readme_content = update_readme(
                        db_result["readme"], 
                        full_url, 
                        repo_name, 
                        commit_message,
                        files_changed,
                        simple
                    )
                    
                    # Save updated README
                    save_readme_to_db(full_url, owner, repo_name, latest_commit_sha, readme_content, simple)
                    print(f"{readme_type.capitalize()} README updated based on latest changes.")
                else:
                    print(f"Changes don't significantly affect {readme_type} README content. Using existing version.")
                    readme_content = db_result["readme"]
                    # Update the commit SHA in the database
                    save_readme_to_db(full_url, owner, repo_name, latest_commit_sha, readme_content, simple)
        else:
            # Generate new README
            print(f"No existing {readme_type} README found. Generating new {readme_type} README...")
            
            if simple:
                readme_content = generate_readme_without_call_graph(full_url, repo_name)
                model = "gpt-3.5-turbo"
            else:
                # Both regular and with_callgraph options use the improved version
                readme_content = generate_readme_with_call_graph(full_url, repo_name)
                model = "gpt-4-turbo"
            
            # Save to database
            save_readme_to_db(full_url, owner, repo_name, latest_commit_sha, readme_content, simple, model)
            print(f"New {readme_type} README generated and saved to database.")
            
            # Get commit details for history
            files_changed = get_commit_details(owner, repo_name, latest_commit_sha)
            save_commit_to_history(full_url, latest_commit_sha, commit_message, commit_date, files_changed, simple)
            # Save README to file
        prefix = "simple_" if simple else ""
        readme_path = os.path.join(README_FOLDER, f"{prefix}{repo_name}.md")
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(readme_content)
        
        print(f"\n{readme_type.capitalize()} README saved to: {readme_path}")
        return readme_path, readme_content
        
    except ValueError as e:
        print(f"Error: {str(e)}")
        return None, str(e)
    except Exception as e:
        print(f"An error occurred: {str(e)}")
        import traceback
        traceback.print_exc()
        return None, str(e)

# This is used when the script is run directly
if __name__ == "__main__":
    # Get repository URL from command line
    if len(sys.argv) < 2:
        print("Error: Please provide a GitHub repository URL.")
        sys.exit(1)
        
    repo_url = sys.argv[1]
    
    # Parse the command line options
    simple = False
    with_callgraph = True  # Default is with callgraph (improved version)
    
    for arg in sys.argv[2:]:
        if arg.lower() in ['--simple', '-s']:
            simple = True
        elif arg.lower() in ['--no-callgraph', '-nc']:
            with_callgraph = False
    
    # For normal generation and with_callgraph, both use the improved version
    # Only simple README uses the simplified version
    readme_path, readme_content = generate_readme(repo_url, simple, with_callgraph)
    if readme_path:
        print(f"README saved to: {readme_path}")
        sys.exit(0)
    else:
        print(f"Error generating README: {readme_content}")
        sys.exit(1)