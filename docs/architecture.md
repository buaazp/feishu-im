# Architecture

[中文](architecture.zh-CN.md)

The independent bundle adds a channel beside a profile-owned dsh runner. The management executable edits configuration and diagnoses credentials; it never launches Agent applications. Published Harness packages remain external; the minimum supported dsh is `0.1.5-rc.2`.

## Connection and configuration

`FeishuApi` owns direct HTTP calls, cached tenant access tokens, bounded response parsing, request deadlines and cancellation. Concurrent token users share an application-owned refresh. Replies use Feishu `post` messages with standalone `md` elements. Splitting respects the complete serialized JSON byte budget, prefers whole lines, closes/reopens long code fences with their language, and preserves Unicode code points and deterministic UUIDs. Only explicit token-rejection codes permit one authentication retry; a failed reply does not re-admit a task.

`FeishuEvents` uses the official SDK's WebSocket client and dispatcher. Its public HTTP adapter owns endpoint discovery, and public Node agents own sockets through handshake and close. Closing cancels discovery, force-closes the SDK and awaits owned sockets/requests. Malformed and unsupported events are contained at the boundary. Logs do not print SDK credential or ticket objects.

A capability-based adapter uses the published SettingsScope register/get/watch API on older dsh and volatile Config/SettingsForms on 0.1.7. Both mark App Secret as a secret and use the same revisioned account updates. The browser contributes a collapsible card to the old settings namespace slot and a single row configuration entry to the new Plugins page; absent slots remain inactive. The configuration page uses dsh's authenticated Connection transport and revisioned Settings service.

The page offers only **Create a bot with QR** and **Bind an existing app**. QR registration follows Feishu's official app-registration API with minimal bot permissions and explicit scanner identity. Unlike the SDK registration helper, every initial request, poll and delay is cancellable and bounded. Manual setup accepts only App ID / App Secret in the browser. Same-app authorizations are preserved; replacing the app clears them by default. When no user is authorized, saving on the page automatically offers a random, expiring, one-use pairing code; authorization still requires the user to send it in the bot's private chat. The default workspace `~/dsh-workspaces/feishu-im` is created automatically. Explicit directories must already exist, be readable/writable and remain outside the profile. No local lark-cli state is read.

Reconfiguration serializes generations: abort the old connection, cancel and join its tasks and decisions, then start the latest account. Missing configuration or connection failure leaves the Web application available for repair.

## Task ownership

Native events must be human, private and textual. Explicit allowedUsers authorization precedes task admission. The `feishu_im` storage domain binds application namespace, chat and sender to a directory and current Session. Initial Session hashes remain compatible with the previous workspace-based identity. A worker owns one Agent handle, a bounded queue, task deadline and cancellation controller. Idle handles remain published in dsh and have no automatic Workspace membership, so tasks stay in Ungrouped; they do not consume the active-worker limit.

New Agents mount the current published preset via the registry during setup. Resumed Agents mount their persisted preset and reject incompatible workspace or lineage. A durable admission ledger written before followup prevents repeats across task switches and restarts; legacy user/message and inbox-splice events remain authoritative for old Session admissions. Interrupted inbox entries are cleared rather than replaying side effects.

Ordinary messages continue the current task. `/dsh stop` clears unstarted work and cancels the active interval while retaining the task. `/dsh new` and `/dsh cd` durably select a fresh Session for the next prompt and preserve older tasks; switching requires idle work. `/dsh cd` changes only this private chat's directory, leaving defaults for other chats unchanged. `/dsh archive` cancels and joins owned work, persists an archive intent, updates the public Workspace archive set and releases the archived handle. Pending archive intents are completed before later admission after a failure or restart. Shutdown and reconfiguration join admission, tasks, decisions and replies, dispose all owned handles and close the storage domain.

## Feedback and decisions

Committed Session events drive one milestone card per task. The matching `agent/inbox/claimed` and `turn/end` delimit the Feishu turn, so later Web turns on the retained Agent do not leak their output or decisions into the chat. Only public assistant text, stage labels, tool names and tool success/failure summaries appear. Updates serialize, retain at most one pending snapshot and coalesce under slow delivery. Final text is separate and can span bounded replies.

Agent-scoped approval and user-question waterfalls route to single-use cards. Each callback must match application, message/card, private chat, sender and a random request token. Form selections are checked against the exact options. Cards expire on timeout, task cancellation, reconfiguration or shutdown. Oversized or incomplete approval details fail closed. The upstream approval policy runs first; `never` cannot be bypassed.

## Source contracts

- [Official Feishu SDK](https://github.com/larksuite/node-sdk): WSClient, EventDispatcher and registerApp.
- Published `dsh-agent`, `dsh-agent-presets` / `dsh-agent-preset-registry`, `dsh-session-query`: Agent ownership and durable history.
- Published `dsh-storage-domain`, `dsh-workspace`: durable routing, admission records and explicit archives. Both supported host generations use the public `storageDomain.open` and `workspaceRegistry.archiveSession` APIs.
- Published `dsh-settings`, `dsh-client-connection`, `dsh-client-ui-slots`: profile persistence, authenticated browser transport and bundle configuration slots.
- Published `dsh-user-approval`, `dsh-user-questions`: scoped decision protocols.

Tests use isolated fake Feishu HTTP/WebSocket servers, published real Agents and a packed real Web profile. No real messages are sent by automation.
