// Configure marked.js properly for GitHub-flavored markdown
marked.setOptions({
  gfm: true,
  breaks: true,
  pedantic: false,
  sanitize: false,
  smartLists: true,
  smartypants: false,
  headerIds: true,
  langPrefix: "language-", // Add language prefix for better syntax highlighting
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(lang, code).value;
      } catch (e) {
        console.error(e);
      }
    }
    return hljs.highlightAuto(code).value;
  },
});

// Variables to store the content for download
let currentReadmeContent = "";
let currentCommentedCode = "";
let currentFilename = "";
let repoName = "";

// ADD THESE VARIABLES after your existing variable declarations (around line 25)

// GitHub App integration variables
let currentRepo = "";
let currentInstallationId = "";
let generatedReadme = "";

const form = document.getElementById("repoForm");
const generateReadmeBtn = document.getElementById("generateReadmeBtn");
const generateCommentsBtn = document.getElementById("generateCommentsBtn");
const metadataDiv = document.getElementById("metadata");
// const generateCallgraphBtn = document.getElementById("generateCallgraphBtn");
// const generateReadmeWithCallgraphBtn = document.getElementById(
//   "generateReadmeWithCallgraphBtn"
// );
// const generateReadmeWithoutCallgraphBtn = document.getElementById(
//   "generateReadmeWithoutCallgraphBtn"
// );
// Add this near the top of scripts.js with your other constants
const fetchMetadataBtn = document.querySelector(".fetch-metadata-btn");
console.log("Fetch metadata button:", fetchMetadataBtn);

// Add this at the top of scripts.js, after your variable declarations
console.log("Scripts.js loaded"); // Verify the script is loading

// Test DOM loaded correctly
document.addEventListener("DOMContentLoaded", function () {
  console.log("DOM fully loaded");
  console.log(
    "Fetch metadata button: ",
    document.querySelector(".fetch-metadata-btn")
  );
  // ADD THIS CODE inside your existing DOMContentLoaded event listener

  // Check for GitHub App installation
  const urlParams = new URLSearchParams(window.location.search);
  const installationId = urlParams.get("installation_id");

  if (installationId) {
    currentInstallationId = installationId;
    document.getElementById("installationInfo").style.display = "block";
    console.log("GitHub App installed with ID:", installationId);
  }

  // Start checking for push notifications
  startPushNotificationCheck();
});

if (fetchMetadataBtn) {
  // Add click event listener to the button
  fetchMetadataBtn.addEventListener("click", function (e) {
    e.preventDefault(); // Prevent default form submission
    console.log("Fetch Metadata button clicked!");

    const repoUrl = document
      .querySelector("input[name='repo_url']")
      .value.trim();
    if (!repoUrl) {
      showError("Invalid Input", "Please enter a valid GitHub repository URL.");
      return;
    }

    // Now call your metadata fetching function
    handleFetchMetadata(repoUrl);
  });
} else {
  console.error("Fetch metadata button not found in the DOM!");
}

// Define a separate function to handle the actual fetching logic
async function handleFetchMetadata(repoUrl) {
  // Your existing metadata fetching code...
  repoName = extractRepoName(repoUrl);

  // ADD this line right after: repoName = extractRepoName(repoUrl);

  // Also extract repo info for GitHub App integration
  const repoInfo = extractRepoInfo(repoUrl);

  // Show loading message
  showLoading(
    "Fetching Repository Data",
    "Retrieving metadata from GitHub...",
    "This should only take a moment."
  );

  try {
    // First check if the repository is Python-based
    let languageInfo;
    try {
      languageInfo = await checkRepositoryLanguage(repoUrl);

      // Your existing language check code...
    } catch (langError) {
      console.error("Error checking repository language:", langError);
      enableAllButtons();
    }

    console.log("Sending request to /fetch-metadata with URL:", repoUrl);

    // Send a POST request using fetch for metadata
    const response = await fetch("/fetch-metadata", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        repo_url: repoUrl,
      }),
    });

    console.log("Response status:", response.status);

    if (!response.ok) {
      // Your existing error handling code...
      return;
    }

    const metadata = await response.json();
    console.log("Received metadata:", metadata);

    // Display the metadata
    displayMetadata(metadata, repoUrl);

    // Your existing code for handling language info...
  } catch (error) {
    console.error("Error in fetch operation:", error);
    showError(
      "Connection Error",
      error.message,
      "There may be an issue with your internet connection or the server may be temporarily unavailable."
    );
  }
}

// Function to extract repository name from URL
function extractRepoName(repoUrl) {
  try {
    const urlParts = new URL(repoUrl).pathname.split("/");
    if (urlParts.length >= 3) {
      return urlParts[2]; // Returns the repository name from the URL
    }
  } catch (e) {
    console.error("Invalid URL format", e);
  }
  return "repository"; // Fallback name
}

// ADD this function after your extractRepoName function

function extractRepoInfo(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter((part) => part);
    if (pathParts.length >= 2) {
      currentRepo = `${pathParts[0]}/${pathParts[1]}`;
      return { owner: pathParts[0], repo: pathParts[1] };
    }
  } catch (error) {
    console.error("Invalid URL:", error);
  }
  return null;
}

// Function to create a downloadable file
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Function to download the callgraph DOT file
function downloadCallgraph(filename) {
  console.log(`Initiating download for: ${filename}`);

  // Show a brief loading message
  const downloadBtn = document.getElementById("downloadCallgraphBtn");
  const originalText = downloadBtn.innerHTML;
  downloadBtn.innerHTML =
    '<i class="fas fa-spinner fa-spin"></i> Downloading...';
  downloadBtn.disabled = true;

  fetch(`/download-callgraph?filename=${encodeURIComponent(filename)}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `Server returned ${response.status}: ${response.statusText}`
        );
      }
      return response.blob();
    })
    .then((blob) => {
      // Create a URL for the blob
      const url = URL.createObjectURL(blob);

      // Create a temporary anchor element and trigger the download
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      // Restore button
      downloadBtn.innerHTML = originalText;
      downloadBtn.disabled = false;
    })
    .catch((error) => {
      console.error("Error downloading call graph:", error);
      alert("Error downloading the call graph. Please try again later.");

      // Restore button
      downloadBtn.innerHTML = originalText;
      downloadBtn.disabled = false;
    });
}
// Helper function to show loading state
function showLoading(title, message, description = "") {
  metadataDiv.innerHTML = `
      <div class="results-header loading">
        <i class="fas fa-spinner"></i>
        <div>
          <h3 class="results-title">${title}</h3>
          <p class="results-subtitle">${message}</p>
        </div>
      </div>
      <div class="loading-animation">
        <div class="loading-spinner"></div>
        <p class="loading-text">${title}</p>
        <p class="loading-description">${description}</p>
      </div>
    `;
}

// Helper function to show error state
function showError(title, message, suggestion = "") {
  metadataDiv.innerHTML = `
      <div class="results-header error">
        <i class="fas fa-exclamation-triangle"></i>
        <div>
          <h3 class="results-title">${title}</h3>
          <p class="results-subtitle">There was a problem with your request</p>
        </div>
      </div>
      <div class="error-message">
        <p>${message}</p>
        ${suggestion ? `<div class="error-suggestion">${suggestion}</div>` : ""}
      </div>
    `;
}

// Helper function to display metadata results
function displayMetadata(metadata, repoUrl) {
  metadataDiv.innerHTML = `
      <div class="results-header metadata">
        <i class="fas fa-chart-bar"></i>
        <div>
          <h3 class="results-title">Repository Statistics</h3>
          <p class="results-subtitle">Key metrics for this repository</p>
        </div>
      </div>
      <div class="metadata-stats">
        <div class="stat-card stars">
          <div class="stat-icon">
            <i class="fas fa-star"></i>
          </div>
          <div class="stat-value">${metadata.stars}</div>
          <div class="stat-label">Stars</div>
        </div>
        <div class="stat-card forks">
          <div class="stat-icon">
            <i class="fas fa-code-branch"></i>
          </div>
          <div class="stat-value">${metadata.forks}</div>
          <div class="stat-label">Forks</div>
        </div>
        <div class="stat-card watchers">
          <div class="stat-icon">
            <i class="fas fa-eye"></i>
          </div>
          <div class="stat-value">${metadata.watchers}</div>
          <div class="stat-label">Watchers</div>
        </div>
      </div>
      <div class="content-box">
        <div class="repo-url">
          <i class="fab fa-github"></i>
          <a href="${repoUrl}" target="_blank">${repoUrl}</a>
        </div>
        <p>Click "Generate README" to create comprehensive documentation or "Generate Comments" to add helpful explanations to the code.</p>
      </div>
    `;
}

// Handle "Generate README" button click
// generateReadmeBtn.addEventListener("click", async () => {
//   const repoUrl = form.repo_url.value.trim();

//   // Check if the input field is empty
//   if (!repoUrl) {
//     showError(
//       "Invalid Input",
//       "Please enter a valid GitHub repository URL.",
//       "The URL should be in the format: https://github.com/username/repository"
//     );
//     return;
//   }

//   // Extract repo name for download
//   repoName = extractRepoName(repoUrl);

//   // Show loading message
//   showLoading(
//     "Generating README",
//     "Analyzing repository structure and content...",
//     "This process may take up to a minute depending on the size and complexity of the repository."
//   );

//   try {
//     const response = await fetch("/generate-readme", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: new URLSearchParams({ repo_url: repoUrl }),
//     });

//     const data = await response.json();
//     if (data.readme) {
//       // Store the raw markdown for download
//       currentReadmeContent = data.readme;

//       // Preprocess markdown to fix any fenced code blocks issues
//       let processedMarkdown = data.readme;

//       // Ensure proper spacing for code blocks
//       processedMarkdown = processedMarkdown.replace(/```(\w+)\n/g, "```$1\n\n");
//       processedMarkdown = processedMarkdown.replace(/\n```\n/g, "\n\n```\n");

//       // Parse and display the README with GitHub-like styling
//       const readmeHtml = marked.parse(processedMarkdown);

//       metadataDiv.innerHTML = `
//           <div class="results-header readme">
//             <i class="fas fa-file-alt"></i>
//             <div>
//               <h3 class="results-title">Generated README</h3>
//               <p class="results-subtitle">Comprehensive documentation for this repository</p>
//             </div>
//           </div>
//           <div class="content-box">
//             <div class="repo-url">
//               <i class="fab fa-github"></i>
//               <a href="${repoUrl}" target="_blank">${repoUrl}</a>
//             </div>
//             <div class="readme-content">${readmeHtml}</div>
//             <div class="download-container">
//               <button id="downloadReadmeBtn" class="download-btn">
//                 <i class="fas fa-download"></i>
//                 Download README.md
//               </button>
//             </div>
//           </div>
//         `;

//       // Add event listener to the download button
//       document
//         .getElementById("downloadReadmeBtn")
//         .addEventListener("click", () => {
//           downloadFile(currentReadmeContent, `${repoName || "repo"}_README.md`);
//         });

//       // Fix any incorrectly rendered code blocks
//       document.querySelectorAll(".readme-content pre").forEach((block) => {
//         // Check if pre doesn't contain a code element
//         if (block.querySelector("code") === null) {
//           const code = document.createElement("code");
//           code.className = "language-plaintext";
//           code.innerHTML = block.innerHTML;
//           block.innerHTML = "";
//           block.appendChild(code);
//         }
//       });

//       // Apply syntax highlighting to code blocks after rendering
//       document.querySelectorAll(".readme-content pre code").forEach((block) => {
//         // Ensure proper class names for highlight.js
//         if (!block.className.startsWith("language-")) {
//           block.className = "language-plaintext";
//         }
//         hljs.highlightElement(block);
//       });
//     } else if (data.error) {
//       showError(
//         "README Generation Error",
//         data.error,
//         "Try using a repository with more code files or a clearer structure."
//       );
//     } else {
//       showError(
//         "Unexpected Error",
//         "Received an unexpected response from the server.",
//         "Please try again later or contact support if the issue persists."
//       );
//     }
//   } catch (error) {
//     showError(
//       "Connection Error",
//       error.message,
//       "There may be an issue with your internet connection or the server may be temporarily unavailable."
//     );
//   }
// });

// Modify the existing generateReadmeBtn click event handler
// generateReadmeBtn.addEventListener("click", async () => {
//   const repoUrl = form.repo_url.value.trim();

//   Check if the input field is empty
//   if (!repoUrl) {
//     showError(
//       "Invalid Input",
//       "Please enter a valid GitHub repository URL.",
//       "The URL should be in the format: https://github.com/username/repository"
//     );
//     return;
//   }

//   Extract repo name for download
//   repoName = extractRepoName(repoUrl);

//   First check if required analysis files exist
//   try {
//     const response = await fetch("/check-analysis-files", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: new URLSearchParams({ repo_url: repoUrl }),
//     });

//     const data = await response.json();

//     If analysis files don't exist, suggest running CodeT5 inference first
//     if (!data.analysisExists) {
//       showError(
//         "Analysis Files Missing",
//         "No repository analysis data found for generating a comprehensive README.",
//         "Please click 'Run CodeT5 Inference' first, then 'Run Llama Inference' to generate a high-quality README."
//       );

//       Highlight the CodeT5 button to draw attention to it
//       const codet5Btn = document.getElementById("runCodeT5InferenceBtn");
//       codet5Btn.classList.add("highlight-button");

//       Remove highlight after 3 seconds
//       setTimeout(() => {
//         codet5Btn.classList.remove("highlight-button");
//       }, 3000);

//       return;
//     }

//     If we get here, analysis exists, so proceed with README generation
//     await generateReadmeWithCallgraph(repoUrl);
//   } catch (error) {
//     console.error("Error checking analysis files:", error);
//     If check fails, still try to generate README
//     await generateReadmeWithCallgraph(repoUrl);
//   }
// });

// Generate README without dependency buttons
generateReadmeBtn.addEventListener("click", async () => {
  const repoUrl = form.repo_url.value.trim();

  // Check if the input field is empty
  if (!repoUrl) {
    showError(
      "Invalid Input",
      "Please enter a valid GitHub repository URL.",
      "The URL should be in the format: https://github.com/username/repository"
    );
    return;
  }

  // Extract repo name for download
  repoName = extractRepoName(repoUrl);

  // Show loading message
  showLoading(
    "Generating README",
    "Analyzing repository structure and content...",
    "This process may take up to a minute depending on the size and complexity of the repository."
  );

  try {
    const response = await fetch("/generate-readme", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ repo_url: repoUrl }),
    });

    const data = await response.json();
    if (data.readme) {
      // Store the generated README for potential GitHub push
      generatedReadme = data.readme;

      // Always display the README first
      displayReadmeResults(data, repoUrl, "standard");

      // If we have an installation ID, add a GitHub push button to the display
      if (currentInstallationId) {
        addGitHubPushButton();
      }
    } else if (data.error) {
      showError(
        "README Generation Error",
        data.error,
        "Try using a repository with more code files or a clearer structure."
      );
    } else {
      showError(
        "Unexpected Error",
        "Received an unexpected response from the server.",
        "Please try again later or contact support if the issue persists."
      );
    }
  } catch (error) {
    showError(
      "Connection Error",
      error.message,
      "There may be an issue with your internet connection or the server may be temporarily unavailable."
    );
  }
});

