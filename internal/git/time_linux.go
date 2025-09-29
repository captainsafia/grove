//go:build linux

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

	// Linux doesn't have reliable birth time, so we use modification time
	return info.ModTime(), nil
}