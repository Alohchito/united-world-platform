"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const databasePath = process.env.UKOS_DB_PATH || path.join(root, "data", "united-world.sqlite");
const schema = fs.readFileSync(path.join(root, "schema.sql"), "utf8");
const databaseDirectory = path.dirname(databasePath);
fs.mkdirSync(databaseDirectory, { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
db.exec(schema);
db.prepare("UPDATE news_sources SET enabled = 0").run();
db.prepare("DELETE FROM login_sessions WHERE expires_at <= ?").run(new Date().toISOString());

const categories = new Set(["Art", "Fiction", "Code", "Music", "Life Advice"]);
const reasons = new Set(["copyright", "misinformation", "harassment", "illegal", "spam", "other"]);
const trustedCreatorScore = 80;
const reportHideThreshold = 3;
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const dummyPasswordHash = "00000000000000000000000000000000:" + "0".repeat(128);
const requestCounters = new Map();
let refreshRunning = false;
let sources = [];

try {
    const sourceConfig = JSON.parse(fs.readFileSync(path.join(root, "news-sources.json"), "utf8"));
    if (!Array.isArray(sourceConfig)) {
        throw new Error("News source configuration must be an array.");
    }
    sources = sourceConfig.filter(function (source) {
        return source &&
            typeof source.id === "string" &&
            typeof source.publisher === "string" &&
            typeof source.independenceGroup === "string" &&
            typeof source.feedUrl === "string" &&
            source.enabled === true &&
            source.reuseReviewed === true &&
            isSafeFeedUrl(source.feedUrl);
    });
} catch (error) {
    console.error("News sources could not be loaded: " + error.message);
}

function isSafeFeedUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !url.port;
    } catch {
        return false;
    }
}

function json(response, status, payload) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    response.end(JSON.stringify(payload));
}

async function readBody(request, maxBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBytes) {
            const error = new Error("Request body is too large.");
            error.status = 413;
            throw error;
        }
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        const error = new Error("Send a valid JSON request.");
        error.status = 400;
        throw error;
    }
}

function hasSameOrigin(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (typeof origin !== "string" || typeof host !== "string") {
        return false;
    }
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
            parsed.host.toLowerCase() === host.toLowerCase();
    } catch {
        return false;
    }
}

function rateLimit(request, name, limit, windowMs) {
    const now = Date.now();
    const ip = request.socket.remoteAddress || "unknown";
    const key = name + ":" + ip;
    const current = requestCounters.get(key);
    if (!current || current.startedAt + windowMs <= now) {
        if (requestCounters.size > 5000) {
            requestCounters.forEach(function (entry, entryKey) {
                if (entry.startedAt + windowMs <= now) {
                    requestCounters.delete(entryKey);
                }
            });
        }
        requestCounters.set(key, { startedAt: now, count: 1 });
        return true;
    }
    current.count += 1;
    return current.count <= limit;
}

function sessionCookie(token, maxAgeSeconds) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return "uw_session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
        maxAgeSeconds + secure;
}

function parseCookies(header) {
    const cookies = {};
    (header || "").split(";").forEach(function (part) {
        const separator = part.indexOf("=");
        if (separator > 0) {
            cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
        }
    });
    return cookies;
}

function getCurrentUser(request) {
    const token = parseCookies(request.headers.cookie).uw_session;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
        return null;
    }
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const row = db.prepare(`
        SELECT p.id, p.email, p.display_name, p.trust_score
        FROM login_sessions s
        JOIN creator_profiles p ON p.id = s.creator_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND p.is_disabled = 0
    `).get(tokenHash, new Date().toISOString());
    return row || null;
}

function createSession(response, creatorId) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();
    db.prepare(`
        INSERT INTO login_sessions (token_hash, creator_id, expires_at)
        VALUES (?, ?, ?)
    `).run(crypto.createHash("sha256").update(token).digest("hex"), creatorId, expiresAt);
    response.setHeader("Set-Cookie", sessionCookie(token, Math.floor(sessionDurationMs / 1000)));
}

function deleteSession(request, response) {
    const token = parseCookies(request.headers.cookie).uw_session;
    if (token && /^[a-f0-9]{64}$/.test(token)) {
        db.prepare("DELETE FROM login_sessions WHERE token_hash = ?")
            .run(crypto.createHash("sha256").update(token).digest("hex"));
    }
    response.setHeader("Set-Cookie", sessionCookie("", 0));
}

