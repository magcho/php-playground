#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Sourcing the real script must be safe: main must never run.
set +e
(
  set -o functrace
  trap 'if [[ ${FUNCNAME[0]:-} == main ]]; then
    printf "%s\n" "main was invoked while deploy.sh was sourced" >"$WORK/main-called"
    exit 96
  fi' DEBUG
  source "$ROOT/deploy.sh"
)
source_status=$?
set -e

if [[ -e "$WORK/main-called" ]]; then
  cat "$WORK/main-called" >&2
  exit 1
fi
if (( source_status != 0 )); then
  printf 'sourcing deploy.sh failed with status %d\n' "$source_status" >&2
  exit 1
fi

# Deny and record accesses to representative predictable shared temp paths.
# The shim makes this check safe even against a regression that tries to write them.
cat >"$WORK/deny-paths.c" <<'EOF'
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static int forbidden(const char *path) {
  const char *paths = getenv("FORBIDDEN_PATHS");
  if (!path || !paths) return 0;
  size_t length = strlen(path);
  while (*paths) {
    const char *end = strchr(paths, ':');
    size_t candidate_length = end ? (size_t)(end - paths) : strlen(paths);
    if (length == candidate_length && memcmp(path, paths, length) == 0) return 1;
    if (!end) break;
    paths = end + 1;
  }
  return 0;
}

static void record(const char *path) {
  const char *log_path = getenv("ACCESS_LOG");
  if (!log_path) return;
  int fd = syscall(SYS_openat, AT_FDCWD, log_path, O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (fd >= 0) {
    syscall(SYS_write, fd, path, strlen(path));
    syscall(SYS_write, fd, "\n", 1);
    syscall(SYS_close, fd);
  }
}

static int deny(const char *path) {
  if (!forbidden(path)) return 0;
  record(path);
  errno = EACCES;
  return 1;
}

int open(const char *path, int flags, ...) {
  static int (*real_open)(const char *, int, ...) = NULL;
  mode_t mode = 0;
  if (flags & O_CREAT) {
    va_list args; va_start(args, flags); mode = va_arg(args, mode_t); va_end(args);
  }
  if (deny(path)) return -1;
  if (!real_open) real_open = dlsym(RTLD_NEXT, "open");
  return real_open(path, flags, mode);
}

int open64(const char *path, int flags, ...) {
  static int (*real_open64)(const char *, int, ...) = NULL;
  mode_t mode = 0;
  if (flags & O_CREAT) {
    va_list args; va_start(args, flags); mode = va_arg(args, mode_t); va_end(args);
  }
  if (deny(path)) return -1;
  if (!real_open64) real_open64 = dlsym(RTLD_NEXT, "open64");
  return real_open64(path, flags, mode);
}

int openat(int dirfd, const char *path, int flags, ...) {
  static int (*real_openat)(int, const char *, int, ...) = NULL;
  mode_t mode = 0;
  if (flags & O_CREAT) {
    va_list args; va_start(args, flags); mode = va_arg(args, mode_t); va_end(args);
  }
  if (deny(path)) return -1;
  if (!real_openat) real_openat = dlsym(RTLD_NEXT, "openat");
  return real_openat(dirfd, path, flags, mode);
}

FILE *fopen(const char *path, const char *mode) {
  static FILE *(*real_fopen)(const char *, const char *) = NULL;
  if (deny(path)) return NULL;
  if (!real_fopen) real_fopen = dlsym(RTLD_NEXT, "fopen");
  return real_fopen(path, mode);
}
EOF
cc -shared -fPIC -o "$WORK/deny-paths.so" "$WORK/deny-paths.c" -ldl

FORBIDDEN_PATHS='/tmp/phbox-health.json:/tmp/phbox-health-response.json'
ACCESS_LOG="$WORK/access.log"
export FORBIDDEN_PATHS ACCESS_LOG

# Prove the safety shim blocks both the historical and an alternate filename.
for path in /tmp/phbox-health.json /tmp/phbox-health-response.json; do
  if LD_PRELOAD="$WORK/deny-paths.so" bash -c 'printf x >"$1"' bash "$path" 2>/dev/null; then
    printf 'safety shim failed to block writing %s\n' "$path" >&2
    exit 1
  fi
  if LD_PRELOAD="$WORK/deny-paths.so" bash -c ': <"$1"' bash "$path" 2>/dev/null; then
    printf 'safety shim failed to block reading %s\n' "$path" >&2
    exit 1
  fi
done
if [[ "$(wc -l <"$ACCESS_LOG")" -ne 4 ]]; then
  printf '%s\n' 'safety shim did not observe reads and writes for both shared paths' >&2
  exit 1
fi
: >"$ACCESS_LOG"

output="$(LD_PRELOAD="$WORK/deny-paths.so" bash -c '
  source "$1"
  COMPOSE=(true)
  curl() { printf "%s\\n" "{\"ok\":true}"; }
  sleep() { :; }
  health_check
' bash "$ROOT/deploy.sh")"

if [[ -s "$ACCESS_LOG" ]]; then
  printf '%s\n' 'health_check accessed a predictable shared temporary file:' >&2
  cat "$ACCESS_LOG" >&2
  exit 1
fi
if ! grep -Fxq '{"ok":true}' <<<"$output"; then
  printf '%s\n' 'health_check did not emit the successful in-memory response' >&2
  exit 1
fi