// generateCallgraphBtn.addEventListener("click", async () => {
//   const repoUrl = form.repo_url.value.trim();

//   // Check if the input field is empty
//   if (!repoUrl) {
//     showError(
//       "Invalid Input",
//       "Please enter a valid GitHub repository URL.",
//       "The URL should be in the format: https://github.com/username/repository"
//     );
//     return;
//   }

//   // Extract repo name for reference
//   repoName = extractRepoName(repoUrl);

//   // Show loading message
//   showLoading(
//     "Generating Call Graph",
//     "Analyzing repository structure and creating function call graph...",
//     "This process may take up to a minute depending on the size and complexity of the repository."
//   );

//   try {
//     const response = await fetch("/generate-callgraph", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: new URLSearchParams({ repo_url: repoUrl }),
//     });

//     if (!response.ok) {
//       const contentType = response.headers.get("content-type");
//       if (contentType && contentType.includes("application/json")) {
//         const errorData = await response.json();
//         showError(
//           "Call Graph Generation Error",
//           errorData.error || "Failed to generate call graph",
//           errorData.details || "There was a problem processing your repository."
//         );
//       } else {
//         const errorText = await response.text();
//         showError(
//           "Server Error",
//           `Server responded with status: ${response.status}`,
//           "There may be an issue with the server. Please try again later."
//         );
//       }
//       return;
//     }

//     const data = await response.json();

//     if (data.success) {
//       // Store the filename for download
//       const callgraphFilename = data.filename || `${repoName}.dot`;

//       // Show success message with download button
//       metadataDiv.innerHTML = `
//         <div class="results-header">
//           <i class="fas fa-check-circle" style="color: #2e8555;"></i>
//           <div>
//             <h3 class="results-title">Call Graph Generated Successfully</h3>
//             <p class="results-subtitle">The function call graph for this repository has been created</p>
//           </div>
//         </div>
//         <div class="content-box">
//           <div class="repo-url">
//             <i class="fab fa-github"></i>
//             <a href="${repoUrl}" target="_blank">${repoUrl}</a>
//           </div>
//           <div class="success-message" style="text-align: center; padding: 20px;">
//             <i class="fas fa-project-diagram" style="font-size: 48px; color: #2e8555; margin-bottom: 15px;"></i>
//             <p style="font-size: 18px; font-weight: 500; margin-bottom: 10px;">Call Graph generated successfully!</p>
//             <p>The call graph has been saved successfully!</p>
//             <div style="background: #f6f8fa; padding: 10px; border-radius: 4px; margin: 10px 0; font-family: monospace;">Filename: ${callgraphFilename}</div>
//             <p style="color: #666; font-size: 14px; margin-top: 10px;">This visualization helps you understand the structure and relationships in the codebase.</p>
//             <div class="download-container">
//               <button id="downloadCallgraphBtn" class="download-btn">
//                 <i class="fas fa-download"></i>
//                 Download Call Graph
//               </button>
//             </div>
//           </div>
//         </div>
//       `;

//       // Add event listener to the download button
//       document
//         .getElementById("downloadCallgraphBtn")
//         .addEventListener("click", () => {
//           // Make a request to download the callgraph file
//           downloadCallgraph(callgraphFilename);
//         });
//     } else if (data.error) {
//       showError(
//         "Call Graph Generation Error",
//         data.error,
//         "Try using a repository with clearer code structure or contact support if the issue persists."
//       );
//     } else {
//       showError(
//         "Unexpected Error",
//         "Received an unexpected response from the server.",
//         "Please try again later or contact support if the issue persists."
//       );
//     }
//   } catch (error) {
//     console.error("Error generating call graph:", error);
//     showError(
//       "Connection Error",
//       error.message,
//       "There may be an issue with your internet connection or the server may be temporarily unavailable."
//     );
//   }
// });

// Variables to store Python files and the selected file
let pythonFiles = [];
let selectedFilePath = null;

// Helper function to display README results
// function displayReadmeResults(data, repoUrl, readmeType) {
//   // Store the raw markdown for download
//   currentReadmeContent = data.readme;

//   // Preprocess markdown to fix any fenced code blocks issues
//   let processedMarkdown = data.readme;

//   // Ensure proper spacing for code blocks
//   processedMarkdown = processedMarkdown.replace(/```(\w+)\n/g, "```$1\n\n");
//   processedMarkdown = processedMarkdown.replace(/\n```\n/g, "\n\n```\n");

//   // Parse and display the README with GitHub-like styling
//   const readmeHtml = marked.parse(processedMarkdown);

//   // Determine title and subtitle based on README type
//   let title = "Generated README";
//   let subtitle = "Documentation for this repository";
//   let typeLabel = "";
//   let filenamePrefix = "";

//   if (readmeType === "with-callgraph") {
//     title = "README with Call Graph";
//     subtitle = "Comprehensive documentation with call graph analysis";
//     typeLabel = " (with call graph)";
//     filenamePrefix = "";
//   } else if (readmeType === "without-callgraph") {
//     title = "README without Call Graph";
//     subtitle = "Basic documentation without call graph analysis";
//     typeLabel = " (without call graph)";
//     filenamePrefix = "simple_";
//   } else if (readmeType === "llama-inference") {
//     title = "Llama-Generated README";
//     subtitle = "AI-powered comprehensive documentation";
//     typeLabel = " (AI-generated)";
//     filenamePrefix = "llama_";
//   }

//   metadataDiv.innerHTML = `
//     <div class="results-header readme">
//       <i class="fas fa-file-alt"></i>
//       <div>
//         <h3 class="results-title">${title}</h3>
//         <p class="results-subtitle">${subtitle}</p>
//       </div>
//     </div>
//     <div class="content-box">
//       <div class="repo-url">
//         <i class="fab fa-github"></i>
//         <a href="${repoUrl}" target="_blank">${repoUrl}</a>
//       </div>
//       ${readmeType ? `<div class="readme-type-label">${typeLabel}</div>` : ""}
//       <div class="readme-content">${readmeHtml}</div>
//       <div class="download-container">
//         <button id="downloadReadmeBtn" class="download-btn">
//           <i class="fas fa-download"></i>
//           Download ${filenamePrefix}README.md
//         </button>
//       </div>
//     </div>
//   `;

//   // Add event listener to the download button
//   document.getElementById("downloadReadmeBtn").addEventListener("click", () => {
//     downloadFile(
//       currentReadmeContent,
//       `${filenamePrefix}${repoName || "repo"}_README.md`
//     );
//   });