function isPasswordValid(password) {
    return typeof password === "string" && password.length >= 12 && password.length <= 200;
}

function isJsonObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function passwordHash(password, salt) {
    const actualSalt = salt || crypto.randomBytes(16).toString("hex");
    const key = await scrypt(password, actualSalt, 64);
    return { salt: actualSalt, hash: key.toString("hex") };
}

async function passwordMatches(password, savedValue) {
    const separator = savedValue.indexOf(":");
    if (separator < 0) {
        return false;
    }
    const salt = savedValue.slice(0, separator);
    const expected = Buffer.from(savedValue.slice(separator + 1), "hex");
    const actual = Buffer.from((await passwordHash(password, salt)).hash, "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function safeNewsItem(row) {
    return {
        title: row.title,
        url: row.canonical_url,
        publishedAt: row.published_at,
        primarySource: row.publisher,
        corroboratingSources: JSON.parse(row.corroborating_publishers),
        corroborationCount: row.corroboration_count,
        factCheckStatus: row.fact_check_status,
        factCheckSummary: row.fact_check_summary
    };
}

function decodeXml(value) {
    return value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, function (match, number) {
            const codePoint = Number(number);
            return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
        })
        .replace(/&#x([0-9a-f]+);/gi, function (match, number) {
            const codePoint = parseInt(number, 16);
            return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
        })
        .replace(/\s+/g, " ")
        .trim();
}

function xmlTag(block, name) {
    const expression = new RegExp("<(?:[\\w.-]+:)?" + name + "\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + name + "\\s*>", "i");
    const match = block.match(expression);
    return match ? decodeXml(match[1]) : "";
}

function parseFeed(xml, source) {
    const articleBlocks = xml.match(/<(?:[A-Za-z0-9_-]+:)?item\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?item\s*>/gi) || [];
    return articleBlocks.map(function (block) {
        const title = xmlTag(block, "title");
        const rawUrl = xmlTag(block, "link");
        const publishedText = xmlTag(block, "pubDate") || xmlTag(block, "published") ||
            xmlTag(block, "updated") || xmlTag(block, "date");
        const description = xmlTag(block, "description") || xmlTag(block, "summary");
        const publishedTime = Date.parse(publishedText);
        let url;
        try {
            url = new URL(rawUrl);
        } catch {
            return null;
        }
        if (!title || !Number.isFinite(publishedTime) ||
            url.protocol !== "https:" || !source.allowedHosts.has(url.hostname)) {
            return null;
        }
        return {
            title: title.slice(0, 500),
            url: url.href,
            publishedAt: new Date(publishedTime).toISOString(),
            description: description.slice(0, 1200),
            source: source
        };
    }).filter(Boolean);
}

const stopWords = new Set([
    "about", "after", "again", "against", "among", "because", "before", "being",
    "between", "could", "first", "from", "have", "into", "more", "most", "other",
    "over", "said", "says", "some", "than", "that", "their", "there", "these",
    "they", "this", "through", "under", "what", "when", "where", "which", "while",
    "will", "with", "would", "your", "news", "update", "live", "latest"
]);

function termsFor(article) {
    const text = (article.title + " " + article.description).toLocaleLowerCase("en");
    return new Set((text.match(/[\p{L}\p{N}]{3,}/gu) || [])
        .filter(function (word) { return !stopWords.has(word); }));
}

function similarity(first, second) {
    const firstTerms = termsFor(first);
    const secondTerms = termsFor(second);
    const intersection = Array.from(firstTerms).filter(function (term) {
        return secondTerms.has(term);
    });
    const union = new Set(Array.from(firstTerms).concat(Array.from(secondTerms)));
    return {
        overlap: intersection.length,
        score: union.size ? intersection.length / union.size : 0
    };
}

function groupArticles(articles) {
    const groups = [];
    articles.forEach(function (article) {
        let bestGroup = null;
        let bestScore = 0;
        groups.forEach(function (group) {
            const strongest = group.articles.reduce(function (best, existing) {
                const compared = similarity(article, existing);
                return compared.overlap >= 2 && compared.score > best.score ? compared : best;
            }, { score: 0 });
            if (strongest.score > bestScore) {
                bestScore = strongest.score;
                bestGroup = group;
            }
        });
        if (bestGroup && bestScore >= 0.24) {
            bestGroup.articles.push(article);
        } else {
            groups.push({ articles: [article] });
        }
    });
    return groups;
}

function hasIndependentCorroboration(group, minimumSources) {
    return new Set(group.articles.map(function (article) {
        return article.source.independenceGroup;
    })).size >= minimumSources;
}

async function checkFactRatings(title) {
    const apiKey = process.env.GOOGLE_FACT_CHECK_API_KEY;
    if (!apiKey) {
        return { status: "unavailable", summary: "Fact Check Tools API is not configured." };
    }
    const url = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
    url.searchParams.set("query", title.slice(0, 300));
    url.searchParams.set("languageCode", "en");
    url.searchParams.set("pageSize", "10");
    url.searchParams.set("key", apiKey);
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) {
            return { status: "unavailable", summary: "Fact-check lookup was unavailable." };
        }
        const data = await response.json();
        const reviews = (data.claims || []).flatMap(function (claim) {
            const claimText = String(claim.text || "");
            const related = similarity(
                { title: title, description: "" },
                { title: claimText, description: "" }
            );
            if (related.overlap < 2 || related.score < 0.2) {
                return [];
            }
            return (claim.claimReview || []).map(function (review) {
                return {
                    rating: String(review.textualRating || ""),
                    publisher: String((review.publisher && review.publisher.name) || ""),
                    claim: claimText
                };
            });
        });
        const flagged = reviews.filter(function (review) {
            return /\b(false|misleading|pants on fire|mostly false|fake)\b/i.test(review.rating);
        });
        if (flagged.length) {
            return {
                status: "flagged",
                summary: flagged.slice(0, 3).map(function (review) {
                    return review.publisher + ": " + review.rating;
                }).join("; ").slice(0, 1000)
            };
        }
        if (!reviews.length) {
            return { status: "no_matching_check", summary: "No matching published fact-check was returned; this is not proof the story is true." };
        }
        return {
            status: "clear",
            summary: "Fact-check results exist, but none matched the configured false or misleading rating terms. This is not a truth guarantee."
        };
    } catch {
        return { status: "unavailable", summary: "Fact-check lookup failed; the story requires manual review." };
    }
}

