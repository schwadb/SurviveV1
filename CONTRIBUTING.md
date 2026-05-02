# Contributing to SurviveV1

Thanks for your interest in contributing! This project aims to be a reliable offline survival knowledge base, so quality and correctness matter more than speed.

## Getting Started

1. Fork and clone the repo
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes
4. Run the checks: `bash tests/test_smoke.sh`
5. Commit and push, then open a pull request

## Development Setup

```bash
# Install Python dependencies
pip install -r requirements.txt

# Run the dashboard locally
cd web && python server.py

# Lint shell scripts
shellcheck scripts/*.sh setup/*.sh download/*.sh

# Lint Python
pylint web/server.py
```

## Guidelines

- **Offline-first**: Never add runtime internet dependencies. All features must work without connectivity.
- **Pi 5 target**: Keep RAM usage under control. Test assumes 4GB RAM minimum.
- **Shell scripts**: Use `set -euo pipefail`, pass ShellCheck, source `lib/common.sh` for shared functions.
- **Python**: Follow PEP 8. Keep `requirements.txt` minimal -- only add dependencies that are actually imported.
- **Security**: No hardcoded credentials, no pipe-to-bash from remote URLs, validate all user input at boundaries.

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:
- Hardware (Pi model, RAM, storage type)
- Steps to reproduce
- Expected vs actual behavior

## Content Contributions

If you know of free, legally distributable survival resources (public domain PDFs, Creative Commons guides), open an issue with the URL and license info.
