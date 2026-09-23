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

## Live verification results

The independently installed tarball completed a real Feishu private-chat task on 2026-09-23. Setup reused an existing authorized lark-cli application; bot verification and event-subscription readiness passed. After a dsh restart, the human sent only “继续刚才的验证任务” (“continue the previous validation task”). The driver resumed the same persisted Session and used its original file-creation instruction.

| Observation | Verified result |
| --- | --- |
| History | The same Session contains both human messages across the restart |
| Task execution | The real dsh `bash` tool created and read the requested file; its persisted result has `isError: false` |
| File | `standalone-feishu-check.txt` |
| Exact contents | `STANDALONE_FEISHU_OK`, 20 UTF-8 bytes, no trailing newline |
| File SHA-256 | `81b48500bbede2474ce62f61214b6a8317284f11427478ff5aa6c607f1a876eb` |
| Final outcome | The second turn is persisted as `completed` |
| Feishu delivery | The bot acknowledged the follow-up and replied with the filename, content, and byte count |
| Cleanup | The owned dsh process exited normally after Ctrl+C; its idle lark-cli event bus stopped without `--force` |

The first turn failed because the initially selected local model proxy was offline. Switching the test profile to the working DeepSeek provider restored model access. The completed turn was triggered by a new human message after restart; the failed admitted message was not automatically replayed. No synthetic inbound event or mocked model was used for this live check. Raw app ids, human ids, and private transcripts are not committed.

中文：独立安装包已通过真实飞书私聊往返验证。重启后仅发送“继续刚才的验证任务”，插件恢复同一个 Session，并根据原始指令通过真实 dsh `bash` 工具创建文件。已核对文件内容为 `STANDALONE_FEISHU_OK`、20 字节且无换行，第二轮持久化状态为 `completed`，机器人最终回复已送达。首次任务因本地模型代理离线失败；切换模型后由新的人工追问继续，没有自动重跑旧消息，也没有模拟入站事件或模型。测试进程和空闲事件总线均已正常关闭。

## Manual live-check procedure

1. Obtain authorization to use a specific app and human private chat. Confirm competing listeners have stopped.
2. Build and pack the project, install the tarball into a dedicated profile, and run setup with the existing lark-cli profile and one explicit human open_id. Use an empty temporary workspace.
3. Run doctor, configure a working model provider, launch dsh from the workspace, and wait for the event-ready marker.
4. Ask the human to send: `Create standalone-feishu-check.txt with content STANDALONE_FEISHU_OK, then report the filename.`
5. Verify the incoming human message, acknowledgement, tool outcome, file bytes, final bot reply, and persisted Session. Do not substitute a synthetic event for the real inbound message.
6. Restart and ask a new follow-up to check history. A previously admitted message is not an automatic retry instruction. Keep failure evidence distinct from successful verification.
7. Close the owned dsh process normally. Stop only an idle event bus you own. Retain the task file and redacted verification notes; do not commit raw private chat dumps or credentials.

中文：自动集成测试使用真实安装包、dsh profile、文件工具和持久化 Session，仅替换模型与飞书端点。真实验证需要明确授权的应用、私聊用户和新的人工消息，核对文件字节与最终回复；不能用合成入站事件冒充实测。重启后用新的追问继续历史，不自动重跑已接收消息。结束时正常关闭自己拥有的监听。
