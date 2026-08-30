# Runbook: Search Index Rebuild

If the search index becomes desynchronized due to a schema change, bad partial write, or outage, admins can trigger a background rebuild. The rebuild runs in bounded batches (500 docs/batch) to ensure live search traffic is not blocked.

## Triggering a Dry Run
Always run a dry run first to verify database connectivity and estimate the scope of the rebuild. A dry run does **not** mutate the index.
```bash
curl -X POST [https://api.yoursite.com/api/admin/search/rebuild](https://api.yoursite.com/api/admin/search/rebuild) \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