//   // Fix any incorrectly rendered code blocks
//   document.querySelectorAll(".readme-content pre").forEach((block) => {
//     // Check if pre doesn't contain a code element
//     if (block.querySelector("code") === null) {
//       const code = document.createElement("code");
//       code.className = "language-plaintext";
//       code.innerHTML = block.innerHTML;
//       block.innerHTML = "";
//       block.appendChild(code);
//     }
//   });

//   // Apply syntax highlighting to code blocks after rendering
//   document.querySelectorAll(".readme-content pre code").forEach((block) => {
//     // Ensure proper class names for highlight.js
//     if (!block.className.startsWith("language-")) {
//       block.className = "language-plaintext";
//     }
//     hljs.highlightElement(block);
//   });
// }

// Simplify the displayReadmeResults function
function displayReadmeResults(data, repoUrl, readmeType) {
  // Store the raw markdown for download
  currentReadmeContent = data.readme;

  // Preprocess markdown to fix any fenced code blocks issues
  let processedMarkdown = data.readme;

  // Ensure proper spacing for code blocks
  processedMarkdown = processedMarkdown.replace(/```(\w+)\n/g, "```$1\n\n");
  processedMarkdown = processedMarkdown.replace(/\n```\n/g, "\n\n```\n");

  // Parse and display the README with GitHub-like styling
  const readmeHtml = marked.parse(processedMarkdown);

  metadataDiv.innerHTML = `
    <div class="results-header readme">
      <i class="fas fa-file-alt"></i>
      <div>
        <h3 class="results-title">Generated README</h3>
        <p class="results-subtitle">Documentation for this repository</p>
      </div>
    </div>
    <div class="content-box">
      <div class="repo-url">
        <i class="fab fa-github"></i>
        <a href="${repoUrl}" target="_blank">${repoUrl}</a>
      </div>
      <div class="readme-content">${readmeHtml}</div>
      <div class="download-container">
        <button id="downloadReadmeBtn" class="download-btn">
          <i class="fas fa-download"></i>
          Download README.md
        </button>
      </div>
    </div>
  `;

  // Add event listener to the download button
  document.getElementById("downloadReadmeBtn").addEventListener("click", () => {
    downloadFile(currentReadmeContent, `${repoName || "repo"}_README.md`);
  });

  // Fix any incorrectly rendered code blocks
  document.querySelectorAll(".readme-content pre").forEach((block) => {
    // Check if pre doesn't contain a code element
    if (block.querySelector("code") === null) {
      const code = document.createElement("code");
      code.className = "language-plaintext";
      code.innerHTML = block.innerHTML;
      block.innerHTML = "";
      block.appendChild(code);
    }
  });

  // Apply syntax highlighting to code blocks after rendering
  document.querySelectorAll(".readme-content pre code").forEach((block) => {
    // Ensure proper class names for highlight.js
    if (!block.className.startsWith("language-")) {
      block.className = "language-plaintext";
    }
    hljs.highlightElement(block);
  });
}

// // Function to generate README with call graph
// async function generateReadmeWithCallgraph(repoUrl) {
//   // Show loading message
//   showLoading(
//     "Generating README with Call Graph",
//     "Analyzing repository structure and code relationships...",
//     "This process may take up to a minute depending on the size and complexity of the repository."
//   );

//   try {
//     const response = await fetch("/generate-readme-with-callgraph", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: new URLSearchParams({ repo_url: repoUrl }),
//     });

//     const data = await response.json();
//     if (data.readme) {
//       displayReadmeResults(data, repoUrl, "with-callgraph");
//     } else if (data.error) {
//       showError(
//         "README Generation Error",
//         data.error,
//         "Try using a repository with more code files or a clearer structure."
//       );
//     } else {
//       showError(
//         "Unexpected Error",
//         "Received an unexpected response from the server.",
//         "Please try again later or contact support if the issue persists."
//       );
//     }
//   } catch (error) {
//     showError(
//       "Connection Error",
//       error.message,
//       "There may be an issue with your internet connection or the server may be temporarily unavailable."
//     );
//   }
// }

// // Function to generate README without call graph
// async function generateReadmeWithoutCallgraph(repoUrl) {
//   // Show loading message
//   showLoading(
//     "Generating Simple README",
//     "Creating basic repository documentation...",
//     "This should only take a few seconds."
//   );

//   try {
//     const response = await fetch("/generate-readme-without-callgraph", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: new URLSearchParams({ repo_url: repoUrl }),
//     });

//     const data = await response.json();
//     if (data.readme) {
//       displayReadmeResults(data, repoUrl, "without-callgraph");
//     } else if (data.error) {
//       showError(
//         "README Generation Error",
//         data.error,
//         "Try using a repository with more code files or a clearer structure."
//       );
//     } else {
//       showError(
//         "Unexpected Error",
//         "Received an unexpected response from the server.",
//         "Please try again later or contact support if the issue persists."
//       );
//     }
//   } catch (error) {
//     showError(
//       "Connection Error",
//       error.message,
//       "There may be an issue with your internet connection or the server may be temporarily unavailable."
//     );
//   }
// }

// Update the original generate README button to use the with-callgraph version
// generateReadmeBtn.addEventListener("click", async () => {
//   const repoUrl = form.repo_url.value.trim();

//   // Check if the input field is empty
//   if (!repoUrl) {
//     showError(
//       "Invalid Input",
//       "Please enter a valid GitHub repository URL.",
//       "The URL should be in the format: https://github.com/username/repository"
//     );
//     return;
//   }

//   // Extract repo name for download
//   repoName = extractRepoName(repoUrl);

//   // Generate README with call graph by default
//   await generateReadmeWithCallgraph(repoUrl);
// });

// // Add event listener for the "Generate README with Call Graph" button
// generateReadmeWithCallgraphBtn.addEventListener("click", async () => {
//   const repoUrl = form.repo_url.value.trim();

//   // Check if the input field is empty
//   if (!repoUrl) {
//     showError(
//       "Invalid Input",
//       "Please enter a valid GitHub repository URL.",
//       "The URL should be in the format: https://github.com/username/repository"
//     );
//     return;
//   }

//   // Extract repo name for download
//   repoName = extractRepoName(repoUrl);

//   // First check if required analysis files exist
//   try {
//     const response = await fetch("/check-analysis-files", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: new URLSearchParams({ repo_url: repoUrl }),
//     });

//     const data = await response.json();

//     // If analysis files don't exist, suggest running CodeT5 inference first
//     if (!data.analysisExists) {
//       showError(
//         "Analysis Files Missing",
//         "No repository analysis data found for generating a comprehensive README.",
//         "Please click 'Run CodeT5 Inference' first, then 'Run Llama Inference' to generate a high-quality README."
//       );

//       // Highlight the CodeT5 button to draw attention to it
//       const codet5Btn = document.getElementById("runCodeT5InferenceBtn");
//       codet5Btn.classList.add("highlight-button");

//       // Remove highlight after 3 seconds
//       setTimeout(() => {
//         codet5Btn.classList.remove("highlight-button");
//       }, 3000);

//       return;
//     }

//     // If we get here, analysis exists, so proceed with README generation
//     await generateReadmeWithCallgraph(repoUrl);
//   } catch (error) {
//     console.error("Error checking analysis files:", error);
//     // If check fails, still try to generate README
//     await generateReadmeWithCallgraph(repoUrl);
//   }
// });

// // Add event listener for the "Generate README without Call Graph" button
// generateReadmeWithoutCallgraphBtn.addEventListener("click", async () => {
//   const repoUrl = form.repo_url.value.trim();

//   // Check if the input field is empty
//   if (!repoUrl) {
//     showError(
//       "Invalid Input",
//       "Please enter a valid GitHub repository URL.",
//       "The URL should be in the format: https://github.com/username/repository"
//     );
//     return;
//   }

//   // Extract repo name for download
//   repoName = extractRepoName(repoUrl);

//   // First check if required analysis files exist
//   try {
//     const response = await fetch("/check-analysis-files", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: new URLSearchParams({ repo_url: repoUrl }),
//     });

//     const data = await response.json();

//     // If analysis files don't exist, suggest running CodeT5 inference first
//     if (!data.analysisExists) {
//       showError(
//         "Analysis Files Missing",
//         "No repository analysis data found for generating a simplified README.",
//         "Please click 'Run CodeT5 Inference' first, then 'Run Llama Inference' to generate a high-quality README."
//       );

//       // Highlight the CodeT5 button to draw attention to it
//       const codet5Btn = document.getElementById("runCodeT5InferenceBtn");
//       codet5Btn.classList.add("highlight-button");

//       // Remove highlight after 3 seconds
//       setTimeout(() => {
//         codet5Btn.classList.remove("highlight-button");
//       }, 3000);

//       return;
//     }

//     // If we get here, analysis exists, so proceed with README generation
//     await generateReadmeWithoutCallgraph(repoUrl);
//   } catch (error) {
//     console.error("Error checking analysis files:", error);
//     // If check fails, still try to generate README
//     await generateReadmeWithoutCallgraph(repoUrl);
//   }
// });

// Add event listener for the "Generate README with Call Graph" button
// generateReadmeWithCallgraphBtn.addEventListener("click", async () => {
//   const repoUrl = form.repo_url.value.trim();

//   // Check if the input field is empty
//   if (!repoUrl) {
//     showError(
//       "Invalid Input",
//       "Please enter a valid GitHub repository URL.",
//       "The URL should be in the format: https://github.com/username/repository"
//     );
//     return;
//   }

//   // Extract repo name for download
//   repoName = extractRepoName(repoUrl);

//   // Generate README with call graph
//   await generateReadmeWithCallgraph(repoUrl);
// });

// // Add event listener for the "Generate README without Call Graph" button
// generateReadmeWithoutCallgraphBtn.addEventListener("click", async () => {
//   const repoUrl = form.repo_url.value.trim();

//   // Check if the input field is empty
//   if (!repoUrl) {
//     showError(
//       "Invalid Input",
//       "Please enter a valid GitHub repository URL.",
//       "The URL should be in the format: https://github.com/username/repository"
//     );
//     return;
//   }

//   // Extract repo name for download
//   repoName = extractRepoName(repoUrl);

//   // Generate README without call graph
//   await generateReadmeWithoutCallgraph(repoUrl);
// });

// Helper function to display the file selection UI with improved file grouping by directory
function displayFileSelection(files, repoUrl) {
  // Group files by directory for better organization
  const filesByDirectory = {};
  files.forEach((file) => {
    const filePath = file.path;
    const lastSlashIndex = filePath.lastIndexOf("/");
    const directory =
      lastSlashIndex === -1 ? "/" : filePath.substring(0, lastSlashIndex);

    if (!filesByDirectory[directory]) {
      filesByDirectory[directory] = [];
    }
    filesByDirectory[directory].push(file);
  });

  // Sort directories for consistent display
  const sortedDirectories = Object.keys(filesByDirectory).sort();

  // Build the HTML for the file selection UI
  let filesListHTML = "";

  if (sortedDirectories.length === 1 && sortedDirectories[0] === "/") {
    // If all files are in the root directory, display them directly
    filesListHTML = filesByDirectory["/"]
      .map(
        (file) => `
            <div class="file-item" data-path="${file.path}">
              <i class="fas fa-file-code"></i>
              <div class="file-path">${file.path}</div>
            </div>
          `
      )
      .join("");
  } else {
    // If files are in subdirectories, group them by directory
    filesListHTML = sortedDirectories
      .map((directory) => {
        const directoryFiles = filesByDirectory[directory];
        const directoryName = directory === "/" ? "Root Directory" : directory;

        // Create a directory header
        const dirHeader = `
              <div class="directory-header">
                <i class="fas fa-folder"></i>
                <span>${directoryName}</span>
                <span class="file-count">(${directoryFiles.length} file${
          directoryFiles.length !== 1 ? "s" : ""
        })</span>
              </div>
            `;

        // Create the file items for this directory
        const fileItems = directoryFiles
          .map(
            (file) => `
                <div class="file-item" data-path="${file.path}">
                  <i class="fas fa-file-code"></i>
                  <div class="file-path">${file.name}</div>
                </div>
              `
          )
          .join("");

        return `<div class="directory-group">${dirHeader}${fileItems}</div>`;
      })
      .join("");
  }

  // Update the UI with our new file structure
  metadataDiv.innerHTML = `
        <div class="results-header comments">
          <i class="fas fa-file-code"></i>
          <div>
            <h3 class="results-title">Python Files</h3>
            <p class="results-subtitle">Select a file to generate comments</p>
          </div>
        </div>
        <div class="content-box">
          <div class="repo-url">
            <i class="fab fa-github"></i>
            <a href="${repoUrl}" target="_blank">${repoUrl}</a>
          </div>
          <div class="file-selection">
            <div class="file-selection-header">
              <i class="fab fa-python"></i> Available Python Files
              <span class="total-file-count">(${files.length} total)</span>
            </div>
            <div class="files-list" id="pythonFilesList">
              ${filesListHTML}
            </div>
            <div class="file-actions">
              <div class="file-count">${files.length} Python ${
    files.length === 1 ? "file" : "files"
  } found</div>
              <button id="selectFileBtn" class="select-file-btn" disabled>
                <i class="fas fa-comment-dots"></i> Generate Comments
              </button>
            </div>
          </div>
        </div>
      `;

  // Add event listeners to file items
  document.querySelectorAll(".file-item").forEach((item) => {
    item.addEventListener("click", () => {
      // Remove selected class from all items
      document
        .querySelectorAll(".file-item")
        .forEach((i) => i.classList.remove("selected"));
      // Add selected class to clicked item
      item.classList.add("selected");
      // Store selected file path
      selectedFilePath = item.getAttribute("data-path");
      // Enable the select button
      document.getElementById("selectFileBtn").disabled = false;
    });
  });

  // Add event listener to select button
  document.getElementById("selectFileBtn").addEventListener("click", () => {
    if (selectedFilePath) {
      generateCommentsForFile(repoUrl, selectedFilePath);
    }
  });
}

// Function to generate comments for a specific file
// function generateCommentsForFile(repoUrl, filePath) {
//   // Show loading message
//   showLoading(
//     "Generating Code Comments",
//     `Analyzing ${filePath.split("/").pop()}...`,
//     "This process may take up to a minute as we analyze the code for better understanding."
//   );

//   console.log(`[DEBUG] Generating comments for file: ${filePath}`);

//   // Call the backend to generate comments
//   fetch("/generate-comments", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/x-www-form-urlencoded",
//     },
//     body: new URLSearchParams({
//       repo_url: repoUrl,
//       file_path: filePath,
//     }),
//   })
//     .then((response) => {
//       console.log(`[DEBUG] Response status: ${response.status}`);
//       if (!response.ok) {
//         return response.text().then((text) => {
//           try {
//             // Try to parse as JSON first
//             const jsonData = JSON.parse(text);
//             throw new Error(
//               jsonData.error || `HTTP error! Status: ${response.status}`
//             );
//           } catch (e) {
//             // If not JSON, return the text or status
//             throw new Error(text || `HTTP error! Status: ${response.status}`);
//           }
//         });
//       }
//       return response.json();
//     })
//     .then((data) => {
//       console.log(`[DEBUG] Received data:`, data);

//       if (data.commented_code) {
//         console.log(
//           `[DEBUG] File received: ${data.filename}, Original requested: ${filePath}`
//         );

//         // Check if the filename matches what we expected
//         const requestedBasename = filePath.split("/").pop();
//         const returnedBasename = data.filename.replace("commented_", "");

//         if (!returnedBasename.includes(requestedBasename)) {
//           console.warn(
//             `[WARNING] Received file ${returnedBasename} doesn't match requested ${requestedBasename}`
//           );
//         }

//         // Store for download
//         currentCommentedCode = data.commented_code;
//         currentFilename = data.filename;

//         // Clean code from any existing formatting markers
//         let cleanCode = data.commented_code;

//         // If the code contains the specific color markers format, clean them up
//         if (cleanCode.includes('"color:#')) {
//           cleanCode = cleanCode.replace(/"color:#[0-9a-f]+">([^"]*)/g, "$1");
//         }

//         metadataDiv.innerHTML = `
//       <div class="results-header comments">
//         <i class="fas fa-comment-dots"></i>
//         <div>
//           <h3 class="results-title">Code with Generated Comments</h3>
//           <p class="results-subtitle">Enhanced code with explanatory comments for ${requestedBasename}</p>
//         </div>
//       </div>
//       <div class="content-box">
//         <div class="file-info">
//           <i class="fas fa-file-code"></i> ${
//             data.filename || filePath.split("/").pop()
//           } ${
//           returnedBasename !== requestedBasename
//             ? `<span style="color:var(--error-color);">(Requested: ${requestedBasename})</span>`
//             : ""
//         }
//         </div>
//         <div id="code-container">
//           <pre class="commented-code"><code class="language-python">${cleanCode}</code></pre>
//         </div>
//         <div class="download-container">
//           <button id="downloadCommentsBtn" class="download-btn">
//             <i class="fas fa-download"></i>
//             Download Commented Code
//           </button>
//         </div>
//       </div>
//     `;

//         // Apply syntax highlighting
//         document.querySelectorAll(".commented-code code").forEach((block) => {
//           hljs.highlightElement(block);
//         });

//         // Add event listener to the download button
//         document
//           .getElementById("downloadCommentsBtn")
//           .addEventListener("click", () => {
//             downloadFile(
//               currentCommentedCode,
//               data.filename || `commented_${filePath.split("/").pop()}`
//             );
//           });
//       } else if (data.error) {
//         showError(
//           "Comment Generation Error",
//           data.error,
//           "Try selecting a different Python file with clearer code structure."
//         );
//       } else {
//         showError(
//           "Unexpected Error",
//           "Received an unexpected response from the server.",
//           "Please try again later or contact support if the issue persists."
//         );
//       }
//     })
//     .catch((error) => {
//       console.error("[ERROR] Failed to generate comments:", error);
//       showError(
//         "Connection Error",
//         error.message,
//         "There may be an issue with your internet connection or the server may be temporarily unavailable."
//       );
//     });
// }

// Update the generateCommentsForFile function in scripts.js
function generateCommentsForFile(repoUrl, filePath) {
  // Show loading message
  showLoading(
    "Generating Code Comments",
    `Analyzing ${filePath.split("/").pop()}...`,
    "This process may take up to a minute as we analyze the code for better understanding."
  );

  console.log(`[DEBUG] Generating comments for file: ${filePath}`);

  // Call the backend to generate comments
  fetch("/generate-comments", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      repo_url: repoUrl,
      file_path: filePath,
    }),
  })
    .then((response) => {
      console.log(`[DEBUG] Response status: ${response.status}`);
      if (!response.ok) {
        return response.text().then((text) => {
          try {
            // Try to parse as JSON first
            const jsonData = JSON.parse(text);
            throw new Error(
              jsonData.error || `HTTP error! Status: ${response.status}`
            );
          } catch (e) {
            // If not JSON, return the text or status
            throw new Error(text || `HTTP error! Status: ${response.status}`);
          }
        });
      }
      return response.json();
    })
    .then((data) => {
      console.log(`[DEBUG] Received data:`, data);

      if (data.commented_code) {
        console.log(
          `[DEBUG] File received: ${data.filename}, Original requested: ${filePath}`
        );

        // Check if the filename matches what we expected
        const requestedBasename = filePath.split("/").pop();
        const returnedBasename = data.filename.replace("commented_", "");

        if (!returnedBasename.includes(requestedBasename)) {
          console.warn(
            `[WARNING] Received file ${returnedBasename} doesn't match requested ${requestedBasename}`
          );
        }

        // Store for download and GitHub push
        currentCommentedCode = data.commented_code;
        currentFilename = data.filename;

        // Clean code from any existing formatting markers
        let cleanCode = data.commented_code;

        // If the code contains the specific color markers format, clean them up
        if (cleanCode.includes('"color:#')) {
          cleanCode = cleanCode.replace(/"color:#[0-9a-f]+">([^"]*)/g, "$1");
        }

        metadataDiv.innerHTML = `
          <div class="results-header comments">
            <i class="fas fa-comment-dots"></i>
            <div>
              <h3 class="results-title">Code with Generated Comments</h3>
              <p class="results-subtitle">Enhanced code with explanatory comments for ${requestedBasename}</p>
            </div>
          </div>
          <div class="content-box">
            <div class="repo-url">
              <i class="fab fa-github"></i>
              <a href="${repoUrl}" target="_blank">${repoUrl}</a>
            </div>
            <div class="file-info">
              <i class="fas fa-file-code"></i> ${
                data.filename || filePath.split("/").pop()
              } ${
          returnedBasename !== requestedBasename
            ? `<span style="color:var(--error-color);">(Requested: ${requestedBasename})</span>`
            : ""
        }
            </div>
            <div id="code-container">
              <pre class="commented-code"><code class="language-python">${cleanCode}</code></pre>
            </div>
            <div class="download-container">
              <button id="downloadCommentsBtn" class="download-btn">
                <i class="fas fa-download"></i>
                Download Commented Code
              </button>
              ${
                currentInstallationId
                  ? `
                <button id="pushCommentsBtn" class="download-btn" style="margin-left: 10px; background: #28a745;">
                  <i class="fas fa-upload"></i>
                  Push to GitHub
                </button>
              `
                  : ""
              }
            </div>
          </div>
        `;

        // Apply syntax highlighting
        document.querySelectorAll(".commented-code code").forEach((block) => {
          hljs.highlightElement(block);
        });

        // Add event listener to the download button
        document
          .getElementById("downloadCommentsBtn")
          .addEventListener("click", () => {
            downloadFile(
              currentCommentedCode,
              data.filename || `commented_${filePath.split("/").pop()}`
            );
          });

        // Add event listener to the GitHub push button if it exists
        const pushButton = document.getElementById("pushCommentsBtn");
        if (pushButton) {
          pushButton.addEventListener("click", async () => {
            pushButton.disabled = true;
            pushButton.innerHTML =
              '<i class="fas fa-spinner fa-spin"></i> Pushing...';

            try {
              await pushCommentsToGitHub(
                repoUrl,
                currentCommentedCode,
                filePath
              );
              pushButton.innerHTML =
                '<i class="fas fa-check"></i> Pushed Successfully!';
              pushButton.style.background = "#2e8555";

              // Show success notification
              showCommentsSuccessNotification(repoUrl);
            } catch (error) {
              console.error("Error pushing comments:", error);
              pushButton.innerHTML =
                '<i class="fas fa-exclamation-triangle"></i> Push Failed';
              pushButton.style.background = "#dc3545";
              pushButton.disabled = false;
              alert(`Failed to push comments: ${error.message}`);
            }
          });
        }
      } else if (data.error) {
        showError(
          "Comment Generation Error",
          data.error,
          "Try selecting a different Python file with clearer code structure."
        );
      } else {
        showError(
          "Unexpected Error",
          "Received an unexpected response from the server.",
          "Please try again later or contact support if the issue persists."
        );
      }
    })
    .catch((error) => {
      console.error("[ERROR] Failed to generate comments:", error);
      showError(
        "Connection Error",
        error.message,
        "There may be an issue with your internet connection or the server may be temporarily unavailable."
      );
    });
}

// Add this new function to handle pushing comments to GitHub
async function pushCommentsToGitHub(
  repoUrl,
  commentedContent,
  originalFilePath
) {
  if (!commentedContent || !currentInstallationId || !originalFilePath) {
    throw new Error("Missing commented content, installation ID, or file path");
  }

  const response = await fetch("/api/push-comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoUrl: repoUrl,
      commentedContent: commentedContent,
      filePath: originalFilePath,
      installationId: currentInstallationId,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to push commented code to GitHub");
  }

  return data;
}

// Add this function to show success notification for comments
function showCommentsSuccessNotification(repoUrl) {
  // Create a temporary success notification
  const successDiv = document.createElement("div");
  successDiv.className = "notification success-notification";
  successDiv.style.marginTop = "15px";
  successDiv.innerHTML = `
    <div class="notification-content">
      <div class="notification-header">
        <div class="notification-header-content">
          <div class="notification-icon">
            <i class="fas fa-check-circle"></i>
          </div>
          <h3>Commented code pushed to GitHub successfully!</h3>
        </div>
        <button class="notification-close" onclick="this.parentElement.parentElement.parentElement.remove()">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <p>
        <a href="${repoUrl}" target="_blank">View the repository on GitHub</a>
      </p>
    </div>
  `;

  // Insert the success message at the top of the container
  const container = document.getElementById("container");
  const containerBody = container.querySelector(".container-body");
  containerBody.insertBefore(successDiv, containerBody.firstChild);

  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (successDiv.parentNode) {
      successDiv.remove();
    }
  }, 10000);
}

