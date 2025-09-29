package git

import (
	"fmt"
	"grove/internal/models"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
)

type WorktreeManager struct {
	repo *git.Repository
}

func NewWorktreeManager() (*WorktreeManager, error) {
	wd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("failed to get working directory: %w", err)
	}

	repo, err := git.PlainOpenWithOptions(wd, &git.PlainOpenOptions{
		DetectDotGit: true,
	})
	if err != nil {
		return nil, fmt.Errorf("not in a git repository: %w", err)
	}

	return &WorktreeManager{repo: repo}, nil
}

func (wm *WorktreeManager) Close() {
}

func (wm *WorktreeManager) ListWorktrees() ([]models.Worktree, error) {
	var worktrees []models.Worktree

	mainWorktree, err := wm.getMainWorktree()
	if err != nil {
		return nil, fmt.Errorf("failed to get main worktree: %w", err)
	}
	worktrees = append(worktrees, mainWorktree)

	linkedWorktrees, err := wm.getLinkedWorktrees()
	if err != nil {
		return nil, fmt.Errorf("failed to get linked worktrees: %w", err)
	}
	worktrees = append(worktrees, linkedWorktrees...)

	return worktrees, nil
}

func (wm *WorktreeManager) getMainWorktree() (models.Worktree, error) {
	worktree, err := wm.repo.Worktree()
	if err != nil {
		return models.Worktree{}, fmt.Errorf("failed to get worktree: %w", err)
	}

	workdir := worktree.Filesystem.Root()

	head, err := wm.repo.Head()
	if err != nil {
		return models.Worktree{}, fmt.Errorf("failed to get HEAD: %w", err)
	}

	branch := "detached HEAD"
	if head.Name().IsBranch() {
		branch = head.Name().Short()
	}

	isDirty, err := wm.isWorktreeDirty(workdir)
	if err != nil {
		isDirty = false
	}

	createdAt, err := wm.getWorktreeCreatedTime(workdir)
	if err != nil {
		createdAt = time.Time{}
	}

	return models.Worktree{
		Path:      workdir,
		Branch:    branch,
		Head:      head.Hash().String(),
		CreatedAt: createdAt,
		IsDirty:   isDirty,
		IsMain:    true,
	}, nil
}

func (wm *WorktreeManager) getLinkedWorktrees() ([]models.Worktree, error) {
	var worktrees []models.Worktree

	gitDir := wm.getGitDir()
	worktreesDir := filepath.Join(gitDir, "worktrees")

	if _, err := os.Stat(worktreesDir); os.IsNotExist(err) {
		return worktrees, nil
	}

	entries, err := os.ReadDir(worktreesDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read worktrees directory: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		worktree, err := wm.parseWorktreeDir(filepath.Join(worktreesDir, entry.Name()))
		if err != nil {
			continue
		}

		worktrees = append(worktrees, worktree)
	}

	return worktrees, nil
}

func (wm *WorktreeManager) getGitDir() string {
	worktree, err := wm.repo.Worktree()
	if err != nil {
		return ""
	}

	gitDir := filepath.Join(worktree.Filesystem.Root(), ".git")
	if info, err := os.Stat(gitDir); err == nil && info.IsDir() {
		return gitDir
	}

	gitDirBytes, err := os.ReadFile(gitDir)
	if err != nil {
		return ""
	}

	gitDirPath := strings.TrimSpace(string(gitDirBytes))
	if strings.HasPrefix(gitDirPath, "gitdir: ") {
		gitDirPath = strings.TrimPrefix(gitDirPath, "gitdir: ")
		if !filepath.IsAbs(gitDirPath) {
			gitDirPath = filepath.Join(filepath.Dir(gitDir), gitDirPath)
		}
		return gitDirPath
	}

	return gitDir
}

func (wm *WorktreeManager) parseWorktreeDir(worktreeDir string) (models.Worktree, error) {
	gitdirFile := filepath.Join(worktreeDir, "gitdir")
	gitdirBytes, err := os.ReadFile(gitdirFile)
	if err != nil {
		return models.Worktree{}, fmt.Errorf("failed to read gitdir file: %w", err)
	}

	worktreePath := strings.TrimSpace(string(gitdirBytes))
	worktreePath = filepath.Dir(worktreePath)

	headFile := filepath.Join(worktreeDir, "HEAD")
	headBytes, err := os.ReadFile(headFile)
	if err != nil {
		return models.Worktree{}, fmt.Errorf("failed to read HEAD file: %w", err)
	}

	headRef := strings.TrimSpace(string(headBytes))
	branch := "detached HEAD"
	head := headRef

	if strings.HasPrefix(headRef, "ref: refs/heads/") {
		branch = strings.TrimPrefix(headRef, "ref: refs/heads/")

		if ref, err := wm.repo.Reference(plumbing.NewBranchReferenceName(branch), true); err == nil {
			head = ref.Hash().String()
		}
	}

	isDirty, err := wm.isWorktreeDirty(worktreePath)
	if err != nil {
		isDirty = false
	}

	isPrunable := !wm.worktreeExists(worktreePath)
	isLocked := wm.isWorktreeLocked(worktreeDir)

	createdAt, err := wm.getWorktreeCreatedTime(worktreePath)
	if err != nil {
		createdAt = time.Time{}
	}

	return models.Worktree{
		Path:       worktreePath,
		Branch:     branch,
		Head:       head,
		CreatedAt:  createdAt,
		IsDirty:    isDirty,
		IsLocked:   isLocked,
		IsPrunable: isPrunable,
	}, nil
}

