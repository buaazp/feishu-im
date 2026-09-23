# Release procedure

This repository currently produces a local `dsh-feishu-im` tarball. No npm or GitHub publication is automatic. A maintainer must select the remote repository and npm package ownership before the first public release.

1. Set real `repository`, `homepage`, and `bugs` metadata after the remote exists. Confirm the npm name is available and controlled by the maintainer. Enable GitHub private vulnerability reporting, then update `SECURITY.md` and README installation links.
2. Review the supported dsh version, Node matrix, lark-cli changes, dependency advisories, and migration limits. Update dependencies together when changing the Harness version. Avoid a forced dependency upgrade that silently crosses its pre-stable APIs.
3. Update `package.json`, the lockfile, tarball examples, and changelog. Run `npm ci`, `npm run check`, `npm run test:integration`, and `npm run package:check` from a clean checkout. CI owns its declared OS/Node matrix; local results establish only the versions actually run.
4. Perform the [manual live check](validation.md) with an explicitly authorized bot and human. Use a temporary task directory, save only redacted evidence, and close your consumer normally afterward.
5. Run `npm pack --pack-destination artifacts`. Review the file list and SHA-256 digest. The tarball must contain built ESM and declarations, its management executable, bundle patch, license, notice, and user guides. Tests, credentials, profiles, dependencies, and local logs must be absent.
6. Commit and tag the reviewed source. Only after explicit publication authorization, publish the reviewed tarball and push the chosen Git remote/tag. Use npm 2FA or the registry's trusted-publishing process. Attach the tarball and checksum to the release; do not add a secret-bearing `.npmrc` to Git.
7. Install the published artifact into a fresh profile and repeat the smoke check. Update installation docs to the real npm version and release URLs. Keep previous release artifacts available; do not imply older dsh can read newer Session formats.

The CI workflow only validates and uploads build artifacts. It has no npm token and never publishes packages.

中文：当前只生成本地安装包。首次公开发布前需确定真实远端地址和 npm 所有权、开启私密安全报告、补齐元数据并完成验证。CI 不自动发布；推送和 npm 发布需明确授权。版本升级时一起验证 dsh 依赖与 Session 兼容性。
