# Changelog

## 0.2.0

- Replace lark-cli with direct Feishu OpenAPI and the official SDK long connection.
- Add the dsh Plugins configuration page with official QR registration, manual credentials, live updates and explicit one-use pairing.
- Compose beside dsh Web and mount the original Agent preset when resuming history.
- Show task milestones in updated cards and collect approvals and structured answers through sender-bound interactive cards.
- Preserve durable message deduplication, bounded queues, cancellation and awaited shutdown.
- Move configuration to `config.account`; remove command/profile transport options. Existing secrets are never imported automatically.

## 0.1.0

- Initial standalone plugin with lark-cli bot transport, dedicated profile setup, private-chat authorization and durable conversation history.
