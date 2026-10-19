# United World news and creator platform

This is a prototype architecture, not a guarantee that the platform can be made
free of misinformation, copyright disputes, unlawful material, or legal risk.
Automated checks are fallible; public operation requires trained human review,
clear terms/privacy notices, a response process, and jurisdiction-specific legal
advice. Feed access alone does not grant rights to republish feed metadata.

## Components

- `server.js`: existing Node HTTP server plus same-origin community API routing.
- `community.js`: SQLite-backed creator accounts, sessions, posts, reports,
  moderation actions, RSS ingestion, story matching, and optional fact-check
  lookups.
- `schema.sql`: persistent relational schema with constraints and indexes.
- `news-sources.json`: explicit RSS allowlist. All example feeds start disabled.
- `index.html`, `style.css`, `script.js`: News Hub, contributor forms, reports,
  terms notice, and moderator review UI.
- Database file: `data/united-world.sqlite` by default. Override with
  `UKOS_DB_PATH` for hosting or tests.

Node.js 22.13 or newer is required because the service uses the built-in
`node:sqlite` module. No npm packages are needed. Use a single server process for
this SQLite prototype; move to a managed database and shared rate limiting before
horizontal scaling.

## Start locally

```powershell
$env:COMMUNITY_ADMIN_TOKEN = "a-long-random-administrator-secret"
$env:UKOS_DB_PATH = ".\data\united-world.sqlite"
node .\server.js
```

Visit `http://localhost:3000`. For deployment, set `NODE_ENV=production`, use
HTTPS, keep all credentials in the hosting provider's secret manager, back up and
restrict access to the SQLite database, and configure a vetted email verification
and account-recovery process before accepting public accounts.

Optional fact-check lookup:

```powershell
$env:GOOGLE_FACT_CHECK_API_KEY = "your-restricted-api-key"
```

The Google Fact Check Tools API returns published claim reviews, not a definitive
truth oracle. A matching review rated false or misleading suppresses the clustered
story from the public News Hub pending review. A missing match or unavailable API
does not prove a story is true. The API key is never sent to the browser.

## News workflow

1. An administrator reviews each publisher's RSS terms and records whether the
   intended display and use are allowed. Configure one distinct publisher and
   `independenceGroup` per editorially independent organization. Only set both
   `enabled` and `reuseReviewed` to `true` after this review.
2. Every 15 minutes, the service fetches only those configured HTTPS RSS feeds.
   Fetches time out after 12 seconds and feeds over 2 MB are rejected. The parser
   keeps only headline, canonical HTTPS link, publication time, and a short
   description used internally for matching. It does not republish article text.
3. Items must be no older than six hours. A conservative token overlap/Jaccard
   match groups similar headlines/descriptions. At least three distinct
   `independenceGroup` values are required before a topic is eligible for display.
   This heuristic can miss related reports or incorrectly group similar stories;
   it does not establish that the underlying claim is true.
4. When configured, Google Fact Check Tools is queried for the candidate headline.
   Matching false/misleading ratings mark the cluster hidden. Other rating results
   and missing results are shown as limited fact-check context, not certification.
5. The News Hub displays the original publisher, original publication time, title,
   cross-source count, fact-check status, and a required link to the primary source.
   Items older than six hours are removed from the public query.

The supplied example feed URLs are known public endpoints (BBC World, NPR World,
UN News), but `news-sources.json` deliberately leaves all disabled. Their reuse
conditions, commercial use, attribution, caching, and headline-display rules must
be checked with the publisher before enabling. In particular, free-to-access RSS
is not necessarily licensed for commercial republication. Do not add a source just
because a feed URL is reachable. Reuters/AP may not offer a generally reusable
free public feed for this purpose; use official feeds and licenses rather than
scraping paywalls or bypassing access controls.

The initial matcher uses English tokenization. A global product needs reviewed
local source sets, language-aware matching, time-zone-aware operations, human
editorial review, and an appeals/correction workflow. Three feeds are a conservative
threshold, not a guarantee against coordinated or shared-origin reporting.

## Creative platform and accounts

- Account passwords are stored using per-account salted scrypt hashes; session
  cookies are HTTP-only and SameSite=Lax. Production cookies add `Secure`.
- Passwords must be at least 12 characters. Registration is currently not
  email-verified and account recovery is not implemented; do not treat this as a
  production-ready global identity system until those flows and privacy rights are
  implemented.
- Posts are plain text and restricted by a database check to Art, Fiction, Code,
  Music, and Life Advice. Rendering uses `textContent`, not user-supplied HTML.
- The author must tick the rights attestation. It does not prove ownership or
  create immunity from copyright law.
- New creators start with trust score 0. Posts remain pending until moderator
  approval. A moderator approval adds five points; score 80 is required before
  subsequent posts may auto-publish, unless a lightweight text rule holds them
  for review.
- The text checks are narrow abuse signals (for example, credential solicitation,
  threat phrasing, or excessive external links). They are not comprehensive hate,
  sexual-content, misinformation, or illegal-content detection. Avoid claiming
  that automated filtering catches all prohibited material.
- Signed-in users can report a post once each. Three distinct accounts automatically
  hide it until moderator review. Reports can be abused; admins should inspect
  report reasons and restore content when appropriate.
- Moderators use the site’s “Moderator review” panel and the secret
  `COMMUNITY_ADMIN_TOKEN` entered in the panel. Set a high-entropy token. It is
  held only in page memory and is sent over the same-origin API. Rotate it if
  exposed. A shared static token is an interim one-admin mechanism, not a
  multi-moderator access-control system.

### API routes

- `GET /api/community/news`: public eligible news metadata.
- `GET /api/community/posts`: public published creative posts only.
- `GET /api/community/me`: current creator profile or `null`.
- `POST /api/community/register`, `/login`, `/logout`: same-origin account flows.
- `POST /api/community/posts`: authenticated submission.
- `POST /api/community/posts/:id/report`: one report per signed-in user.
- `GET /api/community/admin/pending`: administrator queue.
- `POST /api/community/admin/posts/:id`: administrator action `approve`, `reject`,
  `hide`, or `restore`.

Mutating requests require a same-origin `Origin` header. Basic per-process rate
limits are not sufficient protection against distributed abuse. Before public
launch, add durable account verification, password resets, stronger shared rate
limits, abuse detection, admin identity/audit controls, deletion/retention tools,
moderation staffing, legal notices and takedown handling, backups, monitoring, and
security review.

## Safety and legal limitations

The displayed community notice is a policy statement, not a legal guarantee.
Neither a checkbox, profanity/regex filter, three reports, RSS comparison, nor an
AI/API result can ensure that all copyright infringement, falsehoods, threats, or
unlawful content are caught. Keep a human escalation path and consult qualified
counsel before launch in each intended market. The site's general learning
disclaimer does not replace a privacy policy, terms of service, copyright complaint
procedure, or local compliance review.