// Update the generateCommentsForFile function in scripts.js
function generateCommentsForFile(repoUrl, filePath) {
  // Show loading message
  showLoading(
    "Generating Code Comments",
    `Analyzing ${filePath.split("/").pop()}...`,
    "This process may take up to a minute as we analyze the code for better understanding."
  );

  console.log(`[DEBUG] Generating comments for file: ${filePath}`);

  // Call the backend to generate comments
  fetch("/generate-comments", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      repo_url: repoUrl,
      file_path: filePath,
    }),
  })
    .then((response) => {
      console.log(`[DEBUG] Response status: ${response.status}`);
      if (!response.ok) {
        return response.text().then((text) => {
          try {
            // Try to parse as JSON first
            const jsonData = JSON.parse(text);
            throw new Error(
              jsonData.error || `HTTP error! Status: ${response.status}`
            );
          } catch (e) {
            // If not JSON, return the text or status
            throw new Error(text || `HTTP error! Status: ${response.status}`);
          }
        });
      }
      return response.json();
    })
    .then((data) => {
      console.log(`[DEBUG] Received data:`, data);

      if (data.commented_code) {
        console.log(
          `[DEBUG] File received: ${data.filename}, Original requested: ${filePath}`
        );

        // Check if the filename matches what we expected
        const requestedBasename = filePath.split("/").pop();
        const returnedBasename = data.filename.replace("commented_", "");

        if (!returnedBasename.includes(requestedBasename)) {
          console.warn(
            `[WARNING] Received file ${returnedBasename} doesn't match requested ${requestedBasename}`
          );
        }

        // Store for download and GitHub push
        currentCommentedCode = data.commented_code;
        currentFilename = data.filename;

        // Clean code from any existing formatting markers
        let cleanCode = data.commented_code;

        // If the code contains the specific color markers format, clean them up
        if (cleanCode.includes('"color:#')) {
          cleanCode = cleanCode.replace(/"color:#[0-9a-f]+">([^"]*)/g, "$1");
        }

        metadataDiv.innerHTML = `
          <div class="results-header comments">
            <i class="fas fa-comment-dots"></i>
            <div>
              <h3 class="results-title">Code with Generated Comments</h3>
              <p class="results-subtitle">Enhanced code with explanatory comments for ${requestedBasename}</p>
            </div>
          </div>
          <div class="content-box">
            <div class="repo-url">
              <i class="fab fa-github"></i>
              <a href="${repoUrl}" target="_blank">${repoUrl}</a>
            </div>
            <div class="file-info">
              <i class="fas fa-file-code"></i> ${
                data.filename || filePath.split("/").pop()
              } ${
          returnedBasename !== requestedBasename
            ? `<span style="color:var(--error-color);">(Requested: ${requestedBasename})</span>`
            : ""
        }
            </div>
            <div id="code-container">
              <pre class="commented-code"><code class="language-python">${cleanCode}</code></pre>
            </div>
            <div class="download-container">
              <button id="downloadCommentsBtn" class="download-btn">
                <i class="fas fa-download"></i>
                Download Commented Code
              </button>
              ${
                currentInstallationId
                  ? `
                <button id="pushCommentsBtn" class="download-btn" style="margin-left: 10px; background: #28a745;">
                  <i class="fas fa-upload"></i>
                  Push to GitHub
                </button>
              `
                  : ""
              }
            </div>
          </div>
        `;

        // Apply syntax highlighting
        document.querySelectorAll(".commented-code code").forEach((block) => {
          hljs.highlightElement(block);
        });

        // Add event listener to the download button
        document
          .getElementById("downloadCommentsBtn")
          .addEventListener("click", () => {
            downloadFile(
              currentCommentedCode,
              data.filename || `commented_${filePath.split("/").pop()}`
            );
          });

        // Add event listener to the GitHub push button if it exists
        const pushButton = document.getElementById("pushCommentsBtn");
        if (pushButton) {
          pushButton.addEventListener("click", async () => {
            pushButton.disabled = true;
            pushButton.innerHTML =
              '<i class="fas fa-spinner fa-spin"></i> Pushing...';

            try {
              await pushCommentsToGitHub(
                repoUrl,
                currentCommentedCode,
                filePath
              );
              pushButton.innerHTML =
                '<i class="fas fa-check"></i> Pushed Successfully!';
              pushButton.style.background = "#2e8555";

              // Show success notification
              showCommentsSuccessNotification(repoUrl);
            } catch (error) {
              console.error("Error pushing comments:", error);
              pushButton.innerHTML =
                '<i class="fas fa-exclamation-triangle"></i> Push Failed';
              pushButton.style.background = "#dc3545";
              pushButton.disabled = false;
              alert(`Failed to push comments: ${error.message}`);
            }
          });
        }
      } else if (data.error) {
        showError(
          "Comment Generation Error",
          data.error,
          "Try selecting a different Python file with clearer code structure."
        );
      } else {
        showError(
          "Unexpected Error",
          "Received an unexpected response from the server.",
          "Please try again later or contact support if the issue persists."
        );
      }
    })
    .catch((error) => {
      console.error("[ERROR] Failed to generate comments:", error);
      showError(
        "Connection Error",
        error.message,
        "There may be an issue with your internet connection or the server may be temporarily unavailable."
      );
    });
}

// Add this new function to handle pushing comments to GitHub
async function pushCommentsToGitHub(
  repoUrl,
  commentedContent,
  originalFilePath
) {
  if (!commentedContent || !currentInstallationId || !originalFilePath) {
    throw new Error("Missing commented content, installation ID, or file path");
  }

  const response = await fetch("/api/push-comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoUrl: repoUrl,
      commentedContent: commentedContent,
      filePath: originalFilePath,
      installationId: currentInstallationId,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to push commented code to GitHub");
  }

  return data;
}

// Add this function to show success notification for comments
function showCommentsSuccessNotification(repoUrl) {
  // Create a temporary success notification
  const successDiv = document.createElement("div");
  successDiv.className = "notification success-notification";
  successDiv.style.marginTop = "15px";
  successDiv.innerHTML = `
    <div class="notification-content">
      <div class="notification-header">
        <div class="notification-header-content">
          <div class="notification-icon">
            <i class="fas fa-check-circle"></i>
          </div>
          <h3>Commented code pushed to GitHub successfully!</h3>
        </div>
        <button class="notification-close" onclick="this.parentElement.parentElement.parentElement.remove()">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <p>
        <a href="${repoUrl}" target="_blank">View the repository on GitHub</a>
      </p>
    </div>
  `;

  // Insert the success message at the top of the container
  const container = document.getElementById("container");
  const containerBody = container.querySelector(".container-body");
  containerBody.insertBefore(successDiv, containerBody.firstChild);

  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (successDiv.parentNode) {
      successDiv.remove();
    }
  }, 10000);
}