function persistArticle(article, topicKey, group, factCheck) {
    const corroboratingSources = Array.from(new Set(group.articles.map(function (item) {
        return item.source.publisher;
    })));
    const status = factCheck.status === "flagged" ? "hidden" : "published";
    db.prepare(`
        INSERT INTO news_sources (id, publisher, independence_group, feed_url, reuse_reviewed, enabled)
        VALUES (?, ?, ?, ?, 1, 1)
        ON CONFLICT(id) DO UPDATE SET
            publisher = excluded.publisher,
            independence_group = excluded.independence_group,
            feed_url = excluded.feed_url,
            reuse_reviewed = 1,
            enabled = 1
    `).run(
        article.source.id,
        article.source.publisher,
        article.source.independenceGroup,
        article.source.feedUrl
    );
    db.prepare(`
        INSERT INTO news_items (
            id, source_id, publisher, canonical_url, title, published_at, topic_key,
            corroborating_publishers, corroboration_count, fact_check_status,
            fact_check_summary, display_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, canonical_url) DO UPDATE SET
            corroborating_publishers = excluded.corroborating_publishers,
            corroboration_count = excluded.corroboration_count,
            fact_check_status = excluded.fact_check_status,
            fact_check_summary = excluded.fact_check_summary,
            display_status = CASE
                WHEN excluded.display_status = 'hidden' THEN 'hidden'
                ELSE news_items.display_status
            END
    `).run(
        crypto.randomUUID(),
        article.source.id,
        article.source.publisher,
        article.url,
        article.title,
        article.publishedAt,
        topicKey,
        JSON.stringify(corroboratingSources),
        corroboratingSources.length,
        factCheck.status,
        factCheck.summary,
        status
    );
}

