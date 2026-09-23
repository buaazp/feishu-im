# Security

Only explicitly authorized human open_ids may run tasks, and only through private text messages. Pairing codes are random, expire after ten minutes and work once. QR registration authorizes only a validated scanner identity returned by Feishu. An absent identity never implies open access.

Application credentials remain in the dsh profile, outside the task workspace, with secret schema redaction and `0600` writes. Configuration and pairing use dsh's authenticated browser transport. The plugin never imports lark-cli secrets and never logs SDK credential or socket-ticket objects. Do not commit profile files, App Secrets or login URLs.

Decision cards bind app, task source, private chat, sender, card id and a random one-use token. Invalid, expired and replayed callbacks fail closed. Approval grants apply once, and dsh's `never` policy remains authoritative. Oversized or unavailable action details cannot be approved through a truncated card.

Task permissions are those of the dsh deployment and its selected Agent preset. Authorize only users you trust with those tools. Revoke access on the configuration page and rotate compromised application secrets in Feishu's developer console.

Report suspected vulnerabilities privately to the repository maintainer, including versions and a minimal reproduction with credentials removed. Do not publish working secrets in issues or logs.