// Update the "Generate Comments" button click handler to provide better feedback
generateCommentsBtn.addEventListener("click", async () => {
  const repoUrl = form.repo_url.value.trim();

  // Check if the input field is empty
  if (!repoUrl) {
    showError(
      "Invalid Input",
      "Please enter a valid GitHub repository URL.",
      "The URL should be in the format: https://github.com/username/repository"
    );
    return;
  }

  // Extract repo name for download
  repoName = extractRepoName(repoUrl);

  // Show loading message
  showLoading(
    "Fetching Python Files",
    "Searching for Python files in the repository...",
    "This may take a moment for repositories with many files and directories."
  );

  try {
    console.log(`Fetching Python files for repository: ${repoUrl}`);

    // First, fetch the list of Python files in the repository
    const response = await fetch("/fetch-python-files", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ repo_url: repoUrl }),
    });

    console.log(`Response status: ${response.status}`);

    // Check if the response is ok before trying to parse JSON
    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        // If it's JSON, we can parse the error
        const errorData = await response.json();
        showError(
          "Repository Error",
          errorData.error || "Failed to fetch Python files",
          errorData.details ||
            "Please check that the repository URL is correct and publicly accessible."
        );
      } else {
        // If it's not JSON, show a generic error with status
        const errorText = await response.text();
        console.error("Error response:", errorText);
        showError(
          "Server Error",
          `Server responded with status: ${response.status}`,
          "There may be an issue with the server. Please try again later."
        );
      }
      return;
    }

    // Parse the JSON response
    const data = await response.json();
    console.log(
      `Response data received with ${data.files ? data.files.length : 0} files`
    );

    if (data.files && Array.isArray(data.files)) {
      if (data.files.length > 0) {
        console.log(`Found ${data.files.length} Python files. Sample paths:`);
        data.files.slice(0, 5).forEach((file) => {
          console.log(`- ${file.path}`);
        });

        // Store the Python files
        pythonFiles = data.files;

        // Display the file selection UI
        displayFileSelection(pythonFiles, repoUrl);
      } else {
        showError(
          "No Python Files Found",
          "No Python files were found in this repository.",
          "Please try a different repository that contains Python code."
        );
      }
    } else if (data.error) {
      showError(
        "File Fetch Error",
        data.error,
        data.details ||
          "Try using a repository with Python files or check the repository URL."
      );
    } else {
      showError(
        "Unexpected Response",
        "Received an unexpected response format from the server.",
        "Please try again later or contact support if the issue persists."
      );
    }
  } catch (error) {
    console.error("Error in fetch operation:", error);
    showError(
      "Connection Error",
      error.message,
      "There may be an issue with your internet connection or the server may be temporarily unavailable."
    );
  }
});

