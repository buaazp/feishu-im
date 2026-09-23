# Architecture

[中文](architecture.zh-CN.md)

The independent bundle adds a channel beside a profile-owned dsh runner. The management executable edits configuration and diagnoses credentials; it never launches Agent applications. Published Harness packages remain external at `0.1.7-alpha.2`.

## Connection and configuration

`FeishuApi` owns direct HTTP calls, cached tenant access tokens, bounded response parsing, request deadlines and cancellation. Concurrent token users share an application-owned refresh. Text replies split at Unicode code points and carry deterministic UUIDs. Only explicit token-rejection codes permit one authentication retry; a failed reply does not re-admit a task.

`FeishuEvents` uses the official SDK's WebSocket client and dispatcher. Its public HTTP adapter owns endpoint discovery, and public Node agents own sockets through handshake and close. Closing cancels discovery, force-closes the SDK and awaits owned sockets/requests. Malformed and unsupported events are contained at the boundary. Logs do not print SDK credential or ticket objects.

The `account` volatile schema marks App Secret as a secret. The configuration page uses dsh's authenticated Connection transport and revisioned Settings service. QR registration follows Feishu's official app-registration API with minimal bot permissions and explicit scanner identity. Unlike the SDK registration helper, every initial request, poll and delay is cancellable and bounded. Manual setup uses a random, expiring, one-use pairing code. No local lark-cli state is read.

Reconfiguration serializes generations: abort the old connection, cancel and join its tasks and decisions, then start the latest account. Missing configuration or connection failure leaves the Web application available for repair.

## Task ownership

Native events must be human, private and textual. Explicit allowedUsers authorization precedes task admission. The Session hash binds application namespace, workspace, chat and sender. Each worker owns one Agent handle, a bounded queue, task deadline and cancellation controller.

New Agents mount the current published preset via the registry during setup. Resumed Agents mount their persisted preset and reject incompatible workspace or lineage. Durable user/message and inbox-splice events prevent duplicate admissions across restarts. Interrupted inbox entries are cleared rather than replaying side effects. `/dsh stop` clears unstarted work and cancels the active interval.

## Feedback and decisions

Committed Session events drive one milestone card per task. Only public assistant text, stage labels, tool names and tool success/failure summaries appear. Updates serialize, retain at most one pending snapshot and coalesce under slow delivery. Final text is separate and can span bounded replies.

Agent-scoped approval and user-question waterfalls route to single-use cards. Each callback must match application, message/card, private chat, sender and a random request token. Form selections are checked against the exact options. Cards expire on timeout, task cancellation, reconfiguration or shutdown. Oversized or incomplete approval details fail closed. The upstream approval policy runs first; `never` cannot be bypassed.

## Source contracts

- [Official Feishu SDK](https://github.com/larksuite/node-sdk): WSClient, EventDispatcher and registerApp.
- Published `dsh-agent`, `dsh-agent-preset-registry`, `dsh-session-query`: Agent ownership and durable history.
- Published `dsh-settings`, `dsh-client-connection`, `dsh-client-ui-plugin-manager`: profile persistence, authenticated browser transport and bundle configuration slots.
- Published `dsh-user-approval`, `dsh-user-questions`: scoped decision protocols.

Tests use isolated fake Feishu HTTP/WebSocket servers, published real Agents and a packed real Web profile. No real messages are sent by automation.
