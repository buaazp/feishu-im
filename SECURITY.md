# Security policy

Only the current release and its documented dsh version are maintained. This plugin admits remote instructions that can use the tools and OS permissions granted to its dsh profile. The sender allowlist is an admission control, not per-user process or filesystem isolation.

Run it under an appropriate OS account and permission policy. lark-cli retains app secrets and tokens; dsh retains model credentials. Session files can contain private conversations, file content, and tool results. Do not expose their directories or include them in public bug reports.

Do not open a public issue containing an exploit, credential, private chat transcript, or sensitive file. On a published GitHub repository with private vulnerability reporting enabled, use **Security → Report a vulnerability**. No remote repository or private reporting address is configured in this source release; until one is available, contact the person who supplied this checkout privately. Do not assume an invented email address is monitored.

Provide the affected version, impact, minimal reproduction, and whether the issue involves the plugin, lark-cli, or dsh. Remove credentials from examples. Maintainers should enable private reporting and update this document before public release. Disclosure timing is agreed with the reporter; there is no promised response SLA.

中文：白名单用户可调用 profile 授予的工具，多个用户共享系统账号和目录。请保护本地凭据、会话和日志。敏感问题不要发公开 issue；公开仓库开启私密漏洞报告后使用 GitHub Security 入口，之前请私下联系提供源码的人。
