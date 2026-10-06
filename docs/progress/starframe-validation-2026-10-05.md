---
title: StarFrame upgrade validation
description: Server evidence and remaining release acceptance
---

# StarFrame upgrade validation

Date: 2026-10-05. This is a development record, not a production acceptance report.

## Source and scope

- Fork baseline: `a6e16115ab20b8626c5000ff7a0ebb44e10ab828`.
- Official release merged without committing: `v0.8.0`, ancestor `dd5519fa2aeb3d5022db38f53e94fc78bdf20ee5`.
- Worktree branch: `feat/starframe-video-v080`.
- Explicit model classification, StarFrame JSON create/query/authenticated content handling, and existing fork fallback behavior are covered by server tests.
- All 18 supplied full model IDs and a custom alias are preserved in protocol tests. This does not establish supplier availability or model-specific parameter support.

## Collected server evidence

- `bun test src`: 76 passed, 0 failed.
- `pnpm exec tsc --noEmit --incremental false`: exit 0.
- Root `go test ./...`: exit 0, including config, handler, model and service packages.
- Nested Comfy bridge `go test -count=1 -v ./...`: exit 0 after correcting the test fixture to use resolved `workflowOverrides`; production bridge code was not changed.
- `bun run build`: exit 0. This actually compiled Windows/amd64, Linux/amd64 and Linux/arm64 bridge binaries, then the Next.js 16.2.9 production application. It did not use the prebuilt-bridge shortcut.
- `file` identified the three artifacts as PE32+ x86-64, ELF x86-64 and ELF aarch64 respectively.
- Root `go build`: exit 0, backend artifact outside the source worktree.
- Classification and protocol specification/quality reviews passed. The final bridge fixture and strict status projection received separate specification and quality reviews.
- Toolchain: Go 1.27.1, Bun 1.3.9. The main gateway uses its own CI-pinned pnpm 10.34.4 and golangci-lint 2.13.0; its independent gates are not implied by this Canvas record.

## Not accepted yet

- No release commit, push, PR CI, production deployment SHA or rollback/backup evidence is recorded here.
- Main-gateway review fixes and complete gates require their own final evidence.
- No paid supplier generation request or production configuration/database/account mutation was performed.
- User-local production browser acceptance remains pending for guest, user and administrator, including both settings selectors, mixed classifications, same-value automatic reset, delayed discovery, themes, narrow viewports, playback and download.
- Production Redis retention, owner isolation, same-order recovery and actual API/database billing reconciliation remain pending. See [remaining tests](pending-test.md) and the [configuration guide](../backend/starframe-video.md).
