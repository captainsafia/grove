//go:build windows

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

	// Windows has creation time in the file info
	if stat, ok := info.Sys().(*syscall.Win32FileAttributeData); ok {
		return time.Unix(0, stat.CreationTime.Nanoseconds()), nil
	}

	return info.ModTime(), nil
}