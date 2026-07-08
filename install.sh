#!/bin/sh
set -eu

repo="${OPENDOCKER_REPO:-LightQv/opendocker}"
version="${OPENDOCKER_VERSION:-}"
install_dir="${OPENDOCKER_INSTALL_DIR:-$HOME/.local/bin}"
tmp="${TMPDIR:-/tmp}/opendocker-install.$$"

say() {
  printf '%s\n' "$*"
}

fail() {
  say "opendocker install failed: $*" >&2
  exit 1
}

cleanup() {
  rm -rf "$tmp"
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

download() {
  url="$1"
  output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$output"
    return
  fi

  fail "curl or wget is required"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
    return
  fi

  return 1
}

verify_checksum() {
  archive="$1"
  checksum_file="$2"

  if [ ! -f "$checksum_file" ]; then
    say "checksum skipped: checksums.txt unavailable"
    return
  fi

  if ! actual="$(sha256_file "$archive")"; then
    say "checksum skipped: no sha256 tool found"
    return
  fi

  expected="$(grep "  $(basename "$archive")$" "$checksum_file" | cut -d ' ' -f 1 || true)"
  if [ -z "$expected" ]; then
    say "checksum skipped: asset missing from checksums.txt"
    return
  fi

  [ "$actual" = "$expected" ] || fail "checksum mismatch for $(basename "$archive")"
}

asset_platform() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *) fail "unsupported OS: $(uname -s)" ;;
  esac
}

asset_arch() {
  case "$(uname -m)" in
    arm64|aarch64) printf 'arm64' ;;
    x86_64|amd64) printf 'x64-baseline' ;;
    *) fail "unsupported CPU: $(uname -m)" ;;
  esac
}

asset_libc() {
  if [ "$(asset_platform)" != "linux" ]; then
    return 0
  fi

  if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
    printf '%s' '-musl'
  fi

  return 0
}

release_base_url() {
  if [ -n "$version" ]; then
    clean_version="${version#v}"
    printf 'https://github.com/%s/releases/download/v%s' "$repo" "$clean_version"
    return
  fi

  printf 'https://github.com/%s/releases/latest/download' "$repo"
}

install_binary() {
  source="$1"
  target="$install_dir/opendocker"

  if mkdir -p "$install_dir" 2>/dev/null && cp "$source" "$target" 2>/dev/null && chmod 755 "$target" 2>/dev/null; then
    say "installed opendocker to $target"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo mkdir -p "$install_dir"
    sudo cp "$source" "$target"
    sudo chmod 755 "$target"
    say "installed opendocker to $target"
    return
  fi

  fail "cannot write to $install_dir"
}

path_contains_install_dir() {
  case ":$PATH:" in
    *":$install_dir:"*) return 0 ;;
    *) return 1 ;;
  esac
}

docker_daemon_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

known_docker_socket_exists() {
  for socket in \
    /var/run/docker.sock \
    "$HOME/.docker/run/docker.sock" \
    "$HOME/.colima/default/docker.sock" \
    "$HOME/.orbstack/run/docker.sock"
  do
    if [ -S "$socket" ] || [ -e "$socket" ]; then
      return 0
    fi
  done

  return 1
}

prompt_yes_no() {
  prompt="$1"

  if [ ! -r /dev/tty ]; then
    return 1
  fi

  printf '%s [y/N] ' "$prompt" >/dev/tty
  read answer </dev/tty || return 1

  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

should_install_colima() {
  case "${OPENDOCKER_INSTALL_COLIMA:-}" in
    1|true|TRUE|yes|YES) return 0 ;;
    0|false|FALSE|no|NO) return 1 ;;
  esac

  prompt_yes_no "Docker daemon not found. Install and start Colima with Homebrew?"
}

setup_colima_on_macos() {
  [ "$(uname -s)" = "Darwin" ] || return

  if docker_daemon_ready; then
    say "docker daemon found"
    return
  fi

  if known_docker_socket_exists; then
    say "docker socket found, but docker info failed. Start your Docker runtime if opendocker cannot connect."
    return
  fi

  if ! should_install_colima; then
    say "docker daemon not found. Install/start Docker Desktop, OrbStack, or Colima before running opendocker."
    return
  fi

  command -v brew >/dev/null 2>&1 || fail "Homebrew is required to install Colima automatically"

  brew list colima >/dev/null 2>&1 || brew install colima
  brew list docker >/dev/null 2>&1 || brew install docker
  brew list docker-compose >/dev/null 2>&1 || brew install docker-compose

  colima status >/dev/null 2>&1 || colima start

  if docker context inspect colima >/dev/null 2>&1; then
    docker context use colima >/dev/null 2>&1 || true
  fi

  if docker_daemon_ready; then
    say "colima docker daemon ready"
  else
    say "colima started, but docker info still failed. Check Docker context with: docker context ls"
  fi
}

trap cleanup EXIT INT TERM
mkdir -p "$tmp/extract"

platform="$(asset_platform)"
arch="$(asset_arch)"
libc="$(asset_libc)"

case "$platform" in
  darwin) extension="zip" ;;
  linux) extension="tar.gz" ;;
  *) fail "unsupported platform: $platform" ;;
esac

asset="opendocker-$platform-$arch$libc.$extension"
base_url="$(release_base_url)"
archive="$tmp/$asset"
checksums="$tmp/checksums.txt"

say "downloading $asset"
download "$base_url/$asset" "$archive"
download "$base_url/checksums.txt" "$checksums" || true
verify_checksum "$archive" "$checksums"

case "$extension" in
  zip)
    need unzip
    unzip -q "$archive" -d "$tmp/extract"
    ;;
  tar.gz)
    tar -xzf "$archive" -C "$tmp/extract"
    ;;
esac

[ -f "$tmp/extract/opendocker" ] || fail "archive did not contain opendocker binary"
install_binary "$tmp/extract/opendocker"

if ! path_contains_install_dir; then
  say "add $install_dir to PATH to run opendocker directly"
fi

setup_colima_on_macos

say "run: opendocker"