// Get reference to the CodeT5 Inference button
const runCodeT5InferenceBtn = document.getElementById("runCodeT5InferenceBtn");

// Add event listener for the CodeT5 Inference button
runCodeT5InferenceBtn.addEventListener("click", async () => {
  const repoUrl = form.repo_url.value.trim();

  // Check if the input field is empty
  if (!repoUrl) {
    showError(
      "Invalid Input",
      "Please enter a valid GitHub repository URL.",
      "The URL should be in the format: https://github.com/username/repository"
    );
    return;
  }

  // Extract repo name for reference
  repoName = extractRepoName(repoUrl);

  // Show loading message
  showLoading(
    "Running CodeT5 Inference",
    "Analyzing code and generating function summaries...",
    "This process may take a few minutes depending on the repository size. Both the CodeT5 model and call graph analysis are running."
  );

  try {
    const response = await fetch("/run-codet5-inference", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ repo_url: repoUrl }),
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await response.json();
        showError(
          "Code Analysis Error",
          errorData.error || "Failed to run code analysis",
          errorData.details || "There was a problem analyzing the repository."
        );
      } else {
        const errorText = await response.text();
        showError(
          "Server Error",
          `Server responded with status: ${response.status}`,
          "There may be an issue with the server. Please try again later."
        );
      }
      return;
    }

    const data = await response.json();

    if (data.success) {
      displayCodeAnalysisResults(data, repoUrl);
    } else if (data.error) {
      showError(
        "Code Analysis Error",
        data.error,
        "Try using a repository with clearer code structure or contact support if the issue persists."
      );
    } else {
      showError(
        "Unexpected Error",
        "Received an unexpected response from the server.",
        "Please try again later or contact support if the issue persists."
      );
    }
  } catch (error) {
    console.error("Error running CodeT5 inference:", error);
    showError(
      "Connection Error",
      error.message,
      "There may be an issue with your internet connection or the server may be temporarily unavailable."
    );
  }
});

// Function to display code analysis results
function displayCodeAnalysisResults(data, repoUrl) {
  const { repo_name, results } = data;
  const { function_summaries, callgraph_path } = results;

  // Create a tabbed interface for function summaries and call graph
  metadataDiv.innerHTML = `
    <div class="results-header">
      <i class="fas fa-microchip" style="color: #6366F1;"></i>
      <div>
        <h3 class="results-title">CodeT5 Analysis Results</h3>
        <p class="results-subtitle">Code analysis and call graph generation completed successfully</p>
      </div>
    </div>
    <div class="content-box">
      <div class="repo-url">
        <i class="fab fa-github"></i>
        <a href="${repoUrl}" target="_blank">${repoUrl}</a>
      </div>
      
      <div class="success-message" style="text-align: center; padding: 10px 0;">
        <p style="font-size: 16px; color: #2e8555; margin-bottom: 10px;">
          <i class="fas fa-check-circle"></i> Successfully analyzed repository code structure
        </p>
      </div>
      
      <div class="analysis-section">
        <div class="analysis-tabs">
          <div class="analysis-tab active" id="functionSummariesTab">Function Summaries</div>
          <div class="analysis-tab" id="callgraphTab">Call Graph</div>
        </div>
        
        <div class="analysis-content" id="functionSummariesContent">
          ${renderFunctionSummaries(function_summaries)}
        </div>
        
        <div class="analysis-content" id="callgraphContent" style="display: none;">
          ${
            callgraph_path
              ? `
              <div style="text-align: center; padding: 20px;">
                <p style="margin-bottom: 15px;">The call graph has been generated and is ready for download.</p>
                <button id="downloadCallgraphBtn" class="download-btn">
                  <i class="fas fa-download"></i>
                  Download Call Graph
                </button>
              </div>
              `
              : `<p>No call graph was generated. There may not be enough functions to create a meaningful call graph.</p>`
          }
        </div>
      </div>
    </div>
  `;

  // Add tab switching functionality
  document
    .getElementById("functionSummariesTab")
    .addEventListener("click", () => {
      document.getElementById("functionSummariesTab").classList.add("active");
      document.getElementById("callgraphTab").classList.remove("active");
      document.getElementById("functionSummariesContent").style.display =
        "block";
      document.getElementById("callgraphContent").style.display = "none";
    });

  document.getElementById("callgraphTab").addEventListener("click", () => {
    document.getElementById("callgraphTab").classList.add("active");
    document.getElementById("functionSummariesTab").classList.remove("active");
    document.getElementById("functionSummariesContent").style.display = "none";
    document.getElementById("callgraphContent").style.display = "block";
  });

  // Add event listener to download call graph if available
  if (callgraph_path) {
    document
      .getElementById("downloadCallgraphBtn")
      .addEventListener("click", () => {
        downloadCallgraph(callgraph_path);
      });
  }
}

// Function to render function summaries
function renderFunctionSummaries(summaries) {
  if (!summaries || Object.keys(summaries).length === 0) {
    return `<p>No function summaries were generated. The repository may not contain Python functions or classes.</p>`;
  }

  let html = `<div class="function-summaries-container">`;

  // Loop through folders
  for (const folderPath in summaries) {
    html += `<h3 style="margin-top: 20px; margin-bottom: 10px; color: #24292e;">${
      folderPath || "Root"
    }</h3>`;

    // Loop through files in this folder
    for (const fileName in summaries[folderPath]) {
      html += `<h4 style="margin-top: 15px; margin-bottom: 8px; color: #0366d6; font-size: 16px;">📄 ${fileName}</h4>`;

      // Get the functions for this file
      const fileFunctions = summaries[folderPath][fileName];

      // Only proceed if there are functions
      if (fileFunctions && Object.keys(fileFunctions).length > 0) {
        // Loop through each function
        for (const funcName in fileFunctions) {
          const func = fileFunctions[funcName];
          if (func && func.code && func.summary) {
            html += `
              <div class="function-summary">
                <h4>function ${funcName}()</h4>
                <div class="function-details">
                  <span class="function-detail">💡 Summary</span>
                </div>
                <p>${func.summary}</p>
                <div class="function-code">${escapeHtml(func.code)}</div>
              </div>
            `;
          }
        }
      } else {
        html += `<p>No functions found in this file.</p>`;
      }
    }
  }

  html += `</div>`;
  return html;
}

// Helper function to escape HTML
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Add reference to the Llama Inference button - add this near the top with other button refs
const runLlamaInferenceBtn = document.getElementById("runLlamaInferenceBtn");

// Add this function to handle generating README with Llama
// async function generateReadmeWithLlama(repoUrl) {
//   // Show loading message
//   showLoading(
//     "Generating README with Llama",
//     "Analyzing repository data and generating comprehensive documentation...",
//     "This process may take a few minutes as the Llama model analyzes all available repository data."
//   );

//   try {
//     const response = await fetch("/run-llama-inference", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: new URLSearchParams({ repo_url: repoUrl }),
//     });

//     const data = await response.json();
//     if (data.readme) {
//       displayReadmeResults(data, repoUrl, "llama-inference");
//     } else if (data.error) {
//       showError(
//         "Llama README Generation Error",
//         data.error,
//         data.details ||
//           "Try running CodeT5 inference first to generate the necessary analysis data."
//       );
//     } else {
//       showError(
//         "Unexpected Error",
//         "Received an unexpected response from the server.",
//         "Please try again later or contact support if the issue persists."
//       );
//     }
//   } catch (error) {
//     showError(
//       "Connection Error",
//       error.message,
//       "There may be an issue with your internet connection or the server may be temporarily unavailable."
//     );
//   }
// }

// Add event listener for the Llama Inference button - add this at the end of the file
if (runLlamaInferenceBtn) {
  runLlamaInferenceBtn.addEventListener("click", async () => {
    const repoUrl = form.repo_url.value.trim();

    // Check if the input field is empty
    if (!repoUrl) {
      showError(
        "Invalid Input",
        "Please enter a valid GitHub repository URL.",
        "The URL should be in the format: https://github.com/username/repository"
      );
      return;
    }

    // Extract repo name for download
    repoName = extractRepoName(repoUrl);

    // Check if CodeT5 inference has been run first
    fetch("/check-analysis-files", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ repo_url: repoUrl }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.analysisExists) {
          // Files exist, proceed with Llama inference
          generateReadmeWithLlama(repoUrl);
        } else {
          // Files don't exist, show error and suggest running CodeT5 first
          showError(
            "Analysis Files Missing",
            "Repository analysis files not found.",
            "Please run CodeT5 inference first to generate the necessary analysis data for Llama."
          );
        }
      })
      .catch((error) => {
        console.error("Error checking analysis files:", error);
        // If check fails, still try to run Llama inference
        generateReadmeWithLlama(repoUrl);
      });
  });
}

