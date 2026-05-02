# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in SurviveV1, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer at the address listed in the repository profile, or use GitHub's private vulnerability reporting feature
3. Include a description of the vulnerability, steps to reproduce, and potential impact
4. Allow reasonable time for a fix before public disclosure

## Scope

SurviveV1 is designed for **local network use** in offline/grid-down scenarios. It is not intended to be exposed to the public internet. That said, we take security seriously because:

- Physical theft of the Pi could expose stored credentials (rclone configs, Wi-Fi passwords)
- Local network attackers could access all content and services
- Download scripts fetch content from the internet during setup and must handle untrusted input safely

## Security Measures

- Path traversal protection on all file-serving routes
- CSRF protection on form endpoints
- Rate limiting on AI chat and search endpoints
- Backend services bind to 127.0.0.1 (proxied through nginx)
- yt-dlp runs with `--restrict-filenames --no-exec --no-config`
- rclone credentials stored in mode-0600 files
- Content-Security-Policy header via nginx

## Supported Versions

Only the latest release on the `main` branch receives security updates.
