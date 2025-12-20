#!/bin/sh
# Grove CLI installer
# Usage: curl -fsSL https://safia.rocks/grove/install.sh | sh
# Usage with version: curl -fsSL https://safia.rocks/grove/install.sh | sh -s -- v1.0.0
# Usage with PR: curl -fsSL https://safia.rocks/grove/install.sh | sh -s -- --pr 6

set -e

REPO="captainsafia/grove"
INSTALL_DIR="${GROVE_INSTALL_DIR:-$HOME/.grove/bin}"
BINARY_NAME="grove"
REQUESTED_VERSION=""
PR_NUMBER=""

# Parse arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --pr)
            PR_NUMBER="$2"
            shift 2
            ;;
        -*)
            echo "Unknown option: $1"
            exit 1
            ;;
        *)
            REQUESTED_VERSION="$1"
            shift
            ;;
    esac
done

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)     echo "linux" ;;
        Darwin*)    echo "darwin" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)          echo "unknown" ;;
    esac
}

# Detect architecture
detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)   echo "x64" ;;
        arm64|aarch64)  echo "arm64" ;;
        *)              echo "unknown" ;;
    esac
}

# Detect current shell
detect_shell() {
    # First try to get the shell from SHELL environment variable
    if [ -n "$SHELL" ]; then
        case "$SHELL" in
            */bash)  echo "bash" ;;
            */zsh)   echo "zsh" ;;
            */fish)  echo "fish" ;;
            */ksh)   echo "ksh" ;;
            */tcsh)  echo "tcsh" ;;
            */csh)   echo "csh" ;;
            *)       basename "$SHELL" ;;
        esac
    else
        # Fallback to checking parent process
        ps -p $$ -o comm= | sed 's/^-//'
    fi
}

# Get shell config file path
get_shell_config() {
    SHELL_NAME="$1"
    case "$SHELL_NAME" in
        bash)
            if [ -f "$HOME/.bash_profile" ]; then
                echo "$HOME/.bash_profile"
            else
                echo "$HOME/.bashrc"
            fi
            ;;
        zsh)
            echo "$HOME/.zshrc"
            ;;
        fish)
            echo "$HOME/.config/fish/config.fish"
            ;;
        ksh)
            echo "$HOME/.kshrc"
            ;;
        tcsh)
            echo "$HOME/.tcshrc"
            ;;
        csh)
            echo "$HOME/.cshrc"
            ;;
        *)
            echo "$HOME/.profile"
            ;;
    esac
}

# Get shell-specific PATH export command
get_path_export_cmd() {
    SHELL_NAME="$1"
    INSTALL_PATH="$2"
    case "$SHELL_NAME" in
        fish)
            echo "set -gx PATH \"${INSTALL_PATH}\" \$PATH"
            ;;
        csh|tcsh)
            echo "setenv PATH \"${INSTALL_PATH}:\$PATH\""
            ;;
        *)
            echo "export PATH=\"${INSTALL_PATH}:\$PATH\""
            ;;
    esac
}

# Get shell-specific source command
get_source_cmd() {
    SHELL_NAME="$1"
    CONFIG_FILE="$2"
    case "$SHELL_NAME" in
        fish)
            echo "source ${CONFIG_FILE}"
            ;;
        csh|tcsh)
            echo "source ${CONFIG_FILE}"
            ;;
        *)
            echo "source ${CONFIG_FILE}"
            ;;
    esac
}

# Get the latest release version
get_latest_version() {
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | 
        grep '"tag_name":' | 
        sed -E 's/.*"([^"]+)".*/\1/'
}

