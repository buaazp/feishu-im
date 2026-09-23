# Contributor instructions

This is an independent dsh plugin. Read `docs/architecture.md` and `docs/compatibility.md` before changing runtime integration.

- Agent applications launch only through dsh profiles. The `feishu-im` executable configures and diagnoses profiles; it never starts an Agent.
- Keep Harness runtime dependencies external and on the tested published version. Do not add workspace links, imports from a sibling checkout, or unofficial replacement APIs.
- Never copy lark-cli secrets. Use its public commands with argv arrays; bot transport does not require user OAuth.
- Preserve message admission deduplication and await owned work during shutdown. Test cancellation, failure, and restart behavior when changing lifecycle code.
- Keep sender authorization explicit and private-chat-only. Do not automatically allow everyone or retry task side effects after a reply failure.
- Update Chinese and English user documentation with behavior changes. Keep package metadata, CLI help, and configuration reference consistent.
- Use `npm run check`, `npm run build`, and `npm run test:integration` for relevant changes. Tests must own temporary directories, ports, and subprocess cleanup. Use fake external endpoints for automated tests; never send real messages in CI.
- Keep credentials, local profile files, build output, and dependencies out of Git. Create reviewable commits. Publishing npm packages or creating/pushing a remote requires an explicit request.
