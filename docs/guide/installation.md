# Installation

harnessctl is available via npm, Homebrew, install scripts, or from source.

## npm

```bash
npm install -g harnessctl
```

The npm package ships TypeScript source and a thin runner shim. It tries Bun first (native TS), then falls back to Node.js >= 22 (with `--experimental-strip-types`).

**Requirements:** Bun (any version) or Node.js >= 22.

## Homebrew

```bash
brew install mnvsk97/tap/harnessctl
```

Installs a compiled binary. Updated automatically on each release via the [mnvsk97/homebrew-tap](https://github.com/mnvsk97/homebrew-tap) tap.

## Shell script (Linux / macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.sh | bash
```

This downloads the latest prebuilt binary from GitHub Releases and installs it to `/usr/local/bin`.

To install elsewhere:

```bash
HARNESSCTL_INSTALL_DIR=~/.local/bin curl -fsSL https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.sh | bash
```

**Supported platforms:** Linux (x64, arm64), macOS (x64, arm64).

## PowerShell (Windows)

```powershell
irm https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.ps1 | iex
```

Downloads the latest binary to `~\.harnessctl\bin` and adds it to your user PATH.

To install elsewhere:

```powershell
$env:HARNESSCTL_INSTALL_DIR = "C:\tools"
irm https://raw.githubusercontent.com/mnvsk97/harnessctl/main/install/install.ps1 | iex
```

**Supported platforms:** Windows (x64, arm64).

## From source

```bash
git clone https://github.com/mnvsk97/harnessctl.git
cd harnessctl
bun install
bun run src/cli.ts --help
```

Build a standalone binary:

```bash
bun build --compile src/cli.ts --outfile harnessctl
sudo mv harnessctl /usr/local/bin/
```

**Requirements:** [Bun](https://bun.sh).

## Verify installation

```bash
harnessctl --help
harnessctl doctor
```

`doctor` checks which coding agent CLIs are installed and reachable.

## Uninstall

| Method | Uninstall command |
|---|---|
| npm | `npm uninstall -g harnessctl` |
| Homebrew | `brew uninstall harnessctl` |
| Shell/PowerShell script | Delete the binary (`rm /usr/local/bin/harnessctl`) |
| From source | Delete the cloned directory |

To remove state: `rm -rf ~/.harnessctl`
