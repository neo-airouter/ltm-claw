# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.1] — 2026-03-24

### Fixed
- **retrieval.md pipe bug** — Step 1→2 pipeline was broken (stdin consumed by `while read`, grep got nothing). Fixed with PID-temp-file approach.
- **tool.ts `deliver: true` channel error** — announce step fails in channel-less dev gateways. Changed to `deliver: false` with manual `waitForRun` + `getSessionMessages` retrieval.

### Changed
- `tool.ts`: `deliver: true` → `deliver: false` (non-blocking, manual result retrieval)

## [1.0.0] — 2026-03-20

### Added
- Initial release
- `ltm_search` tool: grep-based session retrieval via lightweight subagent
- Config: `retrievalTimeoutSeconds`, `workspaceDir`
- Startup banner on plugin load