// Add this function after the extractRepoName function
// This will check if the repository's primary language is Python
async function checkRepositoryLanguage(repoUrl) {
  // Extract owner and repo from URL
  try {
    const urlParts = new URL(repoUrl).pathname.split("/");
    if (urlParts.length < 3) {
      throw new Error("Invalid repository URL format");
    }

    const owner = urlParts[1];
    const repo = urlParts[2];

    // Make a request to GitHub API to get repository languages
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/languages`
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const languages = await response.json();

    // Calculate total bytes of code
    const totalBytes = Object.values(languages).reduce(
      (sum, bytes) => sum + bytes,
      0
    );

    // Check if Python exists and its percentage
    const pythonBytes = languages.Python || 0;
    const pythonPercentage = (pythonBytes / totalBytes) * 100;

    // Consider it a Python repo if Python makes up at least 30% of the codebase
    // or if it's the most used language
    const isPythonRepo =
      pythonPercentage >= 40 ||
      (pythonBytes > 0 &&
        pythonBytes === Math.max(...Object.values(languages)));

    return {
      isPythonRepo,
      languages,
      primaryLanguage: Object.keys(languages).reduce(
        (a, b) => (languages[a] > languages[b] ? a : b),
        ""
      ),
      pythonPercentage: pythonPercentage.toFixed(2),
    };
  } catch (error) {
    console.error("Error checking repository language:", error);
    throw error;
  }
}

// Add this function to disable all buttons when repository is not Python-based
function disableAllButtons(message) {
  // Disable all operation buttons except fetch metadata
  document
    .querySelectorAll(".button-container button:not(.fetch-metadata-btn)")
    .forEach((button) => {
      button.disabled = true;
      button.style.opacity = "0.5";
      button.style.cursor = "not-allowed";
    });

  // Show warning message
  showError(
    "Non-Python Repository",
    message,
    "This tool is designed to work with Python repositories. Please try again with a Python-based project."
  );
}

// Function to enable all buttons
function enableAllButtons() {
  document.querySelectorAll(".button-container button").forEach((button) => {
    button.disabled = false;
    button.style.opacity = "1";
    button.style.cursor = "pointer";
  });
}

// Modify the existing form submit event listener
// form.addEventListener("submit", async (e) => {
//   e.preventDefault(); // Prevent the default form submission behavior

//   const repoUrl = form.repo_url.value.trim();
//   if (!repoUrl) {
//     showError("Invalid Input", "Please enter a valid GitHub repository URL.");
//     return;
//   }

//   // Extract repo name for later use
//   repoName = extractRepoName(repoUrl);

//   // Show loading message
//   showLoading(
//     "Fetching Repository Data",
//     "Retrieving metadata from GitHub...",
//     "This should only take a moment."
//   );

//   try {
//     // First check if the repository is Python-based
//     let languageInfo;
//     try {
//       languageInfo = await checkRepositoryLanguage(repoUrl);

//       // If not a Python repo, show warning and disable buttons
//       if (!languageInfo.isPythonRepo) {
//         const primaryLang = languageInfo.primaryLanguage || "Unknown";
//         const message = `This repository's primary language is ${primaryLang} (Python: ${languageInfo.pythonPercentage}%).`;
//         disableAllButtons(message);

//         // Still fetch metadata but disable other operations
//         const metadataResponse = await fetch("/fetch-metadata", {
//           method: "POST",
//           headers: {
//             "Content-Type": "application/x-www-form-urlencoded",
//           },
//           body: new URLSearchParams({
//             repo_url: repoUrl,
//           }),
//         });

//         if (metadataResponse.ok) {
//           const metadata = await metadataResponse.json();
//           displayMetadata(metadata, repoUrl);

//           // Add a warning about Python content
//           const warningElement = document.createElement("div");
//           warningElement.className = "error-message";
//           warningElement.innerHTML = `
//             <p><strong>Warning:</strong> ${message}</p>
//             <p>This tool works best with repositories that are predominantly Python-based.</p>
//           `;

//           // Insert the warning after the metadata stats
//           const contentBox = document.querySelector(".content-box");
//           contentBox.insertBefore(warningElement, contentBox.firstChild);
//         }

//         return;
//       } else {
//         // If it's a Python repo, enable all buttons
//         enableAllButtons();
//       }
//     } catch (langError) {
//       console.error("Error checking repository language:", langError);
//       // Continue with metadata fetch even if language check fails
//     }

//     // Send a POST request using fetch for metadata
//     const response = await fetch("/fetch-metadata", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: new URLSearchParams({
//         repo_url: repoUrl,
//       }),
//     });

//     if (!response.ok) {
//       // Handle non-200 responses
//       const errorMessage = await response.text();
//       showError(
//         "Repository Error",
//         errorMessage,
//         "Please check that the repository URL is correct and publicly accessible."
//       );
//       return;
//     }

//     const metadata = await response.json();
//     // Display the metadata
//     displayMetadata(metadata, repoUrl);

//     // If we have language info, display it alongside metadata
//     if (languageInfo && languageInfo.isPythonRepo) {
//       // Add a success notice about Python content
//       const noticeElement = document.createElement("div");
//       noticeElement.style =
//         "background-color: #ecfdf0; border-left: 4px solid #2da44e; padding: 1rem; border-radius: 6px; margin-top: 1rem;";
//       noticeElement.innerHTML = `
//         <p style="margin-bottom: 0.5rem;"><strong>Python Repository Detected</strong></p>
//         <p style="font-size: 0.9rem; margin: 0;">Python makes up approximately ${languageInfo.pythonPercentage}% of the codebase.</p>
//       `;

//       // Insert the notice after the metadata stats
//       const contentBox = document.querySelector(".content-box");
//       contentBox.appendChild(noticeElement);
//     }
//   } catch (error) {
//     showError(
//       "Connection Error",
//       error.message,
//       "There may be an issue with your internet connection or the server may be temporarily unavailable."
//     );
//   }
// });

// Modify this function in scripts.js
// form.addEventListener("submit", async (e) => {
//   e.preventDefault(); // Prevent the default form submission behavior

//   const repoUrl = form.repo_url.value.trim();
//   if (!repoUrl) {
//     showError("Invalid Input", "Please enter a valid GitHub repository URL.");
//     return;
//   }

//   // Extract repo name for later use
//   repoName = extractRepoName(repoUrl);

//   // Show loading message
//   showLoading(
//     "Fetching Repository Data",
//     "Retrieving metadata from GitHub...",
//     "This should only take a moment."
//   );

//   try {
//     // Remove Python language check completely to simplify
//     // Send a POST request using fetch for metadata
//     const response = await fetch("/fetch-metadata", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//       body: new URLSearchParams({
//         repo_url: repoUrl,
//       }),
//     });

//     if (!response.ok) {
//       // Handle non-200 responses
//       const errorMessage = await response.text();
//       showError(
//         "Repository Error",
//         errorMessage,
//         "Please check that the repository URL is correct and publicly accessible."
//       );
//       return;
//     }

//     const metadata = await response.json();
//     // Display the metadata
//     displayMetadata(metadata, repoUrl);

//     // Always enable all our buttons
//     document.querySelector(".generate-readme-btn").disabled = false;
//     document.querySelector(".generate-comments-btn").disabled = false;
//   } catch (error) {
//     showError(
//       "Connection Error",
//       error.message,
//       "There may be an issue with your internet connection or the server may be temporarily unavailable."
//     );
//   }
// });

// Modify this function in scripts.js, but KEEP the Python language check
form.addEventListener("submit", async (e) => {
  e.preventDefault(); // Prevent the default form submission behavior

  console.log("Form submission intercepted"); // Add this line for debugging

  const repoUrl = form.repo_url.value.trim();
  if (!repoUrl) {
    showError("Invalid Input", "Please enter a valid GitHub repository URL.");
    return;
  }

  // Extract repo name for later use
  repoName = extractRepoName(repoUrl);

  // Show loading message
  showLoading(
    "Fetching Repository Data",
    "Retrieving metadata from GitHub...",
    "This should only take a moment."
  );

  try {
    // First check if the repository is Python-based
    let languageInfo;
    try {
      languageInfo = await checkRepositoryLanguage(repoUrl);

      // If not a Python repo, show warning and disable buttons
      if (!languageInfo.isPythonRepo) {
        const primaryLang = languageInfo.primaryLanguage || "Unknown";
        const message = `This repository's primary language is ${primaryLang} (Python: ${languageInfo.pythonPercentage}%).`;
        disableAllButtons(message);

        // Still fetch metadata but disable other operations
        const metadataResponse = await fetch("/fetch-metadata", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            repo_url: repoUrl,
          }),
        });

        if (metadataResponse.ok) {
          const metadata = await metadataResponse.json();
          displayMetadata(metadata, repoUrl);

          // Add a warning about Python content
          const warningElement = document.createElement("div");
          warningElement.className = "error-message";
          warningElement.innerHTML = `
            <p><strong>Warning:</strong> ${message}</p>
            <p>This tool works best with repositories that are predominantly Python-based.</p>
          `;

          // Insert the warning after the metadata stats
          const contentBox = document.querySelector(".content-box");
          contentBox.insertBefore(warningElement, contentBox.firstChild);
        }

        return;
      } else {
        // If it's a Python repo, enable all buttons
        enableAllButtons();
      }
    } catch (langError) {
      console.error("Error checking repository language:", langError);
      // Continue with metadata fetch even if language check fails
      // Importantly, make sure to enable buttons even if the language check fails
      enableAllButtons();
    }

    // Send a POST request using fetch for metadata
    const response = await fetch("/fetch-metadata", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        repo_url: repoUrl,
      }),
    });

    if (!response.ok) {
      // Handle non-200 responses
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await response.json();
        showError(
          "Repository Error",
          errorData.error || `Server responded with status: ${response.status}`,
          errorData.details ||
            "Please check that the repository URL is correct and publicly accessible."
        );
      } else {
        const errorText = await response.text();
        showError(
          "Repository Error",
          errorText || `Server responded with status: ${response.status}`,
          "Please check that the repository URL is correct and publicly accessible."
        );
      }
      return;
    }

    const metadata = await response.json();
    // Display the metadata
    displayMetadata(metadata, repoUrl);

    // If we have language info, display it alongside metadata
    if (languageInfo && languageInfo.isPythonRepo) {
      // Add a success notice about Python content
      const noticeElement = document.createElement("div");
      noticeElement.style =
        "background-color: #ecfdf0; border-left: 4px solid #2da44e; padding: 1rem; border-radius: 6px; margin-top: 1rem;";
      noticeElement.innerHTML = `
        <p style="margin-bottom: 0.5rem;"><strong>Python Repository Detected</strong></p>
        <p style="font-size: 0.9rem; margin: 0;">Python makes up approximately ${languageInfo.pythonPercentage}% of the codebase.</p>
      `;

      // Insert the notice after the metadata stats
      const contentBox = document.querySelector(".content-box");
      contentBox.appendChild(noticeElement);
    }
  } catch (error) {
    console.error("Error in fetch operation:", error);
    showError(
      "Connection Error",
      error.message,
      "There may be an issue with your internet connection or the server may be temporarily unavailable."
    );
  }
});

