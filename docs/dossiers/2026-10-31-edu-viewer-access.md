# Edu independent read-only login

Request: explicitly authorize a second Health identity to view the existing student's Edu learning data, retaining separate accounts and granting no Health data access. Actual identities and production IDs stay outside version control.

Candidate bases: Edu b890f8b; Health 1b7d27bcd. Isolated worktrees preserve unrelated local changes. Production has the single-subject SSO implementation and no parent account yet. No production data/configuration changes, commit, push, or deployment performed.

## Contract

Health `EDU_SSO_VIEWER_IDS` is an optional comma-separated list of additional positive Health user IDs. Tickets still identify the actual authenticated user, require active/approved/non-managed status, and preserve existing cookie/JWT/proxy restrictions.

Edu `EDU_HEALTH_SSO_VIEWERS` is an optional JSON object mapping Health subject strings to distinct Edu parent user IDs, e.g. `{"8":2}` (synthetic). Every session and native token checks the current mapping and verifies that the parent remains bound to the configured owner student. Removal or rebinding invalidates subsequent authenticated requests. No automatic email matching or merging.

Only explicitly configured viewers receive the new read-only restriction. Existing parent assignment behavior is preserved. Viewer reads use an explicit endpoint allowlist for exams, scores, learning tasks/checkins, mistakes, courses, uploaded papers, saved monthly reports, assignments, and learning profiles. Daily tips return existing data or absence without generation. Other protected endpoints fail closed; new read surfaces need review. Viewer authentication and logout remain available. UI controls not already hidden for parents may still be visible; backend rejects their writes.

## Activation plan (not executed)

1. Obtain separate commit/push/deploy authorization, then satisfy both repositories' current release gates and CI for exact revisions; preserve unrelated runtime changes.
2. Recheck the two exact Health accounts and current owner mapping. Transactionally create a separate Edu parent with an unguessable unused local password hash, linked to the existing student; do not rename or overwrite an existing account.
3. Add only the viewer Health ID to Health's allowlist and the verified Health-to-parent mapping to Edu. Keep owner configuration and all business data unchanged. Audit the association without logging secrets.
4. Verify browser and native login as viewer, read bound data, deny writes/admin reads, verify original owner still works. Actual device login has not been tested.
5. Revoke by removing the added mapping/allowlist; existing viewer sessions then fail. Preserve business data and original owner settings.

## Validation

Regression suite and paired issuer tests recorded in local test logs. Initial independent review identified GET side effects, global admin metadata access, and overly broad parent restrictions; candidate now has scoped capabilities, an explicit read allowlist, and regression cases. This is a candidate, not an activated association.

Latest evidence: Edu full backend suite 155 passed (paired owner browser/native issuer tests enabled); subsequent complete viewer suite 12 passed, including actual Health-to-Edu viewer ticket contract. Health SSO suite 49 passed. Health System Map drift check passed. Independent read-only security reviewer returned GO for the corrected candidate, explicitly not production activation. No tests establish real browser/device login yet. User subsequently authorized deployment and association. Release work is in progress; no completed production claim is implied.

## Authorized release result

User authorized deploy and association. Edu code commit `35f3ff98f8dd7d8e9c5690c565b0e19a830e85fc` reached main; CI run `41177254182` passed. The five changed backend files matched their expected production predecessor hashes before scoped atomic installation. Production `edu-backend` restarted and `/api/health` passed. A distinct parent account and explicit viewer mapping were configured; bound owner and business-table counts were verified unchanged. Private server journals: `/var/lib/edu-viewer-release/journal.json` and `link.json`. Do not rerun those one-shot operators.

Health commit `ed757e26d5ca07659101568b6b3f21c434b516ed` reached main; complete CI run `41177311095` passed. Added narrowly scoped `scripts/edu_viewer_activation.py`; 38 activation tests passed and independent safety reviewer returned GO after full effective SSO settings and pending restart transition corrections. Canonical source is present at `/var/lib/reva-release/bootstrap/ed757e26d5ca07659101568b6b3f21c434b516ed/source`.

Health release authorization rotation was attempted once and rejected. Read-only inspection found an existing `successful-auth-revocations/8d4d6c5c627ec50b27e67b6282946ec4ccb664c7/intent.json` bound to **another candidate** `a030c61539c388e78a79fa6c6e01392310044d12`, created 2026-10-31 06:37:20 UTC. No `completed.json`, no matching retired record, no active bootstrap process. Current installed policy and production remain `8d4d6c5c627ec50b27e67b6282946ec4ccb664c7`; backend is active, no business lease. This task did not delete or replay the incomplete transaction, restore credentials, or deploy Health via another path. Health viewer activation has not run.

Browser verification reached the normal Edu -> Health confirmation page and identified the requested viewer's existing login session. No successful viewer login into Edu is claimed: issuer is still the old single-account version. Next dependency is controlled closure/recovery of the existing authorization transaction by its owning release flow; after that, rotate/deploy the current exact-green Health candidate and run canonical viewer activation, then verify real browser login/read-only behavior. Do not treat the saved Edu association or passing tests as end-to-end access completion.
