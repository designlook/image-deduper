# Image Deduper 1.1.0

## Node.js CLI

- Added a dependency-free command-line version using the desktop app's scanner.
- Scans the current directory by default or accepts an explicit folder path.
- Includes recursive controls, creation-time and minimum-size filters, and
  oldest/newest keep modes.
- Uses safe preview-only behavior unless `--delete` is explicitly supplied.
- Supports interactive confirmation, unattended `--yes` deletion, JSON output,
  Ctrl+C stopping with partial results, and complete `-h` / `--help` output.
- Publishes an installable `ImageDeduper-Node-CLI.tgz` with GitHub releases.

The desktop interface and matching rules are unchanged in this release.