func (wm *WorktreeManager) isWorktreeDirty(path string) (bool, error) {
	if !wm.worktreeExists(path) {
		return false, nil
	}

	repo, err := git.PlainOpen(path)
	if err != nil {
		return false, err
	}

	worktree, err := repo.Worktree()
	if err != nil {
		return false, err
	}

	status, err := worktree.Status()
	if err != nil {
		return false, err
	}

	return !status.IsClean(), nil
}

func (wm *WorktreeManager) worktreeExists(path string) bool {
	_, err := os.Stat(path)
	return !os.IsNotExist(err)
}

func (wm *WorktreeManager) isWorktreeLocked(worktreeDir string) bool {
	lockedFile := filepath.Join(worktreeDir, "locked")
	_, err := os.Stat(lockedFile)
	return !os.IsNotExist(err)
}

func (wm *WorktreeManager) getWorktreeCreatedTime(path string) (time.Time, error) {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, err
	}

	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		return time.Unix(stat.Birthtimespec.Sec, stat.Birthtimespec.Nsec), nil
	}

	return info.ModTime(), nil
}

func (wm *WorktreeManager) IsBranchMerged(branch, baseBranch string) (bool, error) {
	baseRef, err := wm.repo.Reference(plumbing.NewBranchReferenceName(baseBranch), true)
	if err != nil {
		return false, fmt.Errorf("failed to lookup base branch %s: %w", baseBranch, err)
	}

	branchRef, err := wm.repo.Reference(plumbing.NewBranchReferenceName(branch), true)
	if err != nil {
		return false, fmt.Errorf("failed to lookup branch %s: %w", branch, err)
	}

	baseCommit, err := wm.repo.CommitObject(baseRef.Hash())
	if err != nil {
		return false, fmt.Errorf("failed to lookup base commit: %w", err)
	}

	branchCommit, err := wm.repo.CommitObject(branchRef.Hash())
	if err != nil {
		return false, fmt.Errorf("failed to lookup branch commit: %w", err)
	}

	isAncestor, err := branchCommit.IsAncestor(baseCommit)
	if err != nil {
		return false, fmt.Errorf("failed to check ancestry: %w", err)
	}

	return isAncestor, nil
}

func (wm *WorktreeManager) PruneWorktrees(opts models.PruneOptions) error {
	worktrees, err := wm.ListWorktrees()
	if err != nil {
		return fmt.Errorf("failed to list worktrees: %w", err)
	}

	for _, worktree := range worktrees {
		if worktree.IsMain || worktree.IsLocked {
			continue
		}

		if worktree.Branch == "detached HEAD" {
			continue
		}

		if strings.Contains(opts.BaseBranch, worktree.Branch) {
			continue
		}

		isMerged, err := wm.IsBranchMerged(worktree.Branch, opts.BaseBranch)
		if err != nil {
			continue
		}

		if !isMerged {
			continue
		}

		if !opts.Force && worktree.IsDirty {
			fmt.Printf("Skipping dirty worktree: %s\n", worktree.Path)
			continue
		}

		if opts.DryRun {
			fmt.Printf("Would remove worktree: %s (branch: %s)\n", worktree.Path, worktree.Branch)
			continue
		}

		if err := wm.removeWorktree(worktree.Path); err != nil {
			fmt.Printf("Failed to remove worktree %s: %v\n", worktree.Path, err)
			continue
		}

		fmt.Printf("Removed worktree: %s (branch: %s)\n", worktree.Path, worktree.Branch)
	}

	return nil
}

func (wm *WorktreeManager) removeWorktree(path string) error {
	if wm.worktreeExists(path) {
		if err := os.RemoveAll(path); err != nil {
			return fmt.Errorf("failed to remove worktree directory: %w", err)
		}
	}

	gitDir := wm.getGitDir()
	worktreeName := filepath.Base(path)
	worktreeDir := filepath.Join(gitDir, "worktrees", worktreeName)

	if _, err := os.Stat(worktreeDir); err == nil {
		if err := os.RemoveAll(worktreeDir); err != nil {
			return fmt.Errorf("failed to remove worktree metadata: %w", err)
		}
	}

	return nil
}