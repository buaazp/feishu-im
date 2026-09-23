# Release procedure

The public source repository is [buaazp/feishu-im](https://github.com/buaazp/feishu-im). Version 0.2.1 currently produces a local installable tarball; npm publication is not automatic.

1. Verify the repository metadata and confirm the npm name is available and controlled by the maintainer. Enable GitHub private vulnerability reporting, then update `SECURITY.md` and README installation links.
2. Review the supported dsh version, Node matrix, Feishu SDK and API changes, dependency advisories, and migration limits. Update dependencies together when changing the Harness version. Avoid a forced dependency upgrade that silently crosses its pre-stable APIs.
3. Update `package.json`, the lockfile, tarball examples, and changelog. Run `npm ci`, `npm run check`, `npm run test:integration`, and `npm run package:check` from a clean checkout. CI owns its declared OS/Node matrix; local results establish only the versions actually run.
4. Perform the [manual live check](validation.md) with an explicitly authorized bot and human. Use a temporary task directory, save only redacted evidence, and close your consumer normally afterward.
5. Run `npm pack --pack-destination artifacts`. Review the file list and SHA-256 digest. The tarball must contain built ESM, the browser client and declarations, its management executable, bundle patch, license, notice, and user guides. Tests, credentials, profiles, dependencies, and local logs must be absent.
6. Commit and tag the reviewed source. Only after explicit publication authorization, publish the reviewed tarball and push the chosen Git remote/tag. Use npm 2FA or the registry's trusted-publishing process. Attach the tarball and checksum to the release; do not add a secret-bearing `.npmrc` to Git.
7. Install the published artifact into a fresh profile and repeat the smoke check. Update installation docs to the real npm version and release URLs. Keep previous release artifacts available; do not imply older dsh can read newer Session formats.

The CI workflow only validates and uploads build artifacts. It has no npm token and never publishes packages.

中文：源码仓库已公开，0.2.1 当前生成本地安装包。首次 npm 发布前需确认包所有权、核对安全报告渠道和元数据并完成验证。CI 不自动发布；推送和 npm 发布需明确授权。版本升级时一起验证 dsh 依赖与 Session 兼容性。
