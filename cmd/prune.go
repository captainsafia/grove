package cmd

import (
	"bufio"
	"fmt"
	"grove/internal/git"
	"grove/internal/models"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

var (
	dryRun     bool
	force      bool
	baseBranch string
	yes        bool
)

var pruneCmd = &cobra.Command{
	Use:   "prune",
	Short: "Remove worktrees for merged branches",
	Long: `Remove worktrees associated with branches that have been merged into the base branch.
By default, this checks against the 'main' branch. Use --base to specify a different base branch.`,
	RunE: runPrune,
}

func init() {
	pruneCmd.Flags().BoolVar(&dryRun, "dry-run", false, "Show what would be removed without actually removing")
	pruneCmd.Flags().BoolVar(&force, "force", false, "Remove worktrees even if they have uncommitted changes")
	pruneCmd.Flags().StringVar(&baseBranch, "base", "main", "Base branch to check for merged branches")
	pruneCmd.Flags().BoolVarP(&yes, "yes", "y", false, "Skip confirmation prompt")
}

func runPrune(cmd *cobra.Command, args []string) error {
	wm, err := git.NewWorktreeManager()
	if err != nil {
		return fmt.Errorf("failed to initialize worktree manager: %w", err)
	}
	defer wm.Close()

	worktrees, err := wm.ListWorktrees()
	if err != nil {
		return fmt.Errorf("failed to list worktrees: %w", err)
	}

	var candidatesForPruning []models.Worktree

	fmt.Printf("Checking for worktrees with branches merged into '%s'...\n\n", baseBranch)

	for _, wt := range worktrees {
		if wt.IsMain || wt.IsLocked {
			continue
		}

		if wt.Branch == "detached HEAD" {
			continue
		}

		if strings.Contains(baseBranch, wt.Branch) {
			continue
		}

		isMerged, err := wm.IsBranchMerged(wt.Branch, baseBranch)
		if err != nil {
			if !dryRun {
				fmt.Printf("Warning: Could not check merge status for branch '%s': %v\n", wt.Branch, err)
			}
			continue
		}

		if isMerged {
			candidatesForPruning = append(candidatesForPruning, wt)
		}
	}

	if len(candidatesForPruning) == 0 {
		fmt.Println("No worktrees found with merged branches.")
		return nil
	}

	fmt.Printf("Found %d worktree(s) with merged branches:\n\n", len(candidatesForPruning))

	for _, wt := range candidatesForPruning {
		status := "clean"
		if wt.IsDirty {
			status = "dirty"
		}
		if wt.IsPrunable {
			status += ", prunable"
		}

		fmt.Printf("  %s\n", wt.Path)
		fmt.Printf("    Branch: %s\n", wt.Branch)
		fmt.Printf("    Status: %s\n", status)
		fmt.Println()
	}

	if dryRun {
		fmt.Println("This was a dry run. Use --dry-run=false to actually remove the worktrees.")
		return nil
	}

	if !force {
		dirtyCount := 0
		for _, wt := range candidatesForPruning {
			if wt.IsDirty {
				dirtyCount++
			}
		}
		if dirtyCount > 0 {
			fmt.Printf("Warning: %d worktree(s) have uncommitted changes.\n", dirtyCount)
			fmt.Println("Use --force to remove them anyway, or commit/stash your changes first.")
		}
	}

	if !yes {
		fmt.Print("Do you want to proceed with removing these worktrees? [y/N]: ")
		reader := bufio.NewReader(os.Stdin)
		response, err := reader.ReadString('\n')
		if err != nil {
			return fmt.Errorf("failed to read input: %w", err)
		}

		response = strings.TrimSpace(strings.ToLower(response))
		if response != "y" && response != "yes" {
			fmt.Println("Operation cancelled.")
			return nil
		}
	}

	opts := models.PruneOptions{
		DryRun:     false,
		Force:      force,
		BaseBranch: baseBranch,
	}

	fmt.Println("\nRemoving worktrees...")
	if err := wm.PruneWorktrees(opts); err != nil {
		return fmt.Errorf("failed to prune worktrees: %w", err)
	}

	fmt.Println("\nPrune operation completed.")
	return nil
}