async function refreshNews() {
    if (refreshRunning || sources.length < 3) {
        return;
    }
    refreshRunning = true;
    try {
        sources.forEach(function (source) {
            db.prepare(`
                INSERT INTO news_sources (id, publisher, independence_group, feed_url, reuse_reviewed, enabled)
                VALUES (?, ?, ?, ?, 1, 1)
                ON CONFLICT(id) DO UPDATE SET
                    publisher = excluded.publisher,
                    independence_group = excluded.independence_group,
                    feed_url = excluded.feed_url,
                    reuse_reviewed = 1,
                    enabled = 1
            `).run(source.id, source.publisher, source.independenceGroup, source.feedUrl);
        });
        const recentAfter = Date.now() - 6 * 60 * 60 * 1000;
        const feeds = await Promise.all(sources.map(async function (source) {
            try {
                const feedUrl = new URL(source.feedUrl);
                const response = await fetch(feedUrl, {
                    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
                    signal: AbortSignal.timeout(12000)
                });
                if (!response.ok) {
                    throw new Error("HTTP " + response.status);
                }
                const xml = await response.text();
                if (xml.length > 2_000_000) {
                    throw new Error("Feed exceeded the 2 MB size limit.");
                }
                const parsed = parseFeed(xml, {
                    id: source.id,
                    publisher: source.publisher,
                    independenceGroup: source.independenceGroup,
                    feedUrl: source.feedUrl,
                    allowedHosts: new Set([feedUrl.hostname])
                });
                db.prepare("UPDATE news_sources SET last_fetched_at = ?, last_error = NULL WHERE id = ?")
                    .run(new Date().toISOString(), source.id);
                return parsed.filter(function (article) {
                    return Date.parse(article.publishedAt) >= recentAfter &&
                        Date.parse(article.publishedAt) <= Date.now() + 5 * 60 * 1000;
                });
            } catch (error) {
                console.error("News feed fetch failed for " + source.id + ": " + error.message);
                db.prepare(`
                    INSERT INTO news_sources (id, publisher, independence_group, feed_url, reuse_reviewed, enabled, last_error)
                    VALUES (?, ?, ?, ?, 1, 1, ?)
                    ON CONFLICT(id) DO UPDATE SET last_error = excluded.last_error
                `).run(source.id, source.publisher, source.independenceGroup, source.feedUrl, error.message.slice(0, 300));
                return [];
            }
        }));
        const articles = feeds.flat();
        const groups = groupArticles(articles).filter(function (group) {
            return hasIndependentCorroboration(group, 3);
        });
        for (const group of groups) {
            const primary = group.articles[0];
            const topicKey = Array.from(termsFor(primary)).sort().slice(0, 8).join("-");
            const factCheck = await checkFactRatings(primary.title);
            group.articles.forEach(function (article) {
                persistArticle(article, topicKey, group, factCheck);
            });
        }
    } catch (error) {
        console.error("News refresh failed: " + error.message);
    } finally {
        refreshRunning = false;
    }
}

