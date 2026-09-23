# Standalone Feishu IM plugin

## Objective

Deliver an independently installable, MIT-licensed dsh plugin that reuses lark-cli credentials to run tasks from authorized Feishu private chats. Users install a bundle, configure it once, check readiness, and launch through a dedicated dsh profile. The project has no dependency on a Harness source checkout or unpublished workspace packages.

## Decisions

- Repository: `feishu-im`; npm package: `dsh-feishu-im`. The repository is local until a remote and publication destination are selected.
- Support and test the published `@deepseek-ai/dsh@0.1.7-alpha.2` runtime. Pre-stable Harness dependencies are version-pinned; the older npm `latest` is not a supported substitute.
- Package the existing driver as a `dsh.bundle` layer over the base profile. The layer owns the `headless-runner` application-driver row, so the existing dsh startup auditor treats a missing or invalid runner as fatal without an upstream change. It belongs in a dedicated profile.
- `feishu-im setup` and `feishu-im doctor` are management commands only. Agent execution always starts with `dsh --profile <name>`.
- Setup discovers lark-cli profiles and the logged-in human identity through public CLI commands. It stores only the selected profile, explicit sender allowlist, workspace, locale, and resource settings in the profile patch. It never copies credentials or renews user OAuth for bot operations.
- Preserve conversational ordering, durable admission deduplication, cancellation, bounded resources, and plain-text final replies. Preserve the Session identity algorithm. Add English control messages alongside Chinese.
- Keep groups, attachments, interactive approvals, offline replay, and durable reply outboxes outside this release; document the operational limits.

## Layout and commands

`src/` owns the driver, CLI transport, and management commands; `tests/` owns isolated fixtures and shipped-package integration tests; `docs/` owns user and maintainer guides; `.github/` owns CI and contribution templates.

```sh
npm ci
npm run check
npm run build
npm run test:integration
npm pack
```

Use strict TypeScript, ESM imports, scoped resource cleanup, literal argv arrays, and validated JSON/configuration. Example: `await cli.reply(message.messageId, 'result', answer, signal)`.

## Acceptance

1. A clean checkout installs and builds using published dependencies only.
2. A packed tarball installs through `dsh plugin add` into an isolated profile and runs without the original repository.
3. Setup preserves unrelated profile settings and requires explicit authorization for each sender; doctor produces actionable diagnostics without exposing credentials.
4. Automated tests cover admission, history continuation, duplicates, cancellation, deadlines, setup/update failures, and lifecycle cleanup. A real dsh profile invokes the file tool and returns its result through a fake external CLI; live verification reuses the authorized Feishu app when available.
5. Chinese and English entry documentation includes installation, configuration, first task, operations, troubleshooting, compatibility, and limitations. CI validates code, package contents, and the supported runtime. License, contribution, security-reporting, and release guidance accompany the project.
6. The independent Git repository contains reviewable commits and no credentials or generated dependency trees. Publishing to npm or GitHub remains a separate action.

## Implementation order

First extract and validate the driver against published packages. Next add setup, doctor, and localized control messages. Then exercise tarball installation, write user and maintainer documentation, configure CI, and perform the final package and live checks.
