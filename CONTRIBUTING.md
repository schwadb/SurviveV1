# Contributing to SurviveV1

Thanks for your interest in improving the offline survival knowledge base.

## Quick Start

1. Fork and clone the repo
2. Create a feature branch: `git checkout -b feature/your-change`
3. Make changes and test on a Raspberry Pi 5 (or at minimum, verify shell scripts with `shellcheck`)
4. Submit a pull request

## What We Need

- **Content gaps**: Know a free/open-source survival resource we're missing? Open an issue.
- **Script improvements**: Better error handling, faster downloads, Pi optimization.
- **New platforms**: Docker support, x86 compatibility, other SBCs.
- **Documentation**: Setup guides, troubleshooting, translations.

## Guidelines

- All shell scripts must pass `shellcheck`
- Python code should pass `flake8`
- Content must be freely distributable (public domain, CC, or author-authorized)
- No copyrighted material -- reference only (add to the "Recommended Purchase" section)
- Test download scripts with `--dry-run` before submitting

## Content Licensing

Only add content that falls into one of these categories:
- Public domain (US government works, pre-1928 publications)
- Creative Commons licensed
- Explicitly authorized for free distribution by the author
- Open source software

## Code of Conduct

Be respectful and constructive. We're building tools to help people in emergencies.