function logModeration(postId, moderator, action, notes) {
    db.prepare(`
        INSERT INTO moderation_events (id, post_id, moderator, action, notes)
        VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), postId, moderator, action, notes || "");
}

function verifyAdmin(request) {
    const secret = process.env.COMMUNITY_ADMIN_TOKEN;
    const header = request.headers.authorization || "";
    const match = header.match(/^Bearer (.+)$/);
    if (!secret || !match) {
        return false;
    }
    const expected = Buffer.from(secret);
    const actual = Buffer.from(match[1]);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function moderateText(title, body) {
    const text = title + "\n" + body;
    const linkMatches = text.match(/https?:\/\/|www\./gi) || [];
    if (linkMatches.length > 2) {
        return "Too many external links; post held for review.";
    }
    if (/\b(password|seed phrase|private key)\b.{0,80}\b(send|share|verify|enter)\b/i.test(text)) {
        return "Possible credential-harvesting language; post held for review.";
    }
    if (/\b(?:kill|attack|bomb)\s+(?:them|him|her|people|children)\b/i.test(text)) {
        return "Potential threat language; post held for review.";
    }
    return null;
}

async function handleAuth(request, response, pathname) {
    if (!["POST"].includes(request.method)) {
        response.setHeader("Allow", "POST");
        json(response, 405, { error: "Only POST is supported for this endpoint." });
        return true;
    }
    if (!hasSameOrigin(request)) {
        json(response, 403, { error: "A same-origin request is required." });
        return true;
    }
    if (!rateLimit(request, "auth", 10, 15 * 60 * 1000)) {
        json(response, 429, { error: "Too many account requests. Try again later." });
        return true;
    }

    let body;
    try {
        body = await readBody(request, 12 * 1024);
    } catch (error) {
        json(response, error.status || 400, { error: error.message });
        return true;
    }
    if (!isJsonObject(body)) {
        json(response, 400, { error: "Send a JSON object with account details." });
        return true;
    }

    // server.js initializes schema.sql; these auth routes persist profiles and sessions in that database.
    if (pathname === "/api/community/register") {
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
            displayName.length < 1 || displayName.length > 60 || !isPasswordValid(body.password)) {
            json(response, 400, { error: "Provide a valid email, a display name up to 60 characters, and a password of 12–200 characters." });
            return true;
        }
        const password = await passwordHash(body.password);
        try {
            const creatorId = crypto.randomUUID();
            db.prepare(`
                INSERT INTO creator_profiles (id, email, password_hash, display_name)
                VALUES (?, ?, ?, ?)
            `).run(creatorId, email, password.salt + ":" + password.hash, displayName);
            createSession(response, creatorId);
            json(response, 201, {
                user: { id: creatorId, displayName: displayName, trustScore: 0 },
                message: "Account created. Your first posts will be reviewed before publication."
            });
        } catch (error) {
            if (String(error.message).includes("UNIQUE")) {
                json(response, 409, { error: "An account with that email already exists." });
            } else {
                throw error;
            }
        }
        return true;
    }

    if (pathname === "/api/community/login") {
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const user = db.prepare(`
            SELECT id, email, password_hash, display_name, trust_score
            FROM creator_profiles
            WHERE email = ? AND is_disabled = 0
        `).get(email);
        const passwordOk = isPasswordValid(body.password) &&
            await passwordMatches(body.password, user ? user.password_hash : dummyPasswordHash) &&
            Boolean(user);
        if (!passwordOk) {
            json(response, 401, { error: "Email or password is incorrect." });
            return true;
        }
        createSession(response, user.id);
        json(response, 200, {
            user: { id: user.id, displayName: user.display_name, trustScore: user.trust_score }
        });
        return true;
    }

    deleteSession(request, response);
    json(response, 200, { message: "You have been signed out." });
    return true;
}

function renderPost(row) {
    return {
        id: row.id,
        category: row.category,
        title: row.title,
        body: row.body,
        author: row.display_name,
        createdAt: row.created_at,
        reportCount: row.report_count
    };
}

function publicPosts() {
    return db.prepare(`
        SELECT p.id, p.category, p.title, p.body, p.created_at, p.report_count,
               c.display_name
        FROM creative_posts p
        JOIN creator_profiles c ON c.id = p.creator_id
        WHERE p.moderation_status = 'published' AND p.is_hidden = 0 AND c.is_disabled = 0
        ORDER BY p.created_at DESC
        LIMIT 50
    `).all().map(renderPost);
}

async function handleCommunity(request, response, url) {
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/community/")) {
        return false;
    }

    if (pathname === "/api/community/news") {
        if (request.method !== "GET") {
            response.setHeader("Allow", "GET");
            json(response, 405, { error: "Only GET is supported." });
            return true;
        }
        const items = db.prepare(`
            SELECT n.title, n.canonical_url, n.published_at, n.publisher, n.corroborating_publishers,
                   n.corroboration_count, n.fact_check_status, n.fact_check_summary
            FROM news_items n
            JOIN news_sources s ON s.id = n.source_id
            WHERE n.display_status = 'published' AND n.corroboration_count >= 3
                AND n.fact_check_status != 'flagged'
                AND s.enabled = 1 AND s.reuse_reviewed = 1
                AND n.published_at >= datetime('now', '-6 hours')
            ORDER BY n.published_at DESC
            LIMIT 30
        `).all().map(safeNewsItem);
        json(response, 200, {
            items: items,
            sourcesConfigured: sources.length,
            minimumIndependentSources: 3,
            disclaimer: "Cross-source corroboration is not proof that a claim is true. Read the original reporting and independent fact checks."
        });
        return true;
    }

    if (pathname === "/api/community/posts" && request.method === "GET") {
        json(response, 200, { posts: publicPosts() });
        return true;
    }

    if (pathname === "/api/community/me") {
        if (request.method !== "GET") {
            response.setHeader("Allow", "GET");
            json(response, 405, { error: "Only GET is supported." });
            return true;
        }
        const user = getCurrentUser(request);
        json(response, 200, {
            user: user
                ? { id: user.id, email: user.email, displayName: user.display_name, trustScore: user.trust_score }
                : null
        });
        return true;
    }

    if (pathname === "/api/community/register" || pathname === "/api/community/login" ||
        pathname === "/api/community/logout") {
        return handleAuth(request, response, pathname);
    }

    if (pathname === "/api/community/posts") {
        if (request.method !== "POST") {
            response.setHeader("Allow", "GET, POST");
            json(response, 405, { error: "Unsupported request method." });
            return true;
        }
        if (!hasSameOrigin(request)) {
            json(response, 403, { error: "A same-origin request is required." });
            return true;
        }
        const user = getCurrentUser(request);
        if (!user) {
            json(response, 401, { error: "Sign in before submitting a creative post." });
            return true;
        }
        if (!rateLimit(request, "post", 5, 60 * 60 * 1000)) {
            json(response, 429, { error: "Post submission limit reached. Try again later." });
            return true;
        }

        let body;
        try {
            body = await readBody(request, 16 * 1024);
        } catch (error) {
            json(response, error.status || 400, { error: error.message });
            return true;
        }
        if (!isJsonObject(body)) {
            json(response, 400, { error: "Send a JSON object containing the creative post fields." });
            return true;
        }
        const category = body.category;
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const content = typeof body.body === "string" ? body.body.trim() : "";
        if (!categories.has(category) || title.length < 1 || title.length > 160 ||
            content.length < 1 || content.length > 10000 || body.copyrightCertified !== true) {
            json(response, 400, { error: "Choose a creative category, provide a title and post under the character limits, and certify you have the right to share it." });
            return true;
        }

        const moderationReason = moderateText(title, content);
        const status = !moderationReason && user.trust_score >= trustedCreatorScore
            ? "published"
            : "pending";
        const postId = crypto.randomUUID();
        db.prepare(`
            INSERT INTO creative_posts (
                id, creator_id, category, title, body, copyright_certified, moderation_status
            ) VALUES (?, ?, ?, ?, ?, 1, ?)
        `).run(postId, user.id, category, title, content, status);
        json(response, 201, {
            id: postId,
            status: status,
            message: moderationReason || (status === "published"
                ? "Your post has been published. It can still be reported and reviewed."
                : "Your post is awaiting moderator review.")
        });
        return true;
    }

    const reportMatch = pathname.match(/^\/api\/community\/posts\/([a-f0-9-]{36})\/report$/);
    if (reportMatch) {
        if (request.method !== "POST") {
            response.setHeader("Allow", "POST");
            json(response, 405, { error: "Only POST is supported." });
            return true;
        }
        if (!hasSameOrigin(request)) {
            json(response, 403, { error: "A same-origin request is required." });
            return true;
        }
        const user = getCurrentUser(request);
        if (!user) {
            json(response, 401, { error: "Sign in to report a post." });
            return true;
        }
        if (!rateLimit(request, "report", 20, 60 * 60 * 1000)) {
            json(response, 429, { error: "Report limit reached. Try again later." });
            return true;
        }
        let body;
        try {
            body = await readBody(request, 4 * 1024);
        } catch (error) {
            json(response, error.status || 400, { error: error.message });
            return true;
        }
        if (!isJsonObject(body)) {
            json(response, 400, { error: "Send a JSON object containing the report reason." });
            return true;
        }
        const reason = body.reason;
        const details = typeof body.details === "string" ? body.details.trim() : "";
        const post = db.prepare("SELECT id, creator_id, is_hidden FROM creative_posts WHERE id = ?")
            .get(reportMatch[1]);
        if (!post || post.is_hidden) {
            json(response, 404, { error: "That post is not available to report." });
            return true;
        }
        if (post.creator_id === user.id) {
            json(response, 400, { error: "You cannot report your own post." });
            return true;
        }
        if (!reasons.has(reason) || details.length > 1000) {
            json(response, 400, { error: "Choose a report reason and keep details under 1,000 characters." });
            return true;
        }
        try {
            db.prepare(`
                INSERT INTO post_reports (post_id, reporter_id, reason, details)
                VALUES (?, ?, ?, ?)
            `).run(post.id, user.id, reason, details);
        } catch (error) {
            if (String(error.message).includes("UNIQUE")) {
                json(response, 409, { error: "You have already reported this post." });
                return true;
            }
            throw error;
        }

        const reportCount = db.prepare("SELECT count(*) AS count FROM post_reports WHERE post_id = ?")
            .get(post.id).count;
        db.prepare("UPDATE creative_posts SET report_count = ? WHERE id = ?")
            .run(reportCount, post.id);
        if (reportCount >= reportHideThreshold) {
            db.prepare(`
                UPDATE creative_posts
                SET is_hidden = 1, moderation_status = 'hidden'
                WHERE id = ?
            `).run(post.id);
            logModeration(post.id, "automated-report-threshold", "hidden", reportCount + " unique reports");
        }
        json(response, 201, {
            reportCount: reportCount,
            hidden: reportCount >= reportHideThreshold,
            message: reportCount >= reportHideThreshold
                ? "The post has been hidden pending moderator review."
                : "Thank you. Your report has been recorded."
        });
        return true;
    }

    if (pathname === "/api/community/admin/pending") {
        if (request.method !== "GET") {
            response.setHeader("Allow", "GET");
            json(response, 405, { error: "Only GET is supported." });
            return true;
        }
        if (!verifyAdmin(request)) {
            json(response, 401, { error: "Administrator authentication is required." });
            return true;
        }
        const posts = db.prepare(`
            SELECT p.id, p.category, p.title, p.body, p.moderation_status, p.is_hidden,
                   p.report_count, p.copyright_certified, p.created_at,
                   c.display_name, c.email, c.trust_score,
                   (SELECT count(*) FROM post_reports r WHERE r.post_id = p.id) AS reports,
                   (SELECT json_group_array(json_object('reason', r.reason, 'details', r.details))
                    FROM post_reports r WHERE r.post_id = p.id) AS report_details
            FROM creative_posts p
            JOIN creator_profiles c ON c.id = p.creator_id
            WHERE p.moderation_status IN ('pending', 'hidden')
            ORDER BY p.created_at ASC
            LIMIT 100
        `).all();
        json(response, 200, { posts: posts });
        return true;
    }

    const moderationMatch = pathname.match(/^\/api\/community\/admin\/posts\/([a-f0-9-]{36})$/);
    if (moderationMatch) {
        if (request.method !== "POST") {
            response.setHeader("Allow", "POST");
            json(response, 405, { error: "Only POST is supported." });
            return true;
        }
        if (!verifyAdmin(request)) {
            json(response, 401, { error: "Administrator authentication is required." });
            return true;
        }
        if (!hasSameOrigin(request)) {
            json(response, 403, { error: "A same-origin request is required." });
            return true;
        }
        let body;
        try {
            body = await readBody(request, 4 * 1024);
        } catch (error) {
            json(response, error.status || 400, { error: error.message });
            return true;
        }
        if (!isJsonObject(body) || !["approve", "reject", "restore", "hide"].includes(body.action)) {
            json(response, 400, { error: "Choose approve, reject, restore, or hide." });
            return true;
        }
        const post = db.prepare("SELECT id, creator_id, moderation_status FROM creative_posts WHERE id = ?")
            .get(moderationMatch[1]);
        if (!post) {
            json(response, 404, { error: "Post not found." });
            return true;
        }
        const actionState = {
            approve: { status: "published", hidden: 0, event: "approved" },
            reject: { status: "rejected", hidden: 0, event: "rejected" },
            restore: { status: "published", hidden: 0, event: "restored" },
            hide: { status: "hidden", hidden: 1, event: "hidden" }
        }[body.action];
        db.exec("BEGIN IMMEDIATE");
        try {
            db.prepare(`
                UPDATE creative_posts
                SET moderation_status = ?, is_hidden = ?, reviewed_at = ?
                WHERE id = ?
            `).run(actionState.status, actionState.hidden, new Date().toISOString(), post.id);
            if (body.action === "approve" && post.moderation_status === "pending") {
                db.prepare("UPDATE creator_profiles SET trust_score = min(100, trust_score + 5) WHERE id = ?")
                    .run(post.creator_id);
            }
            logModeration(post.id, "administrator", actionState.event, "");
            db.exec("COMMIT");
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
        json(response, 200, { status: actionState.status, message: "Moderation action recorded." });
        return true;
    }

    json(response, 404, { error: "Community endpoint not found." });
    return true;
}

module.exports = {
    handleCommunity: handleCommunity,
    refreshNews: refreshNews,
    testTools: {
        parseFeed: parseFeed,
        groupArticles: groupArticles,
        hasIndependentCorroboration: hasIndependentCorroboration
    },
    startNewsScheduler: function () {
        if (sources.length < 3) {
            console.log("News aggregation is inactive: enable at least three sources after reviewing their feed reuse terms.");
            return;
        }
        setTimeout(function () {
            refreshNews();
            setInterval(refreshNews, 15 * 60 * 1000);
        }, 1000);
    },
    close: function () { db.close(); }
};
