# Private portfolio storage

Published in `stack-diagram-db` / `(default)` on 2026-09-22 at 00:17 Asia/Taipei.
The previous rules release (2026-09-08 10:34) remains in Console history for rollback.
Existing secrets, users, projects and units rules were preserved verbatim. There was no broad recursive allow rule.

The appended fragment covers only `rotationPortfolios/{uid}/positions/{positionId}`.
The authenticated UID must match the path. Existing app admin roles do not grant access to another user's portfolio. Firebase project administrators still have administrative database access.

Firebase Console Rules Playground checks against the new draft:

- Anonymous get: denied.
- Matching authenticated UID get: allowed.
- Different authenticated UID get: denied.
- Matching UID create with incomplete/wrongly typed fields: denied.
- Console compiled and published the corrected rules successfully.

These were simulations, not writes to a real user's portfolio. End-to-end saving with the user's website credentials requires their website sign-in; the Google Console session is separate. Do not claim that cross-device saving was exercised before this is done.

Client saves use transactions, server timestamps and monotonically increasing revisions. Conflicting edits are rejected for review. Removal sets `archived: true` and can be undone; permanent deletion is denied. The client does not enable Firestore persistent disk caching or put positions in localStorage. Auth uses the existing Firebase session.

Only public market data and strategy reports go into GitHub. No holdings, account passwords or authentication tokens belong in this repository.

## Manual activity journal — 2026-09-23

The owner-only journal fragment was published in the same project/database at 00:10 Asia/Taipei on 2026-09-23. Console history shows it as the active release. The full draft was checked against the intended text before publishing; existing rules outside the portfolio match were preserved verbatim.

The `activity` subcollection is readable only by the position owner. New entries and parent balances must be written atomically and satisfy the same quantity, cost and realized-P/L arithmetic. Historical entries cannot be edited or deleted. Reversal appends a compensating entry for the latest buy/sell. Ordinary plan edits cannot bypass journal balance updates.

GitHub Actions run 35751989407 passed 11 Firestore emulator tests against this exact fragment, including owner isolation, buy/sell/reversal arithmetic, immutable history, replay rejection and plan edits. The JavaScript suite passed 34 tests. Browser checks used synthetic in-memory positions; no actual user holdings were created or changed. Production cross-device saving with the user's website login was not exercised.
