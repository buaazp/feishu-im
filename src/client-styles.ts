/** Published dsh theme tokens and legacy PluginCard metrics, without importing its private component. */
export const styles = `
.feishu-plugin-card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}
.feishu-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.feishu-plugin-card[data-open=true]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.feishu-plugin-header{appearance:none;box-sizing:border-box;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:none;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}
.feishu-plugin-header:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}
.feishu-plugin-heading{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0}
.feishu-plugin-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.feishu-plugin-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.feishu-plugin-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.feishu-plugin-card[data-open=true] .feishu-plugin-chevron{transform:rotate(180deg)}
.feishu-plugin-body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding:16px 0}
.feishu-settings{width:100%;max-width:760px;min-width:0;display:grid;gap:16px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.feishu-settings h2{font-size:16px;font-weight:600;margin:0}
.feishu-settings p{margin:6px 0;color:var(--dsw-alias-label-tertiary)}
.feishu-settings label{display:grid;gap:6px;font-weight:500}
.feishu-settings input{width:100%;height:34px;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:0 12px;background:var(--dsw-alias-bg-layer-3);color:inherit;font:inherit}
.feishu-settings input:focus-visible,.feishu-settings button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.feishu-settings button{appearance:none;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 14px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.feishu-settings button:not(.primary):hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}
.feishu-settings button.primary{background:var(--dsw-alias-label-primary);border-color:transparent;color:var(--dsw-alias-bg-layer-3)}
.feishu-settings button:disabled{opacity:.4;cursor:default}
.feishu-settings .tabs{display:flex;gap:8px;flex-wrap:wrap}
.feishu-settings .tabs [aria-pressed=true]{background:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}
.feishu-settings .panel{display:grid;gap:16px;border-bottom:.5px solid var(--dsw-alias-border-l2);padding:0 0 16px}
.feishu-settings .status{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.feishu-settings .status::before{content:'';width:7px;height:7px;background:var(--dsw-alias-label-tertiary);border-radius:50%}
.feishu-settings .status[data-state=connected]::before{background:var(--dsw-alias-state-success-primary,#2aa66e)}
.feishu-settings .error{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-error))}
.feishu-settings .qr-image{width:232px;height:232px;max-width:100%;margin:auto;background:white;border-radius:8px}
.feishu-settings code{display:block;overflow-wrap:anywhere;padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);user-select:all}
.feishu-settings small{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400}
.feishu-settings a{color:var(--dsw-alias-label-primary);text-decoration:underline}
.feishu-settings fieldset{border:0;padding:0;margin:0;display:grid;gap:16px;min-width:0}
@media(max-width:500px){.feishu-settings .tabs button{flex:1}}
@media(prefers-reduced-motion:reduce){.feishu-plugin-card,.feishu-plugin-chevron{transition:none}}
`