# Get the latest workflow run for a PR
get_pr_artifact_url() {
    PR_NUM="$1"
    BINARY="$2"
    
    # Get the latest workflow run for this PR
    RUN_INFO=$(curl -fsSL "https://api.github.com/repos/${REPO}/actions/runs?event=pull_request&status=success&per_page=50" | \
        grep -E '"id"|"head_branch"|"pull_requests"' | \
        head -100)
    
    # Find runs associated with this PR by checking PR artifacts
    ARTIFACTS_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/actions/runs?event=pull_request&status=success&per_page=20" | \
        grep -E '"artifacts_url"' | head -1 | sed -E 's/.*"artifacts_url": *"([^"]+)".*/\1/')
    
    if [ -z "$ARTIFACTS_URL" ]; then
        return 1
    fi
    
    # Search for artifact matching the PR number
    ARTIFACT_INFO=$(curl -fsSL "https://api.github.com/repos/${REPO}/actions/artifacts?per_page=100" | \
        grep -E "grove-pr-${PR_NUM}-" | head -1)
    
    if [ -z "$ARTIFACT_INFO" ]; then
        return 1
    fi
    
    # Extract the artifact ID
    ARTIFACT_ID=$(curl -fsSL "https://api.github.com/repos/${REPO}/actions/artifacts?per_page=100" | \
        grep -B5 "grove-pr-${PR_NUM}-" | grep '"id"' | head -1 | sed -E 's/.*"id": *([0-9]+).*/\1/')
    
    if [ -z "$ARTIFACT_ID" ]; then
        return 1
    fi
    
    echo "$ARTIFACT_ID"
}

# Install from PR artifacts
install_from_pr() {
    PR_NUM="$1"
    OS="$2"
    ARCH="$3"
    
    echo "Fetching PR #${PR_NUM} artifacts..."
    
    # Get artifact info
    ARTIFACTS_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/actions/artifacts?per_page=100")
    
    # Find the latest artifact for this PR
    ARTIFACT_NAME=$(echo "$ARTIFACTS_JSON" | grep -o "grove-pr-${PR_NUM}-[^\"]*" | head -1)
    
    if [ -z "$ARTIFACT_NAME" ]; then
        echo "Error: No artifacts found for PR #${PR_NUM}"
        echo ""
        echo "Make sure the PR has a successful build. You can check at:"
        echo "  https://github.com/${REPO}/pull/${PR_NUM}"
        exit 1
    fi
    
    ARTIFACT_ID=$(echo "$ARTIFACTS_JSON" | grep -B5 "\"${ARTIFACT_NAME}\"" | grep '"id"' | head -1 | sed -E 's/.*"id": *([0-9]+).*/\1/')
    
    if [ -z "$ARTIFACT_ID" ]; then
        echo "Error: Could not find artifact ID for PR #${PR_NUM}"
        exit 1
    fi
    
    echo "Found artifact: ${ARTIFACT_NAME} (ID: ${ARTIFACT_ID})"
    echo ""

    # Check if gh CLI is available and authenticated
    if command -v gh >/dev/null 2>&1; then
        # Check if gh is authenticated
        if gh auth status >/dev/null 2>&1; then
            echo "Using GitHub CLI to download artifact..."
            
            # Create temp directory for download
            TEMP_DIR=$(mktemp -d)
            trap "rm -rf '$TEMP_DIR'" EXIT
            
            # Download the artifact using gh CLI
            if gh run download --repo "${REPO}" --name "${ARTIFACT_NAME}" --dir "$TEMP_DIR"; then
                # Find the binary in the downloaded artifact
                if [ "$OS" = "windows" ]; then
                    DOWNLOADED_BINARY="${TEMP_DIR}/grove-${OS}-${ARCH}.exe"
                else
                    DOWNLOADED_BINARY="${TEMP_DIR}/grove-${OS}-${ARCH}"
                fi
                
                if [ -f "$DOWNLOADED_BINARY" ]; then
                    # Create install directory
                    mkdir -p "$INSTALL_DIR"
                    
                    # Move binary to install location
                    mv "$DOWNLOADED_BINARY" "${INSTALL_DIR}/${BINARY_NAME}"
                    
                    # Make executable (not needed on Windows)
                    if [ "$OS" != "windows" ]; then
                        chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
                    fi
                    
                    echo ""
                    echo "✅ Grove (PR #${PR_NUM}) installed successfully to ${INSTALL_DIR}/${BINARY_NAME}"
                    echo ""
                    
                    # Detect current shell and show PATH instructions
                    CURRENT_SHELL=$(detect_shell)
                    SHELL_CONFIG=$(get_shell_config "$CURRENT_SHELL")
                    PATH_EXPORT=$(get_path_export_cmd "$CURRENT_SHELL" "$INSTALL_DIR")
                    SOURCE_CMD=$(get_source_cmd "$CURRENT_SHELL" "$SHELL_CONFIG")

                    # Check if install dir is in PATH
                    case ":$PATH:" in
                        *":${INSTALL_DIR}:"*)
                            echo "Grove is ready to use! Run 'grove --help' to get started."
                            ;;
                        *)
                            echo "To use grove, add it to your PATH by running:"
                            echo ""
                            echo "  echo '${PATH_EXPORT}' >> ${SHELL_CONFIG}"
                            echo ""
                            echo "Then restart your shell or run:"
                            echo ""
                            echo "  ${SOURCE_CMD}"
                            echo ""
                            echo "After that, run 'grove --help' to get started."
                            ;;
                    esac
                    exit 0
                else
                    echo "Warning: Could not find binary for ${OS}-${ARCH} in artifact"
                    echo "Available files:"
                    ls -la "$TEMP_DIR"
                fi
            else
                echo "Warning: Failed to download artifact with gh CLI, falling back to manual instructions..."
                echo ""
            fi
        fi
    fi

    # Fallback: Show manual download instructions
    echo "⚠️  Installing from PR artifacts requires the GitHub CLI (gh)."
    echo ""
    echo "To install grove from PR #${PR_NUM}:"
    echo ""
    echo "1. Install gh: https://cli.github.com/"
    echo "2. Authenticate: gh auth login"
    echo "3. Re-run this installer:"
    echo "   curl -fsSL https://safia.rocks/grove/install.sh | sh -s -- --pr ${PR_NUM}"
    exit 1
}

