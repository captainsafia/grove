//go:build !darwin && !linux && !windows

package git

import (
	"os"
	"time"
)

func getCreatedTime(path string) (time.Time, error) {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, err
	}

	// Fallback to modification time for unsupported platforms
	return info.ModTime(), nil
}