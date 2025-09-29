//go:build darwin

package git

import (
	"os"
	"syscall"
	"time"
)

func getCreatedTime(path string) (time.Time, error) {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, err
	}

	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		return time.Unix(stat.Birthtimespec.Sec, stat.Birthtimespec.Nsec), nil
	}

	return info.ModTime(), nil
}