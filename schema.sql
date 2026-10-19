PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS creator_profiles (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    trust_score INTEGER NOT NULL DEFAULT 0 CHECK (trust_score BETWEEN 0 AND 100),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    is_disabled INTEGER NOT NULL DEFAULT 0 CHECK (is_disabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS login_sessions (
    token_hash TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_login_sessions_expiry ON login_sessions(expires_at);

CREATE TABLE IF NOT EXISTS creative_posts (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (
        category IN ('Art', 'Fiction', 'Code', 'Music', 'Life Advice')
    ),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
    copyright_certified INTEGER NOT NULL CHECK (copyright_certified = 1),
    moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        moderation_status IN ('pending', 'published', 'hidden', 'rejected')
    ),
    is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
    report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_creative_posts_public
    ON creative_posts(moderation_status, is_hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creative_posts_creator
    ON creative_posts(creator_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_reports (
    post_id TEXT NOT NULL REFERENCES creative_posts(id) ON DELETE CASCADE,
    reporter_id TEXT NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (
        reason IN ('copyright', 'misinformation', 'harassment', 'illegal', 'spam', 'other')
    ),
    details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 1000),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (post_id, reporter_id)
);

CREATE TABLE IF NOT EXISTS moderation_events (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES creative_posts(id) ON DELETE CASCADE,
    moderator TEXT NOT NULL,
    action TEXT NOT NULL CHECK (
        action IN ('approved', 'rejected', 'hidden', 'restored', 'trust_adjusted')
    ),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS news_sources (
    id TEXT PRIMARY KEY,
    publisher TEXT NOT NULL,
    independence_group TEXT NOT NULL,
    feed_url TEXT NOT NULL UNIQUE,
    reuse_reviewed INTEGER NOT NULL DEFAULT 0 CHECK (reuse_reviewed IN (0, 1)),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    last_fetched_at TEXT,
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS news_items (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES news_sources(id),
    publisher TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT NOT NULL,
    topic_key TEXT NOT NULL,
    corroborating_publishers TEXT NOT NULL DEFAULT '[]',
    corroboration_count INTEGER NOT NULL DEFAULT 1 CHECK (corroboration_count >= 1),
    fact_check_status TEXT NOT NULL DEFAULT 'not_checked' CHECK (
        fact_check_status IN (
            'not_checked', 'no_matching_check', 'clear', 'flagged', 'unavailable'
        )
    ),
    fact_check_summary TEXT NOT NULL DEFAULT '',
    display_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        display_status IN ('pending', 'published', 'hidden')
    ),
    fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_id, canonical_url)
);

CREATE INDEX IF NOT EXISTS idx_news_items_display
    ON news_items(display_status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_topic
    ON news_items(topic_key, published_at DESC);