# Main installation
main() {
    echo "🌳 Installing Grove CLI..."
    echo ""

    OS=$(detect_os)
    ARCH=$(detect_arch)

    if [ "$OS" = "unknown" ]; then
        echo "Error: Unsupported operating system: $(uname -s)"
        exit 1
    fi

    if [ "$ARCH" = "unknown" ]; then
        echo "Error: Unsupported architecture: $(uname -m)"
        exit 1
    fi

    echo "Detected: ${OS}-${ARCH}"

    # Construct binary name
    if [ "$OS" = "windows" ]; then
        BINARY_FILE="grove-${OS}-${ARCH}.exe"
    else
        BINARY_FILE="grove-${OS}-${ARCH}"
    fi

    # Handle PR installation
    if [ -n "$PR_NUMBER" ]; then
        install_from_pr "$PR_NUMBER" "$OS" "$ARCH"
        exit 0
    fi

    # Determine version to install
    if [ -n "$REQUESTED_VERSION" ]; then
        # Ensure version starts with 'v'
        case "$REQUESTED_VERSION" in
            v*) VERSION="$REQUESTED_VERSION" ;;
            *)  VERSION="v${REQUESTED_VERSION}" ;;
        esac
        echo "Requested version: ${VERSION}"
    else
        echo "Fetching latest release..."
        VERSION=$(get_latest_version)
        
        if [ -z "$VERSION" ]; then
            echo "Error: Could not determine latest version"
            exit 1
        fi
        echo "Latest version: ${VERSION}"
    fi

    # Download URL
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY_FILE}"

    # Create install directory
    mkdir -p "$INSTALL_DIR"

    # Download binary
    echo "Downloading ${BINARY_FILE}..."
    if ! curl -fsSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BINARY_NAME}"; then
        echo "Error: Failed to download ${BINARY_FILE}"
        echo "URL: ${DOWNLOAD_URL}"
        exit 1
    fi

    # Make executable (not needed on Windows)
    if [ "$OS" != "windows" ]; then
        chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
    fi

    echo ""
    echo "✅ Grove ${VERSION} installed successfully to ${INSTALL_DIR}/${BINARY_NAME}"
    echo ""

    # Detect current shell
    CURRENT_SHELL=$(detect_shell)
    SHELL_CONFIG=$(get_shell_config "$CURRENT_SHELL")
    PATH_EXPORT=$(get_path_export_cmd "$CURRENT_SHELL" "$INSTALL_DIR")
    SOURCE_CMD=$(get_source_cmd "$CURRENT_SHELL" "$SHELL_CONFIG")

    # Check if install dir is in PATH
    case ":$PATH:" in
        *":${INSTALL_DIR}:"*)
            echo "Grove is ready to use! Run 'grove --help' to get started."
            ;;
        *)
            echo "To use grove, add it to your PATH by running:"
            echo ""
            echo "  echo '${PATH_EXPORT}' >> ${SHELL_CONFIG}"
            echo ""
            echo "Then restart your shell or run:"
            echo ""
            echo "  ${SOURCE_CMD}"
            echo ""
            echo "After that, run 'grove --help' to get started."
            ;;
    esac
}

main "$@"
