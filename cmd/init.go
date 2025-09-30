package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/spf13/cobra"
)

var initCmd = &cobra.Command{
	Use:   "init <git-url>",
	Short: "Initialize a new worktree setup",
	Long: `Initialize a new worktree setup by creating a bare clone of a repository.
This command creates a directory structure optimized for git worktree workflows.`,
	Args: cobra.ExactArgs(1),
	RunE: runInit,
}

func runInit(cmd *cobra.Command, args []string) error {
	gitURL := args[0]

	// Extract repository name from URL
	repoName, err := extractRepoName(gitURL)
	if err != nil {
		return fmt.Errorf("failed to extract repository name: %w", err)
	}

	// Create directory with repo name
	if err := os.MkdirAll(repoName, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", repoName, err)
	}

	// Define bare repo directory
	bareRepoDir := filepath.Join(repoName, fmt.Sprintf("%s.git", repoName))

	// Check if directory already exists
	if _, err := os.Stat(bareRepoDir); err == nil {
		return fmt.Errorf("directory %s already exists", bareRepoDir)
	}

	// Clone as bare repository using go-git
	fmt.Printf("Cloning %s into %s...\n", gitURL, bareRepoDir)
	repo, err := git.PlainClone(bareRepoDir, true, &git.CloneOptions{
		URL:      gitURL,
		Progress: os.Stdout,
	})
	if err != nil {
		// Clean up on failure
		os.RemoveAll(repoName)
		return fmt.Errorf("failed to clone repository: %w", err)
	}

	// Configure remote fetch
	fmt.Println("Configuring remote fetch...")
	cfg, err := repo.Config()
	if err != nil {
		return fmt.Errorf("failed to get repository config: %w", err)
	}

	// Update the origin remote fetch refspec
	if remote, ok := cfg.Remotes["origin"]; ok {
		remote.Fetch = []config.RefSpec{"+refs/heads/*:refs/remotes/origin/*"}
		cfg.Remotes["origin"] = remote
	} else {
		return fmt.Errorf("origin remote not found")
	}

	// Save the configuration
	if err := repo.SetConfig(cfg); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	fmt.Printf("\n✓ Successfully initialized worktree setup in %s\n", repoName)
	fmt.Printf("  Bare repository: %s\n", bareRepoDir)

	return nil
}

// extractRepoName extracts the repository name from a git URL
// Supports formats like:
//   - https://github.com/user/repo.git
//   - git@github.com:user/repo.git
//   - https://github.com/user/repo
func extractRepoName(gitURL string) (string, error) {
	// Remove .git suffix if present
	cleanURL := strings.TrimSuffix(gitURL, ".git")

	// Handle SSH URLs (git@...)
	if strings.HasPrefix(cleanURL, "git@") {
		parts := strings.Split(cleanURL, ":")
		if len(parts) < 2 {
			return "", fmt.Errorf("invalid SSH URL format: %s", gitURL)
		}
		path := parts[len(parts)-1]
		repoName := filepath.Base(path)
		if repoName == "" || repoName == "." {
			return "", fmt.Errorf("could not extract repository name from: %s", gitURL)
		}
		return repoName, nil
	}

	// Handle HTTPS URLs
	if strings.HasPrefix(cleanURL, "http://") || strings.HasPrefix(cleanURL, "https://") {
		repoName := filepath.Base(cleanURL)
		if repoName == "" || repoName == "." {
			return "", fmt.Errorf("could not extract repository name from: %s", gitURL)
		}
		return repoName, nil
	}

	// Handle local paths or simple names
	repoName := filepath.Base(cleanURL)
	if repoName == "" || repoName == "." {
		return "", fmt.Errorf("could not extract repository name from: %s", gitURL)
	}

	return repoName, nil
}
