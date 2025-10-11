package cmd

import (
	"bufio"
	"fmt"
	"grove/internal/git"
	"grove/internal/models"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

var (
	dryRun     bool
	force      bool
	baseBranch string
	yes        bool
	olderThan  string
)

var pruneCmd = &cobra.Command{
	Use:   "prune",
	Short: "Remove worktrees for merged branches",
	Long: `Remove worktrees associated with branches that have been merged into the base branch.
By default, this checks against the 'main' branch. Use --base to specify a different base branch.

You can also prune by worktree age using --older-than (this bypasses the merge check):
  30d  (30 days)
  6M   (6 months)
  1y   (1 year)
  2w   (2 weeks)

When --older-than is specified, all worktrees older than the duration will be pruned,
regardless of whether their branches have been merged.`,
	RunE: runPrune,
}

func init() {
	pruneCmd.Flags().BoolVar(&dryRun, "dry-run", false, "Show what would be removed without actually removing")
	pruneCmd.Flags().BoolVar(&force, "force", false, "Remove worktrees even if they have uncommitted changes")
	pruneCmd.Flags().StringVar(&baseBranch, "base", "main", "Base branch to check for merged branches (ignored when --older-than is used)")
	pruneCmd.Flags().BoolVarP(&yes, "yes", "y", false, "Skip confirmation prompt")
	pruneCmd.Flags().StringVar(&olderThan, "older-than", "", "Prune worktrees older than specified duration, bypassing merge check (e.g., 30d, 6M, 1y, 2w)")
}

// parseDuration parses duration strings like "30d", "6M", "1y", "2w"
func parseDuration(s string) (time.Duration, error) {
	if s == "" {
		return 0, nil
	}

	// Get the numeric part and unit
	var value int
	var unit string
	
	for i, r := range s {
		if r < '0' || r > '9' {
			value, _ = strconv.Atoi(s[:i])
			unit = strings.ToLower(s[i:])
			break
		}
	}

	switch unit {
	case "d", "day", "days":
		return time.Duration(value) * 24 * time.Hour, nil
	case "w", "week", "weeks":
		return time.Duration(value) * 7 * 24 * time.Hour, nil
	case "m", "month", "months":
		return time.Duration(value) * 30 * 24 * time.Hour, nil
	case "y", "year", "years":
		return time.Duration(value) * 365 * 24 * time.Hour, nil
	default:
		return 0, fmt.Errorf("invalid duration unit: %s (use d, w, M, or y)", unit)
	}
}

// formatTimeSince formats a duration in a human-readable way
func formatTimeSince(t time.Time) string {
	duration := time.Since(t)
	
	days := int(duration.Hours() / 24)
	if days == 0 {
		hours := int(duration.Hours())
		if hours == 0 {
			return "less than an hour"
		} else if hours == 1 {
			return "1 hour"
		}
		return fmt.Sprintf("%d hours", hours)
	} else if days == 1 {
		return "1 day"
	} else if days < 7 {
		return fmt.Sprintf("%d days", days)
	} else if days < 30 {
		weeks := days / 7
		if weeks == 1 {
			return "1 week"
		}
		return fmt.Sprintf("%d weeks", weeks)
	} else if days < 365 {
		months := days / 30
		if months == 1 {
			return "1 month"
		}
		return fmt.Sprintf("%d months", months)
	} else {
		years := days / 365
		if years == 1 {
			return "1 year"
		}
		return fmt.Sprintf("%d years", years)
	}
}

func runPrune(cmd *cobra.Command, args []string) error {
	// Validate that --base and --older-than are not used together
	if olderThan != "" && cmd.Flags().Changed("base") {
		return fmt.Errorf("--base and --older-than cannot be used together (--base is ignored when --older-than is specified)")
	}

	// Parse the older-than duration if provided
	var ageThreshold time.Duration
	var cutoffTime time.Time
	if olderThan != "" {
		var err error
		ageThreshold, err = parseDuration(olderThan)
		if err != nil {
			return fmt.Errorf("invalid --older-than value: %w", err)
		}
		cutoffTime = time.Now().Add(-ageThreshold)
	}

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

	if olderThan != "" {
		fmt.Printf("Checking for worktrees older than %s...\n\n", olderThan)
	} else {
		fmt.Printf("Checking for worktrees with branches merged into '%s'...\n\n", baseBranch)
	}

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

		// If --older-than is specified, only filter by age (skip merge check)
		if olderThan != "" {
			if wt.CreatedAt.IsZero() || wt.CreatedAt.After(cutoffTime) {
				continue
			}
			// Add to candidates without checking merge status
			candidatesForPruning = append(candidatesForPruning, wt)
		} else {
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
	}

	if len(candidatesForPruning) == 0 {
		if olderThan != "" {
			fmt.Println("No worktrees found older than the specified duration.")
		} else {
			fmt.Println("No worktrees found with merged branches.")
		}
		return nil
	}

	if olderThan != "" {
		fmt.Printf("Found %d worktree(s) older than %s:\n\n", len(candidatesForPruning), olderThan)
	} else {
		fmt.Printf("Found %d worktree(s) with merged branches:\n\n", len(candidatesForPruning))
	}

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
		if !wt.CreatedAt.IsZero() {
			fmt.Printf("    Created: %s (%s ago)\n", wt.CreatedAt.Format("2006-01-02 15:04:05"), formatTimeSince(wt.CreatedAt))
		}
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