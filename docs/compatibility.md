# Compatibility

| Component | Supported baseline |
| --- | --- |
| dsh and Harness packages | `0.1.7-alpha.2` |
| Cordis | `4.0.4` |
| Node.js | `^22.19.0` or `>=24.0.0` |
| pnpm | `10+`; local installation verified with `12.5.1` |
| lark-cli | `1.0.78` or a compatible newer release |
| Chat | Feishu bot private text messages |

Harness APIs are pre-stable. This release pins the published versions it builds and tests against. npm's dsh `latest` tag currently points to an older rc release; install the documented exact version. Do not combine libraries copied from a source checkout with an installed CLI.

The plugin uses lark-cli's public `profile list`, `auth status --json --verify`, `event consume im.message.receive_v1 --as bot`, and `im +messages-reply` commands. `profile list` returns JSON without `--json`; `auth status` reports both identities and does not accept `--as`. An expired user OAuth token does not prevent bot transport.

Tests run against published npm packages. Automated integration uses a real dsh profile and substitutes only external model and Feishu endpoints. Live chat validation requires an authorized app and a human message; it is not run in CI.

To change the supported Harness version, update the pinned dependencies together, regenerate the lockfile, and rerun unit, package-installation, and real-profile tests. A version bump alone does not establish compatibility.
