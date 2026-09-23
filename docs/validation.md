# Validation

## Automated evidence

Verified on 2026-09-23 with dsh `0.1.7-alpha.2`, Node `22.19.0`, `24.21.0`, and `26.7.0`, and pnpm `12.5.1` on macOS. The current suite has 63 unit tests and one packed-installation integration case.

The standalone project is tested against published npm dependencies, without imports or links to a Harness source checkout.

| Check | Scope |
| --- | --- |
| `npm run check` | Strict TypeScript, lint, and per-file 100% unit coverage for source statements, branches, functions, and lines |
| `npm run test:integration` | Real tarball → `dsh plugin add` → installed setup/doctor → real Agent file tool → restart/history/deduplication → reset and startup failure |
| `npm run package:check` | Published package metadata and ESM declarations, required artifact files, excluded development data, configuration documentation, and local documentation links |
| Node 22.19.0 unit and integration runs | Minimum supported Node baseline, including subprocess startup and persisted Sessions |
| `npm audit --omit=dev` | Production plugin dependency audit at verification time; not an audit of every package in an external dsh installation |

The 63-test unit suite passed on Node 24.21.0 and Node 26.7.0. The final packed-installation integration passed on Node 22.19.0 and 24.21.0. Local verification uses macOS. CI declares Linux Node 22.19/24 and macOS Node 24; a workflow file alone does not establish a successful hosted run. The full development dependency graph includes the dsh CLI and its transitive packages; review its separate advisories before a release.

The automated IM endpoint and model are deterministic fixtures. They verify plugin composition, literal CLI argv, real task admission, tool execution, persistent history and replies. They do not establish that a particular Feishu tenant has granted scopes or configured events correctly.

## Manual live-check procedure

1. Obtain authorization to use a specific app and human private chat. Confirm competing listeners have stopped.
2. Build and pack the project, install the tarball into a dedicated profile, and run setup with the existing lark-cli profile and one explicit human open_id. Use an empty temporary workspace.
3. Run doctor, configure a working model provider, launch dsh from the workspace, and wait for the event-ready marker.
4. Ask the human to send: `Create standalone-feishu-check.txt with content STANDALONE_FEISHU_OK, then report the filename.`
5. Verify the incoming human message, acknowledgement, tool outcome, file bytes, final bot reply, and persisted Session. Do not substitute a synthetic event for the real inbound message.
6. Restart and ask a new follow-up to check history. A previously admitted message is not an automatic retry instruction. Keep failure evidence distinct from successful verification.
7. Close the owned dsh process normally. Stop only an idle event bus you own. Retain the task file and redacted verification notes; do not commit raw private chat dumps or credentials.

中文：自动集成测试使用真实安装包、dsh profile、文件工具和持久化 Session，仅替换模型与飞书端点。真实验证需要明确授权的应用、私聊用户和新的人工消息，核对文件字节与最终回复；不能用合成入站事件冒充实测。重启后用新的追问继续历史，不自动重跑已接收消息。结束时正常关闭自己拥有的监听。