// Add this new click event handler for the Fetch Metadata button
fetchMetadataBtn.addEventListener("click", async () => {
  console.log("Fetch Metadata button clicked"); // Debugging log

  const repoUrl = form.repo_url.value.trim();
  if (!repoUrl) {
    showError("Invalid Input", "Please enter a valid GitHub repository URL.");
    return;
  }

  // Extract repo name for later use
  repoName = extractRepoName(repoUrl);

  // Show loading message
  showLoading(
    "Fetching Repository Data",
    "Retrieving metadata from GitHub...",
    "This should only take a moment."
  );

  try {
    // First check if the repository is Python-based
    let languageInfo;
    try {
      languageInfo = await checkRepositoryLanguage(repoUrl);

      // If not a Python repo, show warning and disable buttons
      if (!languageInfo.isPythonRepo) {
        const primaryLang = languageInfo.primaryLanguage || "Unknown";
        const message = `This repository's primary language is ${primaryLang} (Python: ${languageInfo.pythonPercentage}%).`;
        disableAllButtons(message);

        // Still fetch metadata but disable other operations
        const metadataResponse = await fetch("/fetch-metadata", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            repo_url: repoUrl,
          }),
        });

        if (metadataResponse.ok) {
          const metadata = await metadataResponse.json();
          displayMetadata(metadata, repoUrl);

          // Add a warning about Python content
          const warningElement = document.createElement("div");
          warningElement.className = "error-message";
          warningElement.innerHTML = `
            <p><strong>Warning:</strong> ${message}</p>
            <p>This tool works best with repositories that are predominantly Python-based.</p>
          `;

          // Insert the warning after the metadata stats
          const contentBox = document.querySelector(".content-box");
          contentBox.insertBefore(warningElement, contentBox.firstChild);
        }

        return;
      } else {
        // If it's a Python repo, enable all buttons
        enableAllButtons();
      }
    } catch (langError) {
      console.error("Error checking repository language:", langError);
      // Continue with metadata fetch even if language check fails
      // Importantly, make sure to enable buttons even if the language check fails
      enableAllButtons();
    }

    // Send a POST request using fetch for metadata
    const response = await fetch("/fetch-metadata", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        repo_url: repoUrl,
      }),
    });

    if (!response.ok) {
      // Handle non-200 responses
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await response.json();
        showError(
          "Repository Error",
          errorData.error || `Server responded with status: ${response.status}`,
          errorData.details ||
            "Please check that the repository URL is correct and publicly accessible."
        );
      } else {
        const errorText = await response.text();
        showError(
          "Repository Error",
          errorText || `Server responded with status: ${response.status}`,
          "Please check that the repository URL is correct and publicly accessible."
        );
      }
      return;
    }

    const metadata = await response.json();
    // Display the metadata
    displayMetadata(metadata, repoUrl);

    // If we have language info, display it alongside metadata
    if (languageInfo && languageInfo.isPythonRepo) {
      // Add a success notice about Python content
      const noticeElement = document.createElement("div");
      noticeElement.style =
        "background-color: #ecfdf0; border-left: 4px solid #2da44e; padding: 1rem; border-radius: 6px; margin-top: 1rem;";
      noticeElement.innerHTML = `
        <p style="margin-bottom: 0.5rem;"><strong>Python Repository Detected</strong></p>
        <p style="font-size: 0.9rem; margin: 0;">Python makes up approximately ${languageInfo.pythonPercentage}% of the codebase.</p>
      `;

      // Insert the notice after the metadata stats
      const contentBox = document.querySelector(".content-box");
      contentBox.appendChild(noticeElement);
    }
  } catch (error) {
    console.error("Error in fetch operation:", error);
    showError(
      "Connection Error",
      error.message,
      "There may be an issue with your internet connection or the server may be temporarily unavailable."
    );
  }
});

// Add a simple test click handler
if (fetchMetadataBtn) {
  console.log("Fetch metadata button found in the DOM");

  // Remove any existing event listeners (just in case)
  fetchMetadataBtn.replaceWith(fetchMetadataBtn.cloneNode(true));

  // Get a fresh reference after cloning
  const newFetchBtn = document.querySelector(".fetch-metadata-btn");

  // Add a basic click handler for testing
  newFetchBtn.addEventListener("click", function (e) {
    e.preventDefault(); // Prevent default behavior
    console.log("Fetch Metadata button clicked!");

    const repoUrl = form.repo_url.value.trim();
    if (!repoUrl) {
      alert("Please enter a GitHub repository URL");
      return;
    }

    // Show a simple alert for testing
    alert("Fetching metadata for: " + repoUrl);

    // Then proceed with your actual code
    handleFetchMetadata(repoUrl);
  });
} else {
  console.error("Fetch metadata button not found in the DOM!");
}

// Define a separate function to handle the actual fetching logic
async function handleFetchMetadata(repoUrl) {
  // Show loading message
  showLoading(
    "Fetching Repository Data",
    "Retrieving metadata from GitHub...",
    "This should only take a moment."
  );

  try {
    // Extract repo name for later use
    repoName = extractRepoName(repoUrl);

    // ADD this line right after: repoName = extractRepoName(repoUrl);

    // Also extract repo info for GitHub App integration
    const repoInfo = extractRepoInfo(repoUrl);

    // First check if the repository is Python-based (rest of your original code)
    let languageInfo;
    try {
      languageInfo = await checkRepositoryLanguage(repoUrl);
      // Rest of your language check code...
    } catch (langError) {
      console.error("Error checking repository language:", langError);
      enableAllButtons();
    }

    // Send a POST request using fetch for metadata
    console.log("Sending fetch metadata request to server for:", repoUrl);
    const response = await fetch("/fetch-metadata", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        repo_url: repoUrl,
      }),
    });

    console.log("Fetch metadata response status:", response.status);

    if (!response.ok) {
      // Handle error responses
      // Your existing error handling code...
      return;
    }

    const metadata = await response.json();
    console.log("Received metadata:", metadata);

    // Display the metadata
    displayMetadata(metadata, repoUrl);

    // Rest of your code for handling language info...
  } catch (error) {
    console.error("Error in fetch metadata operation:", error);
    showError(
      "Connection Error",
      error.message,
      "There may be an issue with your internet connection or the server may be temporarily unavailable."
    );
  }
}

// REPLACE your existing push notification functions in scripts.js with these:

// Enhanced real-time push notification functions
function startPushNotificationCheck() {
  // Check immediately on page load
  checkForPushNotifications();

  // Then check every 5 seconds for real-time updates (much faster!)
  setInterval(checkForPushNotifications, 5000);
}

async function checkForPushNotifications() {
  // Only check if we have an installation ID (GitHub App user)
  if (!currentInstallationId) return;

  try {
    // Check for updates across ALL repositories for this installation
    const response = await fetch(
      `/api/check-updates-global/${currentInstallationId}`
    );
    const data = await response.json();

    if (data.hasPendingUpdate) {
      showPushNotification(data.update);
    }
  } catch (error) {
    console.error("Error checking for updates:", error);
  }
}

function showPushNotification(update) {
  const notification = document.getElementById("pushNotification");
  const message = document.getElementById("pushMessage");

  // Enhanced message with repository info
  message.innerHTML = `
    A new commit <strong>"${update.message}"</strong> was detected in 
    <strong>${update.repository.full_name}</strong>. Generate updated README?
  `;

  // Store the repository info for easy access
  currentRepo = update.repository.full_name;

  // Auto-fill the repository URL
  const repoInput = document.querySelector('input[name="repo_url"]');
  if (repoInput) {
    repoInput.value = update.repository.html_url;
  }

  notification.style.display = "block";

  // Add pulsing effect to draw attention
  notification.style.animation = "slideInDown 0.6s ease-out, pulse 2s infinite";
}

async function generateUpdatedReadme() {
  dismissNotification();

  // Auto-trigger README generation with the detected repository
  const repoInput = document.querySelector('input[name="repo_url"]');
  if (repoInput && repoInput.value) {
    // Click the generate README button
    const generateBtn = document.getElementById("generateReadmeBtn");
    generateBtn.click();
  } else {
    alert(
      "Repository URL not found. Please enter the repository URL manually."
    );
  }
}

function dismissNotification() {
  const notification = document.getElementById("pushNotification");
  notification.style.animation = "slideOutUp 0.4s ease-in";

  setTimeout(() => {
    notification.style.display = "none";
    notification.style.animation = "";
  }, 400);

  // Clear the pending update
  if (currentInstallationId) {
    fetch(`/api/clear-update-global/${currentInstallationId}`, {
      method: "POST",
    });
  }
}

function showReadmePopup() {
  document.getElementById("readmePopup").style.display = "flex";
}

function closeReadmePopup() {
  document.getElementById("readmePopup").style.display = "none";
}

function closeSuccessNotification() {
  const notification = document.getElementById("successNotification");
  notification.style.display = "none";
}

async function pushReadmeToGitHub() {
  if (!generatedReadme || !currentInstallationId) {
    throw new Error("Missing README content or installation ID");
  }

  const repoUrl = document.querySelector('input[name="repo_url"]').value;

  const response = await fetch("/api/push-readme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoUrl: repoUrl,
      readmeContent: generatedReadme,
      installationId: currentInstallationId,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to push README to GitHub");
  }

  // Show success message in the UI
  const metadataDiv = document.getElementById("metadata");
  const successDiv = document.createElement("div");
  successDiv.className = "success-message";
  successDiv.style.marginTop = "15px";
  successDiv.innerHTML = `
    <i class="fas fa-check-circle"></i>
    <p><strong>README pushed to GitHub successfully!</strong></p>
    <p><a href="${data.commit_url}" target="_blank">View the commit on GitHub</a></p>
  `;

  // Insert the success message after the repo URL
  const repoUrlDiv = document.querySelector(".repo-url");
  if (repoUrlDiv) {
    repoUrlDiv.parentNode.insertBefore(successDiv, repoUrlDiv.nextSibling);
  }

  return data;
}

// ADD this function at the end of your scripts.js file

function addGitHubPushButton() {
  // Find the download container and add a GitHub push button
  const downloadContainer = document.querySelector(".download-container");

  if (downloadContainer) {
    // Create the GitHub push button
    const pushButton = document.createElement("button");
    pushButton.id = "pushToGitHubBtn";
    pushButton.className = "download-btn";
    pushButton.style.marginLeft = "10px";
    pushButton.style.background = "#28a745";
    pushButton.innerHTML = '<i class="fas fa-upload"></i> Push to GitHub';

    // Add click event listener
    pushButton.addEventListener("click", async () => {
      pushButton.disabled = true;
      pushButton.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Pushing...';

      try {
        await pushReadmeToGitHub();
        pushButton.innerHTML =
          '<i class="fas fa-check"></i> Pushed Successfully!';
        pushButton.style.background = "#2e8555";
      } catch (error) {
        pushButton.innerHTML =
          '<i class="fas fa-exclamation-triangle"></i> Push Failed';
        pushButton.style.background = "#dc3545";
        pushButton.disabled = false;
      }
    });

    // Append the button to the download container
    downloadContainer.appendChild(pushButton);
  }
}
