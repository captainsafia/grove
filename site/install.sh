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
    echo "⚠️  Note: GitHub requires authentication to download workflow artifacts."
    echo ""
    echo "To install from PR #${PR_NUM}, please:"
    echo ""
    echo "1. Go to: https://github.com/${REPO}/actions"
    echo "2. Find the latest 'PR Build' run for PR #${PR_NUM}"
    echo "3. Download the artifact: ${ARTIFACT_NAME}"
    echo "4. Extract and run:"
    echo ""
    if [ "$OS" = "windows" ]; then
        echo "   unzip ${ARTIFACT_NAME}.zip"
        echo "   .\\grove-${OS}-${ARCH}.exe --help"
    else
        echo "   unzip ${ARTIFACT_NAME}.zip"
        echo "   chmod +x grove-${OS}-${ARCH}"
        echo "   ./grove-${OS}-${ARCH} --help"
    fi
    echo ""
    echo "Or move to your install directory:"
    echo "   mv grove-${OS}-${ARCH} ${INSTALL_DIR}/${BINARY_NAME}"
    exit 0
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

    # Check if install dir is in PATH
    case ":$PATH:" in
        *":${INSTALL_DIR}:"*)
            echo "Grove is ready to use! Run 'grove --help' to get started."
            ;;
        *)
            echo "To use grove, add the following to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
            echo ""
            echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
            echo ""
            echo "Then restart your shell or run:"
            echo ""
            echo "  source ~/.bashrc  # or ~/.zshrc"
            echo ""
            echo "After that, run 'grove --help' to get started."
            ;;
    esac
}

main "$@"
