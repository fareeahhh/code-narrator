import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import dotenv from "dotenv";
import { App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import fs from "fs";
import http from "http";
import express from "express";
import { Octokit } from "@octokit/rest";
import fetch from "node-fetch";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

// Promisify exec for easier usage with async/await
const execPromise = promisify(exec);

// Load environment variables from .env
dotenv.config();

// Set up Express.js
const expressApp = express();

// Middleware to parse form data
expressApp.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON
expressApp.use(express.json());

// Add this new line to serve static files
expressApp.use(express.static(__dirname));

// Now your existing routes
expressApp.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// Add this to your app.js to list all installations
expressApp.get("/debug/installations", async (req, res) => {
  try {
    console.log("Fetching all installations for this app...");

    const installations = await app.octokit.rest.apps.listInstallations();

    console.log("Found installations:", installations.data);

    res.json({
      success: true,
      installations: installations.data.map((install) => ({
        id: install.id,
        account: install.account.login,
        repositories_url: install.repositories_url,
      })),
    });
  } catch (error) {
    console.error("Error fetching installations:", error.message);
    res.status(500).json({
      error: error.message,
      status: error.status,
    });
  }
});

// Add this debug endpoint to your app.js
expressApp.get("/debug/installation/:installationId", async (req, res) => {
  const installationId = req.params.installationId;

  try {
    console.log(`Checking installation ${installationId}`);

    // Try to get installation info
    const installation = await app.octokit.rest.apps.getInstallation({
      installation_id: parseInt(installationId),
    });

    console.log("Installation found:", installation.data);

    res.json({
      success: true,
      installation: installation.data,
      repositories: installation.data.repositories_url,
    });
  } catch (error) {
    console.error("Installation check failed:", error.message);
    res.status(500).json({
      error: error.message,
      status: error.status,
    });
  }
});

// Fetch metadata for the repository entered
expressApp.post("/fetch-metadata", async (req, res) => {
  const repoUrl = req.body.repo_url;
  if (!repoUrl) {
    return res.status(400).json({
      error: "Please enter a valid GitHub repository URL.",
      details: "The URL field cannot be empty.",
    });
  }

  try {
    // Use the enhanced parseRepoUrl function
    const [owner, repo] = parseRepoUrl(repoUrl);
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    try {
      // Fetch repository metadata
      const repoData = await octokit.repos.get({
        owner: owner,
        repo: repo,
      });

      // Extract relevant metadata
      const metadata = {
        stars: repoData.data.stargazers_count,
        forks: repoData.data.forks_count,
        watchers: repoData.data.subscribers_count,
      };

      // Send the metadata as JSON
      res.json(metadata);
    } catch (githubError) {
      // Use the helper function to handle GitHub API errors
      return handleGitHubError(githubError, res);
    }
  } catch (parseError) {
    // URL parsing errors from the enhanced parseRepoUrl function
    return res.status(400).json({
      error: parseError.message,
      details: "Please check the URL and try again.",
    });
  }
});

/**
 * Cleans the README content by removing any unwanted tags or formatting
 * @param {string} readmeContent - The raw README content
 * @returns {string} - Clean README content
 */
function cleanReadmeContent(readmeContent) {
  if (!readmeContent) return "";

  // Remove any userStyle tags or similar at the beginning
  let cleanedContent = readmeContent;

  // Remove any XML/HTML-like tags at the beginning
  cleanedContent = cleanedContent.replace(/^\s*<[^>]+>.*?<\/[^>]+>\s*/m, "");

  // Ensure the README starts with a markdown heading
  if (!cleanedContent.trim().startsWith("#")) {
    // Find the first markdown heading
    const headingMatch = cleanedContent.match(/^#\s+.+$/m);
    if (headingMatch) {
      const headingIndex = cleanedContent.indexOf(headingMatch[0]);
      if (headingIndex > 0) {
        cleanedContent = cleanedContent.substring(headingIndex);
      }
    }
  }

  return cleanedContent;
}

// Update the existing "/generate-readme" endpoint to use the with-callgraph version
expressApp.post("/generate-readme", async (req, res) => {
  const repoUrl = req.body.repo_url;
  if (!repoUrl) {
    return res.status(400).json({
      error: "Please enter a valid GitHub repository URL.",
      details: "The URL field cannot be empty.",
    });
  }

  try {
    // Validate URL format before proceeding
    try {
      parseRepoUrl(repoUrl);
    } catch (parseError) {
      return res.status(400).json({
        error: parseError.message,
        details: "Please check the URL and try again.",
      });
    }

    // Get the absolute path to the Python script using path.resolve
    const pythonScriptPath = path.resolve(__dirname, "readme_generator.py");
    console.log(`Using Python script at: ${pythonScriptPath}`);

    // Use proper quotes around paths to handle spaces in directory names
    const command = `python "${pythonScriptPath}" "${repoUrl}"`;
    // const command = `python3 "${pythonScriptPath}" "${repoUrl}"`;
    console.log(`Executing command: ${command}`);

    try {
      const { stdout, stderr } = await execPromise(command);

      // Check if there's an error in stderr
      if (stderr) {
        console.error(`Python script error: ${stderr}`);

        // Handle repository not found errors with a user-friendly message
        if (
          stderr.includes("404") ||
          stderr.includes("Not Found") ||
          stderr.includes("Repository not found")
        ) {
          return res.status(404).json({
            error: "Repository not found",
            details:
              "The GitHub profile exists, but the specified repository could not be found. It may be private, misspelled, or doesn't exist.",
          });
        } else if (stderr.includes("403") || stderr.includes("rate limit")) {
          return res.status(403).json({
            error: "GitHub API rate limit exceeded",
            details:
              "We've reached the limit for GitHub API requests. Please try again later or use a GitHub token for authentication.",
          });
        } else if (stderr.includes("Invalid GitHub repository")) {
          return res.status(400).json({
            error: "Invalid GitHub repository URL format",
            details: "Please use the format: https://github.com/username/repo",
          });
        }

        // Generic error message for other errors
        return res.status(500).json({
          error: "Error generating README",
          details:
            "The Python script failed to execute properly. Please try again or try with a different repository.",
        });
      }

      console.log(`Python script output: ${stdout}`);

      // Parse the output to get the README path
      let readmePath = stdout.trim();

      // Extract just the filepath from potential additional output
      const pathMatch = readmePath.match(/README saved to: (.+\.md)/);
      if (pathMatch && pathMatch[1]) {
        readmePath = pathMatch[1];
      }

      console.log(`Extracted README path: ${readmePath}`);

      // Read the generated README file
      let readmeContent;
      try {
        readmeContent = fs.readFileSync(readmePath, "utf8");
      } catch (readErr) {
        console.error(
          `Error reading file at ${readmePath}: ${readErr.message}`
        );

        // Try to find the README in the standard location
        try {
          // Try to parse the repository name from the URL
          const [owner, repo] = parseRepoUrl(repoUrl);
          const standardPath = path.resolve(
            __dirname,
            "README_FOLDER",
            `${repo}.md`
          );
          console.log(`Trying standard path: ${standardPath}`);
          readmeContent = fs.readFileSync(standardPath, "utf8");
        } catch (fallbackErr) {
          console.error(`Fallback path also failed: ${fallbackErr.message}`);
          return res.status(500).json({
            error: "Could not read generated README file",
            details:
              "The README was generated but could not be read from disk.",
          });
        }
      }

      // Clean the README content before sending to client
      readmeContent = cleanReadmeContent(readmeContent);

      // Return the README content to the frontend
      res.json({
        readme: readmeContent,
        type: "with-callgraph",
      });
    } catch (execError) {
      console.error(`Error executing Python script: ${execError.message}`);

      // Try to extract useful information from stderr if available
      if (execError.stderr) {
        console.error(`Python stderr: ${execError.stderr}`);

        if (
          execError.stderr.includes("404") ||
          execError.stderr.includes("Not Found") ||
          execError.stderr.includes("Repository not found")
        ) {
          return res.status(404).json({
            error: "Repository not found",
            details:
              "The GitHub profile exists, but the specified repository could not be found. It may be private, misspelled, or doesn't exist.",
          });
        } else if (
          execError.stderr.includes("403") ||
          execError.stderr.includes("rate limit")
        ) {
          return res.status(403).json({
            error: "GitHub API rate limit exceeded",
            details:
              "We've reached the limit for GitHub API requests. Please try again later.",
          });
        }
      }

      return res.status(500).json({
        error: "Error generating README",
        details:
          "There was a problem executing the Python script. Please try again later or with a different repository.",
      });
    }
  } catch (error) {
    console.error(`Error generating README: ${error.message}`);
    res.status(500).json({
      error: "Error generating README",
      details: "There was an unexpected error processing your request.",
    });
  }
});

// Fixed endpoint to fetch all Python files in a repository
expressApp.post("/fetch-python-files", async (req, res) => {
  const repoUrl = req.body.repo_url;
  if (!repoUrl) {
    return res.status(400).json({
      error: "Please enter a valid GitHub repository URL.",
      details: "The URL field cannot be empty.",
    });
  }

  try {
    // Validate URL format before proceeding
    try {
      parseRepoUrl(repoUrl);
    } catch (parseError) {
      return res.status(400).json({
        error: parseError.message,
        details: "Please check the URL and try again.",
      });
    }

    // Get the absolute path to the Python script
    const pythonScriptPath = path.resolve(__dirname, "comments.py");

    // Execute the Python script with the list-files flag
    const command = `python "${pythonScriptPath}" "${repoUrl}" --list-files`;
    // const command = `python3 "${pythonScriptPath}" "${repoUrl}" --list-files`;
    console.log(`Executing command: ${command}`);

    try {
      const { stdout, stderr } = await execPromise(command);

      // Check for specific error patterns in stderr
      if (stderr) {
        console.log(`Python script stderr: ${stderr}`);

        // Check for specific repository not found errors
        if (
          stderr.includes("Repository not found") ||
          stderr.includes("404") ||
          stderr.includes("Not Found")
        ) {
          return res.status(404).json({
            error: "Repository not found.",
            details:
              "The repository might be private or doesn't exist. Please check the URL and try again.",
          });
        }

        // Check for rate limit errors
        if (stderr.includes("rate limit") || stderr.includes("403")) {
          return res.status(403).json({
            error: "GitHub API rate limit exceeded.",
            details:
              "Please try again later or use a GitHub token for authentication.",
          });
        }
      }

      // Parse the output to get the Python files
      try {
        // Make sure we're parsing a non-empty string that starts with a [
        const trimmedOutput = stdout.trim();
        if (!trimmedOutput || !trimmedOutput.startsWith("[")) {
          console.error(`Invalid JSON output: ${trimmedOutput}`);

          // Handle no Python files case
          if (
            trimmedOutput.includes("No Python files found") ||
            trimmedOutput === "[]"
          ) {
            return res.status(404).json({
              error: "No Python files found in this repository.",
              details:
                "The repository exists but doesn't contain any Python files.",
            });
          }

          return res.status(500).json({
            error: "Failed to retrieve Python files",
            details:
              "The repository might be private, empty, or doesn't exist.",
          });
        }

        // The Python script should return a JSON string of file paths
        const pythonFiles = JSON.parse(trimmedOutput);
        if (pythonFiles.length === 0) {
          return res.status(404).json({
            error: "No Python files found in this repository.",
            details:
              "The repository exists but doesn't contain any Python files.",
          });
        }
        return res.json({ files: pythonFiles });
      } catch (parseErr) {
        console.error(`Error parsing Python files list: ${parseErr}`);
        return res.status(500).json({
          error: "Failed to parse the list of Python files",
          details: "There was an issue processing the repository data.",
        });
      }
    } catch (execError) {
      console.error(`Error executing Python script: ${execError.message}`);

      // Check stderr for specific error messages
      if (execError.stderr) {
        if (
          execError.stderr.includes("Repository not found") ||
          execError.stderr.includes("404") ||
          execError.stderr.includes("Not Found")
        ) {
          return res.status(404).json({
            error: "Repository not found.",
            details:
              "The repository might be private or doesn't exist. Please check the URL and try again.",
          });
        }

        if (execError.stderr.includes("Invalid GitHub repository")) {
          return res.status(400).json({
            error: "Invalid GitHub repository URL format.",
            details: "Please use the format: https://github.com/owner/repo",
          });
        }
      }

      // Generic error message for other errors
      return res.status(500).json({
        error: "Error fetching Python files",
        details:
          "There was a problem accessing the repository. Please ensure it exists and is public.",
      });
    }
  } catch (error) {
    console.error(`Error fetching Python files: ${error.message}`);
    res.status(500).json({
      error: "Error fetching Python files",
      details: "There was an unexpected error processing your request.",
    });
  }
});

// Modified endpoint for generating code comments with better error handling
expressApp.post("/generate-comments", async (req, res) => {
  const repoUrl = req.body.repo_url;
  const filePath = req.body.file_path; // New parameter for selected file

  if (!repoUrl) {
    return res.status(400).json({
      error: "Please enter a valid GitHub repository URL.",
      details: "The URL field cannot be empty.",
    });
  }

  // Log the request details for debugging
  console.log(
    `Generating comments for repo: ${repoUrl}, file: ${filePath || "default"}`
  );

  try {
    // Validate URL format before proceeding
    try {
      parseRepoUrl(repoUrl);
    } catch (parseError) {
      return res.status(400).json({
        error: parseError.message,
        details: "Please check the URL and try again.",
      });
    }

    // Get the absolute path to the Python script
    const pythonScriptPath = path.resolve(__dirname, "comments.py");
    console.log(`Using Comments Python script at: ${pythonScriptPath}`);

    // Make sure COMMENTED_CODE directory exists
    const commentsFolder = path.resolve(__dirname, "COMMENTED_CODE");
    if (!fs.existsSync(commentsFolder)) {
      fs.mkdirSync(commentsFolder, { recursive: true });
      console.log(`Created comments folder: ${commentsFolder}`);
    }

    // Execute the Python script with the repository URL and specific file path
    let command = `python "${pythonScriptPath}" "${repoUrl}"`;
    // let command = `python3 "${pythonScriptPath}" "${repoUrl}"`;
    if (filePath) {
      // Make sure to properly escape the file path
      command += ` --file "${filePath}"`;
    }
    console.log(`Executing command: ${command}`);

    try {
      const { stdout, stderr } = await execPromise(command);

      // Log all output for debugging
      if (stderr) {
        console.log(`Python script stderr: ${stderr}`);
      }
      console.log(`Python script stdout: ${stdout}`);

      // Check if there's an error message in stdout (Python might print error to stdout)
      if (
        stdout.includes("Error generating comments:") ||
        stdout.includes("Error:")
      ) {
        console.error(`Python script reported error in stdout: ${stdout}`);
        return res.status(500).json({ error: stdout.trim() });
      }

      // Check if there's an error in stderr that's not just a warning
      if (
        stderr &&
        !stderr.includes("WARNING") &&
        (stderr.includes("Error:") || stderr.includes("Exception:"))
      ) {
        console.error(`Python script error: ${stderr}`);
        return res
          .status(500)
          .json({ error: `Error generating comments: ${stderr}` });
      }

      // Parse the output to get the commented code file path
      let outputPath = stdout.trim();

      // Extract just the filepath from potential additional output
      const pathMatch = outputPath.match(/Commented code saved to: (.+)/);
      if (pathMatch && pathMatch[1]) {
        outputPath = pathMatch[1];
        console.log(`Matched output path from stdout: ${outputPath}`);
      } else {
        console.log("No path match found in stdout");
      }

      // Read the generated commented code file
      let commentedCode;
      let filename;

      try {
        // Try to read the file directly if we have a path
        if (outputPath && fs.existsSync(outputPath)) {
          console.log(`Reading output file: ${outputPath}`);
          commentedCode = fs.readFileSync(outputPath, "utf8");
          filename = path.basename(outputPath);
          console.log(`Successfully read commented file: ${filename}`);
        } else {
          // If we don't have a valid output path, look for a file with the expected name pattern
          const expectedFilename = filePath
            ? `commented_${path.basename(filePath)}`
            : null;

          console.log(
            `Looking for file with expected name: ${
              expectedFilename || "any commented_*.py"
            }`
          );

          // Create the comments folder if it doesn't exist yet
          if (!fs.existsSync(commentsFolder)) {
            fs.mkdirSync(commentsFolder, { recursive: true });
          }

          // Look in the COMMENTED_CODE folder
          const files = fs.readdirSync(commentsFolder);
          console.log(`Found files in folder: ${files.join(", ")}`);

          // First try to find a file that matches our specific file
          let commentedFiles = [];

          if (expectedFilename) {
            commentedFiles = files.filter((file) => file === expectedFilename);
            console.log(`Looking for exact match: ${expectedFilename}`);
          }

          // If no specific match, try a partial match
          if (commentedFiles.length === 0 && filePath) {
            const baseName = path.basename(filePath);
            commentedFiles = files.filter(
              (file) => file.startsWith("commented_") && file.includes(baseName)
            );
            console.log(`Looking for partial match: commented_*${baseName}*`);
          }

          // If still no match, fall back to any commented_*.py file
          if (commentedFiles.length === 0) {
            commentedFiles = files.filter(
              (file) => file.startsWith("commented_") && file.endsWith(".py")
            );
            console.log(`Falling back to any commented_*.py file`);
          }

          if (commentedFiles.length > 0) {
            // Sort by modification time to get the most recent file
            const fileStats = commentedFiles.map((file) => ({
              name: file,
              mtime: fs.statSync(path.join(commentsFolder, file)).mtime,
            }));

            fileStats.sort((a, b) => b.mtime - a.mtime);
            const mostRecentFile = fileStats[0].name;

            const fallbackPath = path.resolve(commentsFolder, mostRecentFile);
            console.log(`Using most recent file: ${fallbackPath}`);

            commentedCode = fs.readFileSync(fallbackPath, "utf8");
            filename = mostRecentFile;

            // Check if this is the correct file based on the request
            if (filePath && !filename.includes(path.basename(filePath))) {
              console.warn(
                `Warning: Returned file ${filename} doesn't match requested file ${filePath}`
              );
            }
          } else {
            throw new Error("No commented files found");
          }
        }
      } catch (readErr) {
        console.error(`Error reading commented file: ${readErr.message}`);
        return res.status(500).json({
          error: "Could not read the generated comments file",
          details: readErr.message,
        });
      }

      // Return the commented code content to the frontend
      res.json({
        commented_code: commentedCode,
        filename: filename,
        originalPath: filePath || "default",
      });
    } catch (execError) {
      console.error(`Error executing Python script: ${execError.message}`);
      // Check if it's a spawn error or if we have stderr output
      if (execError.stderr) {
        console.error(`Python stderr: ${execError.stderr}`);
      }
      return res.status(500).json({
        error: `Error generating comments: ${execError.message}`,
        details:
          execError.stderr || "The Python script failed to execute properly.",
      });
    }
  } catch (error) {
    console.error(`Error generating comments: ${error.message}`);
    res.status(500).json({
      error: `Error generating comments: ${error.message}`,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Endpoint for generating callgraphs
expressApp.post("/generate-callgraph", async (req, res) => {
  const repoUrl = req.body.repo_url;
  if (!repoUrl) {
    return res.status(400).json({
      error: "Please enter a valid GitHub repository URL.",
      details: "The URL field cannot be empty.",
    });
  }

  try {
    // Validate URL format before proceeding
    try {
      parseRepoUrl(repoUrl);
    } catch (parseError) {
      return res.status(400).json({
        error: parseError.message,
        details: "Please check the URL and try again.",
      });
    }

    const [owner, repo] = parseRepoUrl(repoUrl);

    // Get the absolute path to the Python script
    const pythonScriptPath = path.resolve(__dirname, "generate_callgraph.py");
    console.log(`Using Callgraph Python script at: ${pythonScriptPath}`);

    // Create the output directory if it doesn't exist
    // Use the exact folder path as specified
    // const outputDir = "/Users/malaikahussain/Documents/Semester08/FYP2/pre-jobfair/Sample-App-FYP/CallGraphs_Folder";
    const outputDir =
      "C:/Users/dell/Documents/7th Semester/FYP/Sample-App-FYP/CALLGRAPHS_FOLDER";
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`Created callgraphs folder: ${outputDir}`);
    }

    // Use simple naming convention - just the repo name as requested
    const outputFilename = `${repo}.dot`;
    const outputPath = path.join(outputDir, outputFilename);

    // Execute the Python script with the repository URL and output file
    const command = `python "${pythonScriptPath}" --single-repo "${repoUrl}" --output "${outputDir}"`;
    // const command = `python3 "${pythonScriptPath}" --single-repo "${repoUrl}" --output "${outputDir}"`;
    console.log(`Executing command: ${command}`);

    try {
      // Add option to suppress warnings when executing Python
      const execOptions = {
        env: { ...process.env, PYTHONWARNINGS: "ignore" },
      };

      const { stdout, stderr } = await execPromise(command, execOptions);

      // Only treat actual errors (not warnings) as errors
      if (
        stderr &&
        !stderr.includes("WARNING") &&
        !stderr.includes("SyntaxWarning") &&
        !stderr.includes("invalid escape sequence")
      ) {
        console.error(`Python script error: ${stderr}`);
        return res.status(500).json({
          error: "Error generating callgraph",
          details: "There was a problem processing your repository.",
        });
      }

      // Log warnings only to the server console, not to the client
      if (stderr) {
        console.log(`Python script warnings (not shown to user): ${stderr}`);
      }

      console.log(`Python script output: ${stdout}`);

      // Since the Python script generates the DOT file, we check if it exists
      const dotFiles = fs
        .readdirSync(outputDir)
        .filter((file) => file.startsWith(repo) && file.endsWith(".dot"));

      if (dotFiles.length > 0) {
        // Sort by modification time to get the most recent
        const mostRecentFile = dotFiles.sort((a, b) => {
          return (
            fs.statSync(path.join(outputDir, b)).mtime.getTime() -
            fs.statSync(path.join(outputDir, a)).mtime.getTime()
          );
        })[0];

        const filePath = path.join(outputDir, mostRecentFile);

        // Return success message with just the filename, not the full path
        return res.json({
          success: true,
          filename: mostRecentFile,
          message: `Callgraph for ${owner}/${repo} has been generated successfully!`,
        });
      } else {
        return res.status(500).json({
          error: "Callgraph file not found",
          details:
            "The callgraph was generated but the output file was not found.",
        });
      }
    } catch (execError) {
      console.error(`Error executing Python script: ${execError.message}`);
      return res.status(500).json({
        error: "Error generating callgraph",
        details:
          execError.stderr || "The Python script failed to execute properly.",
      });
    }
  } catch (error) {
    console.error(`Error generating callgraph: ${error.message}`);
    res.status(500).json({
      error: "Error generating callgraph",
      details: "There was an unexpected error processing your request.",
    });
  }
});

// Endpoint for generating README with call graph
expressApp.post("/generate-readme-with-callgraph", async (req, res) => {
  const repoUrl = req.body.repo_url;
  if (!repoUrl) {
    return res.status(400).json({
      error: "Please enter a valid GitHub repository URL.",
      details: "The URL field cannot be empty.",
    });
  }

  try {
    // Validate URL format before proceeding
    try {
      parseRepoUrl(repoUrl);
    } catch (parseError) {
      return res.status(400).json({
        error: parseError.message,
        details: "Please check the URL and try again.",
      });
    }

    // Get the absolute path to the Python script using path.resolve
    const pythonScriptPath = path.resolve(__dirname, "readme_generator.py");
    console.log(`Using Python script at: ${pythonScriptPath}`);

    // Use proper quotes around paths to handle spaces in directory names
    const command = `python "${pythonScriptPath}" "${repoUrl}"`;
    // const command = `python3 "${pythonScriptPath}" "${repoUrl}"`;
    console.log(`Executing command: ${command}`);

    try {
      const { stdout, stderr } = await execPromise(command);

      // Check if there's an error in stderr
      if (stderr) {
        console.error(`Python script error: ${stderr}`);

        // Handle repository not found errors with a user-friendly message
        if (
          stderr.includes("404") ||
          stderr.includes("Not Found") ||
          stderr.includes("Repository not found")
        ) {
          return res.status(404).json({
            error: "Repository not found",
            details:
              "The GitHub profile exists, but the specified repository could not be found. It may be private, misspelled, or doesn't exist.",
          });
        } else if (stderr.includes("403") || stderr.includes("rate limit")) {
          return res.status(403).json({
            error: "GitHub API rate limit exceeded",
            details:
              "We've reached the limit for GitHub API requests. Please try again later or use a GitHub token for authentication.",
          });
        } else if (stderr.includes("Invalid GitHub repository")) {
          return res.status(400).json({
            error: "Invalid GitHub repository URL format",
            details: "Please use the format: https://github.com/username/repo",
          });
        }

        // Generic error message for other errors
        return res.status(500).json({
          error: "Error generating README",
          details:
            "The Python script failed to execute properly. Please try again or try with a different repository.",
        });
      }

      console.log(`Python script output: ${stdout}`);

      // Parse the output to get the README path
      let readmePath = stdout.trim();

      // Extract just the filepath from potential additional output
      const pathMatch = readmePath.match(/README saved to: (.+\.md)/);
      if (pathMatch && pathMatch[1]) {
        readmePath = pathMatch[1];
      }

      console.log(`Extracted README path: ${readmePath}`);

      // Read the generated README file
      let readmeContent;
      try {
        readmeContent = fs.readFileSync(readmePath, "utf8");
      } catch (readErr) {
        console.error(
          `Error reading file at ${readmePath}: ${readErr.message}`
        );

        // Try to find the README in the standard location
        try {
          // Try to parse the repository name from the URL
          const [owner, repo] = parseRepoUrl(repoUrl);
          const standardPath = path.resolve(
            __dirname,
            "README_FOLDER",
            `${repo}.md`
          );
          console.log(`Trying standard path: ${standardPath}`);
          readmeContent = fs.readFileSync(standardPath, "utf8");
        } catch (fallbackErr) {
          console.error(`Fallback path also failed: ${fallbackErr.message}`);
          return res.status(500).json({
            error: "Could not read generated README file",
            details:
              "The README was generated but could not be read from disk.",
          });
        }
      }

      // Clean the README content before sending to client
      readmeContent = cleanReadmeContent(readmeContent);

      // Return the README content to the frontend
      res.json({
        readme: readmeContent,
        type: "with-callgraph",
      });
    } catch (execError) {
      console.error(`Error executing Python script: ${execError.message}`);

      // Try to extract useful information from stderr if available
      if (execError.stderr) {
        console.error(`Python stderr: ${execError.stderr}`);

        if (
          execError.stderr.includes("404") ||
          execError.stderr.includes("Not Found") ||
          execError.stderr.includes("Repository not found")
        ) {
          return res.status(404).json({
            error: "Repository not found",
            details:
              "The GitHub profile exists, but the specified repository could not be found. It may be private, misspelled, or doesn't exist.",
          });
        } else if (
          execError.stderr.includes("403") ||
          execError.stderr.includes("rate limit")
        ) {
          return res.status(403).json({
            error: "GitHub API rate limit exceeded",
            details:
              "We've reached the limit for GitHub API requests. Please try again later.",
          });
        }
      }

      return res.status(500).json({
        error: "Error generating README",
        details:
          "There was a problem executing the Python script. Please try again later or with a different repository.",
      });
    }
  } catch (error) {
    console.error(`Error generating README: ${error.message}`);
    res.status(500).json({
      error: "Error generating README",
      details: "There was an unexpected error processing your request.",
    });
  }
});

// Endpoint for generating README without call graph (simple README)
expressApp.post("/generate-readme-without-callgraph", async (req, res) => {
  const repoUrl = req.body.repo_url;
  if (!repoUrl) {
    return res.status(400).json({
      error: "Please enter a valid GitHub repository URL.",
      details: "The URL field cannot be empty.",
    });
  }

  try {
    // Validate URL format before proceeding
    try {
      parseRepoUrl(repoUrl);
    } catch (parseError) {
      return res.status(400).json({
        error: parseError.message,
        details: "Please check the URL and try again.",
      });
    }

    // Get the absolute path to the Python script using path.resolve
    const pythonScriptPath = path.resolve(__dirname, "readme_generator.py");
    console.log(`Using Python script at: ${pythonScriptPath}`);

    // Add the --simple flag to generate a simple README without call graph
    const command = `python "${pythonScriptPath}" "${repoUrl}" --simple`;
    // const command = `python3 "${pythonScriptPath}" "${repoUrl}" --simple`;
    console.log(`Executing command: ${command}`);

    try {
      const { stdout, stderr } = await execPromise(command);

      // Check if there's an error in stderr
      if (stderr) {
        console.error(`Python script error: ${stderr}`);

        // Handle repository not found errors with a user-friendly message
        if (
          stderr.includes("404") ||
          stderr.includes("Not Found") ||
          stderr.includes("Repository not found")
        ) {
          return res.status(404).json({
            error: "Repository not found",
            details:
              "The GitHub profile exists, but the specified repository could not be found. It may be private, misspelled, or doesn't exist.",
          });
        } else if (stderr.includes("403") || stderr.includes("rate limit")) {
          return res.status(403).json({
            error: "GitHub API rate limit exceeded",
            details:
              "We've reached the limit for GitHub API requests. Please try again later or use a GitHub token for authentication.",
          });
        } else if (stderr.includes("Invalid GitHub repository")) {
          return res.status(400).json({
            error: "Invalid GitHub repository URL format",
            details: "Please use the format: https://github.com/username/repo",
          });
        }

        // Generic error message for other errors
        return res.status(500).json({
          error: "Error generating README",
          details:
            "The Python script failed to execute properly. Please try again or try with a different repository.",
        });
      }

      console.log(`Python script output: ${stdout}`);

      // Parse the output to get the README path
      let readmePath = stdout.trim();

      // Extract just the filepath from potential additional output
      const pathMatch = readmePath.match(/README saved to: (.+\.md)/);
      if (pathMatch && pathMatch[1]) {
        readmePath = pathMatch[1];
      }

      console.log(`Extracted README path: ${readmePath}`);

      // Read the generated README file
      let readmeContent;
      try {
        readmeContent = fs.readFileSync(readmePath, "utf8");
      } catch (readErr) {
        console.error(
          `Error reading file at ${readmePath}: ${readErr.message}`
        );

        // Try to find the README in the standard location
        try {
          // Try to parse the repository name from the URL
          const [owner, repo] = parseRepoUrl(repoUrl);
          const standardPath = path.resolve(
            __dirname,
            "README_FOLDER",
            `simple_${repo}.md`
          );
          console.log(`Trying standard path: ${standardPath}`);
          readmeContent = fs.readFileSync(standardPath, "utf8");
        } catch (fallbackErr) {
          console.error(`Fallback path also failed: ${fallbackErr.message}`);
          return res.status(500).json({
            error: "Could not read generated README file",
            details:
              "The README was generated but could not be read from disk.",
          });
        }
      }

      // Clean the README content before sending to client
      readmeContent = cleanReadmeContent(readmeContent);

      // Return the README content to the frontend
      res.json({
        readme: readmeContent,
        type: "without-callgraph",
      });
    } catch (execError) {
      console.error(`Error executing Python script: ${execError.message}`);

      // Try to extract useful information from stderr if available
      if (execError.stderr) {
        console.error(`Python stderr: ${execError.stderr}`);

        if (
          execError.stderr.includes("404") ||
          execError.stderr.includes("Not Found") ||
          execError.stderr.includes("Repository not found")
        ) {
          return res.status(404).json({
            error: "Repository not found",
            details:
              "The GitHub profile exists, but the specified repository could not be found. It may be private, misspelled, or doesn't exist.",
          });
        } else if (
          execError.stderr.includes("403") ||
          execError.stderr.includes("rate limit")
        ) {
          return res.status(403).json({
            error: "GitHub API rate limit exceeded",
            details:
              "We've reached the limit for GitHub API requests. Please try again later.",
          });
        }
      }

      return res.status(500).json({
        error: "Error generating README",
        details:
          "There was a problem executing the Python script. Please try again later or with a different repository.",
      });
    }
  } catch (error) {
    console.error(`Error generating README: ${error.message}`);
    res.status(500).json({
      error: "Error generating README",
      details: "There was an unexpected error processing your request.",
    });
  }
});

// Add this new endpoint to app.js to serve callgraph files for download
expressApp.get("/download-callgraph", (req, res) => {
  const filename = req.query.filename;

  if (!filename) {
    return res.status(400).json({
      error: "Filename is required",
      details: "Please provide a valid filename",
    });
  }

  // Validate the filename to prevent directory traversal
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return res.status(400).json({
      error: "Invalid filename",
      details: "The filename contains invalid characters",
    });
  }

  // Set the path to the callgraph file
  const callgraphsFolder =
    "C:/Users/dell/Documents/7th Semester/FYP/Sample-App-FYP/CALLGRAPHS_FOLDER";
  const filePath = path.join(callgraphsFolder, filename);

  // Check if the file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: "File not found",
      details: "The requested callgraph file does not exist",
    });
  }

  // Set the appropriate content type for a DOT file
  res.setHeader("Content-Type", "text/vnd.graphviz");

  // Set Content-Disposition header to prompt download
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  // Send the file
  res.sendFile(filePath);
});

// Add this new endpoint to app.js to check if required analysis files exist
expressApp.post("/check-analysis-files", async (req, res) => {
  const repoUrl = req.body.repo_url;

  if (!repoUrl) {
    return res.status(400).json({
      error: "Please enter a valid GitHub repository URL.",
      details: "The URL field cannot be empty.",
    });
  }

  try {
    // Parse the repository URL to get the owner and repo name
    const [owner, repo] = parseRepoUrl(repoUrl);

    // Check if the required analysis files exist
    const repoAnalysisPath = path.resolve(
      __dirname,
      "REPO_ANALYSIS_FOLDER",
      `${repo}.json`
    );
    const functionSummariesPath = path.resolve(
      __dirname,
      "FUNCTION_SUMMARIES_FOLDER",
      `${repo}.json`
    );
    const callgraphPath = path.resolve(
      __dirname,
      "CALLGRAPHS_FOLDER",
      `${repo}.dot`
    );

    const analysisExists = fs.existsSync(repoAnalysisPath);
    const summariesExist = fs.existsSync(functionSummariesPath);
    const callgraphExists = fs.existsSync(callgraphPath);

    // Return the status of the analysis files
    res.json({
      analysisExists: analysisExists || summariesExist || callgraphExists,
      files: {
        repoAnalysis: analysisExists,
        functionSummaries: summariesExist,
        callgraph: callgraphExists,
      },
    });
  } catch (error) {
    console.error(`Error checking analysis files: ${error.message}`);
    res.status(500).json({
      error: "Error checking analysis files",
      details: "There was an unexpected error processing your request.",
    });
  }
});

// Add this new endpoint to app.js
expressApp.post("/run-codet5-inference", async (req, res) => {
  const repoUrl = req.body.repo_url;
  if (!repoUrl) {
    return res.status(400).json({
      error: "Please enter a valid GitHub repository URL.",
      details: "The URL field cannot be empty.",
    });
  }

  try {
    // Validate URL format before proceeding
    try {
      parseRepoUrl(repoUrl);
    } catch (parseError) {
      return res.status(400).json({
        error: parseError.message,
        details: "Please check the URL and try again.",
      });
    }

    const [owner, repo] = parseRepoUrl(repoUrl);
    console.log(`Running CodeT5 inference for ${owner}/${repo}`);

    // Create output directories if they don't exist
    console.log("Creating output directories if they don't exist");
    const functionSummariesDir = path.resolve(
      __dirname,
      "FUNCTION_SUMMARIES_FOLDER"
    );
    const callgraphsDir = path.resolve(__dirname, "CALLGRAPHS_FOLDER");
    const repoAnalysisDir = path.resolve(__dirname, "REPO_ANALYSIS_FOLDER");

    // Create all required directories
    [functionSummariesDir, callgraphsDir, repoAnalysisDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        console.log(`Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      } else {
        console.log(`Directory already exists: ${dir}`);
      }
    });

    // Variables to track execution success
    let analyzerSuccess = false;
    let callgraphSuccess = false;
    let functionSummaries = null;

    // First run repo_analyzer.py
    try {
      console.log("Starting repo_analyzer.py execution...");
      const analyzerCommand = `python repo_analyzer.py "${repoUrl}" --output-dir "${functionSummariesDir}" --analysis-dir "${repoAnalysisDir}"`;
      console.log(`Executing command: ${analyzerCommand}`);

      const { stdout: analyzerStdout, stderr: analyzerStderr } =
        await execPromise(analyzerCommand);

      console.log(`repo_analyzer.py stdout: ${analyzerStdout}`);
      if (analyzerStderr) {
        console.log(`repo_analyzer.py stderr: ${analyzerStderr}`);
      }

      analyzerSuccess = true;
    } catch (analyzerError) {
      console.error(`Error running repo_analyzer.py: ${analyzerError.message}`);
      if (analyzerError.stderr) {
        console.error(`Python stderr: ${analyzerError.stderr}`);
      }
    }

    // Then run generate_callgraph.py (even if the analyzer failed)
    try {
      console.log("Starting generate_callgraph.py execution...");
      const callgraphCommand = `python generate_callgraph.py --single-repo "${repoUrl}" --output "${callgraphsDir}"`;
      console.log(`Executing command: ${callgraphCommand}`);

      const { stdout: callgraphStdout, stderr: callgraphStderr } =
        await execPromise(callgraphCommand);

      console.log(`generate_callgraph.py stdout: ${callgraphStdout}`);
      if (callgraphStderr) {
        console.log(`generate_callgraph.py stderr: ${callgraphStderr}`);
      }

      callgraphSuccess = true;
    } catch (callgraphError) {
      console.error(
        `Error running generate_callgraph.py: ${callgraphError.message}`
      );
      if (callgraphError.stderr) {
        console.error(`Python stderr: ${callgraphError.stderr}`);
      }
    }

    // Determine output paths for the frontend to display
    const functionSummariesPath = path.join(
      functionSummariesDir,
      `${repo}.json`
    );
    const callgraphPath = path.join(callgraphsDir, `${repo}.dot`);

    // Check if output files exist
    const functionSummariesExist = fs.existsSync(functionSummariesPath);
    const callgraphExists = fs.existsSync(callgraphPath);

    if (functionSummariesExist) {
      try {
        const summariesData = fs.readFileSync(functionSummariesPath, "utf8");
        functionSummaries = JSON.parse(summariesData);
      } catch (readErr) {
        console.error(`Error reading function summaries: ${readErr}`);
      }
    }

    // Return results based on what succeeded
    return res.json({
      success: analyzerSuccess || callgraphSuccess,
      message:
        analyzerSuccess && callgraphSuccess
          ? "Code analysis and call graph generation completed successfully!"
          : "Partial success: Some components couldn't be generated.",
      repo_name: repo,
      results: {
        function_summaries_path: functionSummariesExist
          ? functionSummariesPath
          : null,
        function_summaries: functionSummaries,
        callgraph_path: callgraphExists ? `${repo}.dot` : null,
      },
    });
  } catch (error) {
    console.error(`Error in run-codet5-inference: ${error.message}`);
    res.status(500).json({
      error: "Error running CodeT5 inference",
      details: "There was an unexpected error processing your request.",
    });
  }
});

// Add this new endpoint to app.js for generating README with Llama inference
expressApp.post("/run-llama-inference", async (req, res) => {
  const repoUrl = req.body.repo_url;
  const hfToken = process.env.HUGGINGFACE_TOKEN || ""; // Make sure to set this in your .env file

  if (!repoUrl) {
    return res.status(400).json({
      error: "Please enter a valid GitHub repository URL.",
      details: "The URL field cannot be empty.",
    });
  }

  try {
    // Validate URL format before proceeding
    try {
      parseRepoUrl(repoUrl);
    } catch (parseError) {
      return res.status(400).json({
        error: parseError.message,
        details: "Please check the URL and try again.",
      });
    }

    const [owner, repo] = parseRepoUrl(repoUrl);
    console.log(`Running Llama inference for ${owner}/${repo}`);

    // Check that required analysis files exist before proceeding
    const repoAnalysisPath = path.resolve(
      __dirname,
      "REPO_ANALYSIS_FOLDER",
      `${repo}.json`
    );
    const functionSummariesPath = path.resolve(
      __dirname,
      "FUNCTION_SUMMARIES_FOLDER",
      `${repo}.json`
    );
    const callgraphPath = path.resolve(
      __dirname,
      "CALLGRAPHS_FOLDER",
      `${repo}.dot`
    );

    // Verify that at least one of the required analysis files exists
    const analysisExists = fs.existsSync(repoAnalysisPath);
    const summariesExist = fs.existsSync(functionSummariesPath);
    const callgraphExists = fs.existsSync(callgraphPath);

    if (!analysisExists && !summariesExist && !callgraphExists) {
      return res.status(400).json({
        error: "Required analysis data not found",
        details:
          "Please run CodeT5 inference first to generate the necessary analysis files.",
      });
    }

    // Get the absolute path to the Python script for Llama inference
    const pythonScriptPath = path.resolve(__dirname, "llama_inference.py");
    console.log(`Using Llama inference script at: ${pythonScriptPath}`);

    // Create README_FOLDER directory if it doesn't exist
    const readmeFolder = path.resolve(__dirname, "README_FOLDER");
    if (!fs.existsSync(readmeFolder)) {
      fs.mkdirSync(readmeFolder, { recursive: true });
      console.log(`Created README folder: ${readmeFolder}`);
    }

    // Execute the Python script for Llama inference
    const command = `python "${pythonScriptPath}" "${repoUrl}" --token "${hfToken}"`;
    console.log(`Executing command: ${command}`);

    try {
      const { stdout, stderr } = await execPromise(command);

      // Check if there's an error in stderr
      if (stderr && !stderr.includes("WARNING") && !stderr.includes("NOTICE")) {
        console.error(`Python script error: ${stderr}`);

        // Generic error message for stderr
        return res.status(500).json({
          error: "Error generating README with Llama",
          details:
            stderr ||
            "The Python script encountered an error during execution.",
        });
      }

      console.log(`Python script output: ${stdout}`);

      // Parse the output to get the README path
      let readmePath = stdout.trim();

      // Extract just the filepath from potential additional output
      const pathMatch = readmePath.match(/README saved to: (.+\.md)/);
      if (pathMatch && pathMatch[1]) {
        readmePath = pathMatch[1];
      }

      console.log(`Extracted README path: ${readmePath}`);

      // Read the generated README file
      let readmeContent;
      try {
        readmeContent = fs.readFileSync(readmePath, "utf8");
      } catch (readErr) {
        console.error(
          `Error reading file at ${readmePath}: ${readErr.message}`
        );

        // Try to find the README in the standard location
        try {
          const standardPath = path.resolve(
            __dirname,
            "README_FOLDER",
            `llama_${repo}.md`
          );
          console.log(`Trying standard path: ${standardPath}`);
          readmeContent = fs.readFileSync(standardPath, "utf8");
        } catch (fallbackErr) {
          console.error(`Fallback path also failed: ${fallbackErr.message}`);
          return res.status(500).json({
            error: "Could not read generated README file",
            details:
              "The README was generated but could not be read from disk.",
          });
        }
      }

      // Clean the README content before sending to client
      readmeContent = cleanReadmeContent(readmeContent);

      // Return the README content to the frontend
      res.json({
        readme: readmeContent,
        type: "llama-inference",
      });
    } catch (execError) {
      console.error(`Error executing Python script: ${execError.message}`);

      // Try to extract useful information from stderr if available
      if (execError.stderr) {
        console.error(`Python stderr: ${execError.stderr}`);
      }

      return res.status(500).json({
        error: "Error generating README with Llama",
        details:
          execError.stderr ||
          "There was a problem executing the Python script. Please try again later.",
      });
    }
  } catch (error) {
    console.error(`Error generating README with Llama: ${error.message}`);
    res.status(500).json({
      error: "Error generating README with Llama",
      details: "There was an unexpected error processing your request.",
    });
  }
});

// ADD THESE NEW ENDPOINTS before the parseRepoUrl function

// Add endpoint to check for pending updates
expressApp.get("/api/check-updates/:owner/:repo", (req, res) => {
  const repoFullName = `${req.params.owner}/${req.params.repo}`;
  const pendingUpdate = global.pendingUpdates?.[repoFullName];

  if (pendingUpdate) {
    res.json({
      hasPendingUpdate: true,
      update: pendingUpdate,
    });
  } else {
    res.json({
      hasPendingUpdate: false,
    });
  }
});

// Add endpoint to clear pending update after user responds
expressApp.post("/api/clear-update/:owner/:repo", (req, res) => {
  const repoFullName = `${req.params.owner}/${req.params.repo}`;
  if (global.pendingUpdates) {
    delete global.pendingUpdates[repoFullName];
  }
  res.json({ success: true });
});

// Add GitHub App installation endpoint
expressApp.get("/install", (req, res) => {
  const installationId = req.query.installation_id;
  const setupAction = req.query.setup_action;

  if (setupAction === "install") {
    // Redirect to your main app interface
    res.redirect(`/?installation_id=${installationId}`);
  } else {
    res.redirect("/");
  }
});

// REPLACE your existing /api/push-readme endpoint with this:
expressApp.post("/api/push-readme", async (req, res) => {
  const { repoUrl, readmeContent, installationId } = req.body;

  if (!repoUrl || !readmeContent || !installationId) {
    return res.status(400).json({
      error: "Repository URL, README content, and installation ID are required",
    });
  }

  try {
    const [owner, repo] = parseRepoUrl(repoUrl);
    console.log(
      `Pushing README to ${owner}/${repo} with installation ${installationId}`
    );

    // Get an authenticated Octokit instance for the installation
    const octokit = await app.getInstallationOctokit(parseInt(installationId));
    console.log("Octokit instance created successfully");

    // Check if README.md already exists
    let sha = null;
    try {
      const existingFile = await octokit.rest.repos.getContent({
        owner: owner,
        repo: repo,
        path: "README.md",
      });

      if (existingFile.data && !Array.isArray(existingFile.data)) {
        sha = existingFile.data.sha;
        console.log("Found existing README.md with SHA:", sha);
      }
    } catch (error) {
      if (error.status === 404) {
        console.log("README.md doesn't exist, will create new file");
      } else {
        console.error("Error checking for existing README:", error.message);
      }
    }

    // Create or update README.md
    const result = await octokit.rest.repos.createOrUpdateFileContents({
      owner: owner,
      repo: repo,
      path: "README.md",
      message: "Updated README.md with Code Narrator",
      content: Buffer.from(readmeContent).toString("base64"),
      sha: sha, // Include SHA if updating existing file
    });

    console.log("README pushed successfully:", result.data.commit.html_url);

    res.json({
      success: true,
      message: "README successfully pushed to GitHub!",
      commit_url: result.data.commit.html_url,
    });
  } catch (error) {
    console.error(`Error pushing README to GitHub:`, error);

    // Better error handling
    let errorMessage = error.message;
    if (error.status === 403) {
      errorMessage =
        "Permission denied. Make sure the GitHub App has write access to the repository.";
    } else if (error.status === 404) {
      errorMessage =
        "Repository not found or GitHub App is not installed on this repository.";
    }

    res.status(500).json({
      error: "Failed to push README to GitHub",
      details: errorMessage,
    });
  }
});

// Add endpoint to push commented code to GitHub
expressApp.post("/api/push-comments", async (req, res) => {
  const { repoUrl, commentedContent, filePath, installationId } = req.body;

  if (!repoUrl || !commentedContent || !filePath || !installationId) {
    return res.status(400).json({
      error:
        "Repository URL, commented content, file path, and installation ID are required",
    });
  }

  try {
    const [owner, repo] = parseRepoUrl(repoUrl);
    console.log(
      `Pushing commented file to ${owner}/${repo} at path ${filePath} with installation ${installationId}`
    );

    // Get an authenticated Octokit instance for the installation
    const octokit = await app.getInstallationOctokit(parseInt(installationId));
    console.log("Octokit instance created successfully");

    // Create the new file path with "commented_" prefix in the same directory
    const pathParts = filePath.split("/");
    const fileName = pathParts.pop();
    const directory = pathParts.length > 0 ? pathParts.join("/") + "/" : "";
    const newFilePath = `${directory}commented_${fileName}`;

    console.log(`Original file path: ${filePath}`);
    console.log(`New commented file path: ${newFilePath}`);

    // Check if the commented file already exists
    let sha = null;
    try {
      const existingFile = await octokit.rest.repos.getContent({
        owner: owner,
        repo: repo,
        path: newFilePath,
      });

      if (existingFile.data && !Array.isArray(existingFile.data)) {
        sha = existingFile.data.sha;
        console.log("Found existing commented file with SHA:", sha);
      }
    } catch (error) {
      if (error.status === 404) {
        console.log("Commented file doesn't exist, will create new file");
      } else {
        console.error(
          "Error checking for existing commented file:",
          error.message
        );
      }
    }

    // Create or update the commented file
    const result = await octokit.rest.repos.createOrUpdateFileContents({
      owner: owner,
      repo: repo,
      path: newFilePath,
      message: `Added commented version of ${fileName} via Code Narrator`,
      content: Buffer.from(commentedContent).toString("base64"),
      sha: sha, // Include SHA if updating existing file
    });

    console.log(
      "Commented file pushed successfully:",
      result.data.commit.html_url
    );

    res.json({
      success: true,
      message: "Commented code successfully pushed to GitHub!",
      commit_url: result.data.commit.html_url,
      file_path: newFilePath,
    });
  } catch (error) {
    console.error(`Error pushing commented code to GitHub:`, error);

    // Better error handling
    let errorMessage = error.message;
    if (error.status === 403) {
      errorMessage =
        "Permission denied. Make sure the GitHub App has write access to the repository.";
    } else if (error.status === 404) {
      errorMessage =
        "Repository not found or GitHub App is not installed on this repository.";
    }

    res.status(500).json({
      error: "Failed to push commented code to GitHub",
      details: errorMessage,
    });
  }
});

// Helper function to parse GitHub URL and extract owner and repo
function parseRepoUrl(repoUrl) {
  try {
    // Check if the URL is a valid URL format
    const url = new URL(repoUrl);

    // Check if it's a GitHub URL
    if (!url.hostname.includes("github.com")) {
      throw new Error(
        "Not a GitHub URL. Please enter a valid GitHub repository URL."
      );
    }

    // Extract path parts
    const pathParts = url.pathname.split("/").filter((part) => part);

    // Check if we have enough parts for owner/repo
    if (pathParts.length < 2) {
      throw new Error(
        "Invalid GitHub repository URL format. URL should be in the format: https://github.com/owner/repo"
      );
    }

    // Return owner and repo
    return [pathParts[0], pathParts[1]];
  } catch (error) {
    // If it's our custom error, rethrow it
    if (error.message.includes("GitHub")) {
      throw error;
    }

    // Generic URL parsing error
    throw new Error(
      "Invalid URL format. Please enter a valid GitHub repository URL."
    );
  }
}

function handleGitHubError(error, res) {
  console.error(`GitHub API error: ${error.message}`);

  // Handle specific GitHub API errors
  if (error.status === 404) {
    return res.status(404).json({
      error:
        "Repository not found. The repository might be private or doesn't exist.",
      details:
        "Please check that the URL is correct and the repository is public.",
    });
  } else if (error.status === 403) {
    return res.status(403).json({
      error: "Access forbidden. GitHub API rate limit may have been exceeded.",
      details:
        "Please try again later or use a GitHub token for authentication.",
    });
  } else if (error.status === 401) {
    return res.status(401).json({
      error:
        "Authentication failed. GitHub token may have expired or is invalid.",
      details: "Please check your GitHub token configuration.",
    });
  } else {
    return res.status(500).json({
      error: `Error accessing GitHub API: ${error.message}`,
      details:
        "There may be an issue with the GitHub API or with your connection.",
    });
  }
}

// Start the Express server for form submission and metadata fetching
expressApp.listen(3001, () => {
  console.log("Express server is running on port 3001: http://localhost:3001");
});

// --- Existing GitHub App Functionality ---

// This assigns the values of your environment variables to local variables.
const appId = process.env.APP_ID;
const webhookSecret = process.env.WEBHOOK_SECRET;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;

// This reads the contents of your private key file.
// const privateKey = fs.readFileSync(privateKeyPath, "utf8");

// Use environment variable for private key in production, fallback to file for local development
const privateKey = process.env.PRIVATE_KEY || fs.readFileSync(privateKeyPath, "utf8");

// This creates a new instance of the Octokit App class.
const app = new App({
  appId: appId,
  privateKey: privateKey,
  webhooks: {
    secret: webhookSecret,
  },
});

// This defines the message that your app will post to pull requests.
const messageForNewPRs =
  "Thanks for opening a new PR! Please follow our contributing guidelines to make your PR easier to review.";

// Event handler for pull requests
async function handlePullRequestOpened({ octokit, payload }) {
  console.log(
    `Received a pull request event for #${payload.pull_request.number}`
  );

  try {
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.pull_request.number,
        body: messageForNewPRs,
        headers: {
          "x-github-api-version": "2022-11-28",
        },
      }
    );
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`
      );
    }
    console.error(error);
  }
}

// ADD THESE NEW FUNCTIONS after handlePullRequestOpened function

// Handle push events for automatic README updates
async function handlePushEvent({ octokit, payload }) {
  console.log(`Received a push event for ${payload.repository.full_name}`);
  console.log(`Installation ID: ${payload.installation.id}`);

  const repoFullName = payload.repository.full_name;
  const commitSha = payload.head_commit.id;
  const commitMessage = payload.head_commit.message;

  global.pendingUpdates = global.pendingUpdates || {};
  global.pendingUpdates[repoFullName] = {
    sha: commitSha,
    message: commitMessage,
    timestamp: new Date(),
    repository: payload.repository,
    installationId: payload.installation.id, // Store installation ID for global checking
  };

  console.log(
    `Stored pending update for ${repoFullName} with installation ${payload.installation.id}`
  );
}

// Handle app installation
async function handleAppInstallation({ octokit, payload }) {
  console.log(`App installed on repositories:`, payload.repositories);

  // Store installation data
  const installationId = payload.installation.id;
  const repositories = payload.repositories || [];

  console.log(`Installation ID: ${installationId}`);
  console.log(
    `Repositories: ${repositories.map((repo) => repo.full_name).join(", ")}`
  );
}

// Listen to pull_request.opened events
// app.webhooks.on("pull_request.opened", handlePullRequestOpened);

// REPLACE the existing webhook listeners with these:
// Listen to all the events we need
app.webhooks.on("push", handlePushEvent);
app.webhooks.on("installation.created", handleAppInstallation);
app.webhooks.on("installation_repositories.added", handleAppInstallation);
app.webhooks.on("pull_request.opened", handlePullRequestOpened); // Keep existing PR handler

// Log webhook errors
app.webhooks.onError((error) => {
  if (error.name === "AggregateError") {
    console.error(`Error processing request: ${error.event}`);
  } else {
    console.error(error);
  }
});

// ADD these new endpoints to your app.js for global update checking

// Global update checking by installation ID
expressApp.get("/api/check-updates-global/:installationId", (req, res) => {
  const installationId = req.params.installationId;

  if (!global.pendingUpdates) {
    return res.json({ hasPendingUpdate: false });
  }

  // Find any pending update for this installation
  for (const [repoFullName, update] of Object.entries(global.pendingUpdates)) {
    if (
      update.installationId &&
      update.installationId.toString() === installationId
    ) {
      return res.json({
        hasPendingUpdate: true,
        update: update,
      });
    }
  }

  res.json({ hasPendingUpdate: false });
});

// Clear global updates by installation ID
expressApp.post("/api/clear-update-global/:installationId", (req, res) => {
  const installationId = req.params.installationId;

  if (!global.pendingUpdates) {
    return res.json({ success: true });
  }

  // Clear all pending updates for this installation
  for (const [repoFullName, update] of Object.entries(global.pendingUpdates)) {
    if (
      update.installationId &&
      update.installationId.toString() === installationId
    ) {
      delete global.pendingUpdates[repoFullName];
    }
  }

  res.json({ success: true });
});

// This creates a Node.js server for webhook events
const port = 3000;
const host = "localhost";
const webhookPath = "/api/webhook";
const localWebhookUrl = `http://${host}:${port}${webhookPath}`;

// Handle the webhook with a GET request
expressApp.get("/api/webhook", (req, res) => {
  res.send("This is a GET request to the webhook endpoint");
});

// Add this code to handle incoming webhook events at the /events route
// expressApp.post("/events", (req, res) => {
//   console.log("Received webhook event:", req.body);

//   // Process the event based on the type
//   // For example, if it's a push event, do something with it
//   if (req.body.action === "push") {
//     // Handle push events (e.g., generate README or code comments)
//     console.log("Push event received!");
//   }

//   // Respond with a success message to acknowledge receipt of the event
//   res.status(200).send("Event received");
// });

// Add this BEFORE your existing /api/webhook route for debugging
expressApp.all("/api/webhook", (req, res, next) => {
  console.log(`📥 Webhook request: ${req.method} ${req.url}`);
  console.log(`📥 Headers:`, req.headers);
  next();
});

// REPLACE the /events endpoint with this:
// Handle incoming webhook events at the /api/webhook route (GitHub will send events here)
// expressApp.post("/api/webhook", createNodeMiddleware(app.webhooks));

// Replace the problematic webhook handler with this:
expressApp.post("/api/webhook", async (req, res) => {
  console.log(`🔥 Webhook received: ${req.headers["x-github-event"]}`);

  try {
    // Manually handle the webhook
    await app.webhooks.verifyAndReceive({
      id: req.headers["x-github-delivery"],
      name: req.headers["x-github-event"],
      signature: req.headers["x-hub-signature-256"],
      payload: JSON.stringify(req.body),
    });

    console.log(`✅ Webhook processed successfully`);
    res.status(200).send("OK");
  } catch (error) {
    console.error(`❌ Webhook error:`, error);
    res.status(500).send("Error processing webhook");
  }
});

// Keep this for backwards compatibility during development
expressApp.post("/events", createNodeMiddleware(app.webhooks));

// Start the webhook server
// expressApp.listen(port, () => {
//   console.log(
//     `Webhook server is listening for GET requests at: ${localWebhookUrl}`
//   );
//   console.log("Press Ctrl + C to quit.");
// });

// REMOVE the duplicate expressApp.listen() calls and keep only this one:
// (The Express server is already listening on port 3001 from earlier in the code)

console.log("GitHub App webhook handler is ready!");
console.log(`Webhook endpoint: http://localhost:3001/api/webhook`);
console.log("Press Ctrl + C to quit.");
