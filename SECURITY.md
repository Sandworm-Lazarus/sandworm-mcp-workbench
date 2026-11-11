# Security boundaries

Use a trusted checkout, `npm ci`, and the pinned supported runtime. Do not run untrusted MCP servers with developer/cloud credentials. The shipped live command is deliberately limited to the bundled synthetic server.

The import path reads bounded bytes and stores canonical schema evidence; it does not execute imported schemas or HTML. Imported schemas can still contain private strings. Reports require human review before disclosure. Integrity hashes establish change, not identity or trust.

Raw Inspector stdout/stderr is suppressed on errors. The fixed demo process uses a temporary home/storage directory and a minimal environment. No OAuth flows or cloud calls are used by the demo. Process-group termination is implemented for managed Linux; Windows child-process cleanup has weaker descendant guarantees.

For a vulnerability in this integration, open a minimal reproducible issue containing synthetic data only. Do not publish credentials, private schemas or malicious endpoints in an issue. Upstream Inspector issues should also be reported through its security policy.
