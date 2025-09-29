package cmd

import (
	"fmt"
	"grove/internal/git"
	"grove/internal/models"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
)

var (
	showDetails bool
	showDirty   bool
	showLocked  bool
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List all worktrees",
	Long: `List all worktrees in the current Git repository.
Shows the path, branch, creation date, and status of each worktree.`,
	RunE: runList,
}

func init() {
	listCmd.Flags().BoolVar(&showDetails, "details", false, "Show detailed information")
	listCmd.Flags().BoolVar(&showDirty, "dirty", false, "Show only dirty worktrees")
	listCmd.Flags().BoolVar(&showLocked, "locked", false, "Show only locked worktrees")
}

func runList(cmd *cobra.Command, args []string) error {
	wm, err := git.NewWorktreeManager()
	if err != nil {
		return fmt.Errorf("failed to initialize worktree manager: %w", err)
	}
	defer wm.Close()

	worktrees, err := wm.ListWorktrees()
	if err != nil {
		return fmt.Errorf("failed to list worktrees: %w", err)
	}

	opts := models.WorktreeListOptions{
		ShowDirty:   showDirty,
		ShowLocked:  showLocked,
		ShowDetails: showDetails,
	}

	filteredWorktrees := filterWorktrees(worktrees, opts)

	if len(filteredWorktrees) == 0 {
		fmt.Println("No worktrees found matching the criteria.")
		return nil
	}

	printWorktrees(filteredWorktrees, opts)
	return nil
}

func filterWorktrees(worktrees []models.Worktree, opts models.WorktreeListOptions) []models.Worktree {
	var filtered []models.Worktree

	for _, wt := range worktrees {
		if opts.ShowDirty && !wt.IsDirty {
			continue
		}
		if opts.ShowLocked && !wt.IsLocked {
			continue
		}
		filtered = append(filtered, wt)
	}

	return filtered
}

func printWorktrees(worktrees []models.Worktree, opts models.WorktreeListOptions) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	defer w.Flush()

	if opts.ShowDetails {
		fmt.Fprintln(w, "PATH\tBRANCH\tHEAD\tCREATED\tSTATUS")
		fmt.Fprintln(w, "----\t------\t----\t-------\t------")
	} else {
		fmt.Fprintln(w, "PATH\tBRANCH\tCREATED\tSTATUS")
		fmt.Fprintln(w, "----\t------\t-------\t------")
	}

	for _, wt := range worktrees {
		status := formatStatus(wt)
		createdStr := formatCreatedTime(wt.CreatedAt)
		branch := wt.Branch
		if wt.IsMain {
			branch = fmt.Sprintf("%s (main)", branch)
		}

		if opts.ShowDetails {
			headShort := wt.Head
			if len(headShort) > 8 {
				headShort = headShort[:8]
			}
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", wt.Path, branch, headShort, createdStr, status)
		} else {
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", wt.Path, branch, createdStr, status)
		}
	}
}

func formatStatus(wt models.Worktree) string {
	var statuses []string

	if wt.IsDirty {
		statuses = append(statuses, "dirty")
	}
	if wt.IsLocked {
		statuses = append(statuses, "locked")
	}
	if wt.IsPrunable {
		statuses = append(statuses, "prunable")
	}

	if len(statuses) == 0 {
		return "clean"
	}

	return strings.Join(statuses, ", ")
}

func formatCreatedTime(t time.Time) string {
	if t.IsZero() {
		return "unknown"
	}

	now := time.Now()
	duration := now.Sub(t)

	switch {
	case duration < time.Hour:
		return fmt.Sprintf("%d minutes ago", int(duration.Minutes()))
	case duration < 24*time.Hour:
		return fmt.Sprintf("%d hours ago", int(duration.Hours()))
	case duration < 7*24*time.Hour:
		return fmt.Sprintf("%d days ago", int(duration.Hours()/24))
	case duration < 30*24*time.Hour:
		return fmt.Sprintf("%d weeks ago", int(duration.Hours()/(24*7)))
	default:
		return t.Format("2006-01-02")
	}
}