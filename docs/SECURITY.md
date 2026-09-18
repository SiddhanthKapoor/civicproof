# Security and privacy

| Area | Control |
|---|---|
| Secrets | None in the browser. On AWS, access comes from the Lambda execution role. `.env*` files are git-ignored and excluded from the Lambda bundle. |
| IAM | SAM policy templates scope DynamoDB to one table and S3 to one bucket; Bedrock is limited to `InvokeModel*` on the configured inference profile and the Claude/Nova model family. No wildcard `*` actions. |
| Agent permissions | Cedar evaluates every tool call (`policies/agent-tools.cedar`). The agent has no tool that can submit, send, delete, change status, run commands or fetch URLs. |
| Human actions | Cedar evaluates every case change (`policies/case-actions.cedar`). Real-world actions (submission, response, status) require the owner key; only its SHA-256 is stored, compared in constant time. |
| Input validation | Zod schemas on every route; errors return field messages, never stack traces. |
| Uploads | ≤4 photos, ≤8 MB each, ≤6 MB request; type decided by magic bytes (JPEG/PNG/WebP), not by the client's claim; re-encoded in the browser (strips EXIF from the stored file); SHA-256 fingerprinted; stored in a private bucket; served with `nosniff` and `default-src 'none'`. |
| Privacy | Reporter name and contact are optional; contact is never returned by any API. Photo GPS is only used to suggest the pin. Documents the reporter adds (e.g. RTI replies, which carry their name and address) are private: only the owner key can read or download them, and the key is sent in a header, never in a URL. Only excerpts the investigator quotes become public evidence. |
| Cost / abuse | Per-IP rate limits (per instance), a per-day investigation budget in DynamoDB and a per-case cap, both enforced through Cedar; per-run tool-call and time budgets. |
| Content | Neutral-language guard on model output; complaint packets are assembled from verified facts only and carry a "draft, verify before sending" disclaimer. |
| Transport | Function URL is HTTPS only; S3 bucket policy denies non-TLS access; standard security headers (`X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies). |
| Data at rest | DynamoDB SSE and point-in-time recovery; S3 SSE-S3 with versioning. |

## Known gaps

- Rate limits are in-memory per Lambda instance; a distributed limiter (DynamoDB or WAF) would be needed at scale. A Function URL cannot sit behind AWS WAF directly; put CloudFront in front for that.
- The owner key is a bearer secret with no recovery flow.
- Public case pages expose the reported location and description by design; reporters should not include personal details in descriptions.
