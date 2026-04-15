#!/usr/bin/env bash
set -euo pipefail

# harnessctl installer for macOS and Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.sh | bash

REPO="mnvsk97/harnessctl"
INSTALL_DIR="${HARNESSCTL_INSTALL_DIR:-/usr/local/bin}"

info() { printf '\033[0;34m[harnessctl]\033[0m %s\n' "$1"; }
error() { printf '\033[0;31m[harnessctl]\033[0m %s\n' "$1" >&2; exit 1; }

# Detect OS and arch
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) OS="darwin" ;;
  linux)  OS="linux" ;;
  *)      error "Unsupported OS: $OS" ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             error "Unsupported architecture: $ARCH" ;;
esac

BINARY="harnessctl-${OS}-${ARCH}"

# Get latest release tag
info "Fetching latest release..."
LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')

if [ -z "$LATEST" ]; then
  error "Could not determine latest version. Check https://github.com/${REPO}/releases"
fi

info "Installing harnessctl v${LATEST} (${OS}/${ARCH})..."

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${LATEST}/${BINARY}"

# Download and install
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMPFILE"; then
  error "Download failed. Binary may not exist for your platform: ${BINARY}"
fi

chmod +x "$TMPFILE"

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPFILE" "${INSTALL_DIR}/harnessctl"
else
  info "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "$TMPFILE" "${INSTALL_DIR}/harnessctl"
fi

info "Installed harnessctl to ${INSTALL_DIR}/harnessctl"
harnessctl --help
