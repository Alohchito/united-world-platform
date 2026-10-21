"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const community = require("./community");

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.YOUTUBE_API_KEY;
const translationApiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
const adminToken = process.env.ENGINEERING_VIDEO_ADMIN_TOKEN;
const allowedChannelIds = new Set(
    (process.env.YOUTUBE_EDUCATIONAL_CHANNEL_IDS || "")
        .split(",")
        .map(function (id) { return id.trim(); })
        .filter(Boolean)
);

const fields = {
    general: {
        name: "Engineering",
        keywords: []
    },
    mechanical: {
        name: "Mechanical Engineering",
        keywords: [
            "mechanical engineering", "machines", "mechanisms", "engines",
            "thermodynamics", "manufacturing", "mechanical systems"
        ]
    },
    "electrical-electronic": {
        name: "Electrical & Electronic Engineering",
        keywords: [
            "electrical engineering", "electronic engineering", "generation",
            "transmission", "electricity", "power grids", "renewable energy",
            "solar farms", "microelectronics", "microscopic circuits",
            "processors", "semiconductors"
        ]
    },
    chemical: {
        name: "Chemical Engineering",
        keywords: [
            "chemical engineering", "chemistry", "biology", "raw materials",
            "pharmaceuticals", "plastics", "food manufacturing",
            "petroleum processing", "clean energy", "carbon capture"
        ]
    },
    "civil-structural": {
        name: "Civil & Structural Engineering",
        keywords: [
            "civil engineering", "structural engineering", "infrastructure",
            "roads", "bridges", "tunnels", "dams", "skyscrapers",
            "structural integrity", "load-bearing", "natural disaster engineering"
        ]
    },
    "computer-software": {
        name: "Computer & Software Engineering",
        keywords: [
            "computer engineering", "software engineering", "hardware", "software",
            "microprocessors", "memory chips", "smart appliances", "coding",
            "apps", "operating systems", "algorithms", "web platforms"
        ]
    },
    biomedical: {
        name: "Biomedical Engineering",
        keywords: [
            "biomedical engineering", "healthcare technology", "medical devices",
            "artificial hearts", "prosthetic limbs", "diagnostic machinery",
            "mri scanners"
        ]
    },
    environmental: {
        name: "Environmental Engineering",
        keywords: [
            "environmental engineering", "planet protection", "human health",
            "drinking water systems", "industrial waste treatment",
            "air pollution controls", "sustainable resource management"
        ]
    },
    industrial: {
        name: "Industrial Engineering",
        keywords: [
            "industrial engineering", "efficiency", "optimization",
            "systems automation", "logistics", "factory streamlining",
            "airport logistics", "hospital workflows", "supply chains"
        ]
    },
    mechatronics: {
        name: "Mechatronics",
        keywords: [
            "mechatronics", "robotics", "autonomous vehicles", "automation",
            "electro-mechanical systems"
        ]
    }
};

const staticFiles = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/style.css": ["style.css", "text/css; charset=utf-8"],
    "/script.js": ["script.js", "text/javascript; charset=utf-8"],
    "/community-experience.js": ["community-experience.js", "text/javascript; charset=utf-8"],
    "/aetherium.html": ["aetherium.html", "text/html; charset=utf-8"],
    "/chat-software.html": ["chat-software.html", "text/html; charset=utf-8"],
    "/christ-mindset.html": ["christ-mindset.html", "text/html; charset=utf-8"],
    "/sow-natural.html": ["sow-natural.html", "text/html; charset=utf-8"],
    "/enoch-hall.html": ["enoch-hall.html", "text/html; charset=utf-8"]
};

const cache = new Map();
const cacheTtlMs = 5 * 60 * 1000;
const maxCacheEntries = 100;
let rateWindowStart = Date.now();
let requestsThisWindow = 0;
const maxSearchesPerMinute = 10;
let quotaDay = new Date().toISOString().slice(0, 10);
let searchCallsToday = 0;
const translationLanguageCache = { expiresAt: 0, languages: null };
let translationRateWindowStart = Date.now();
let translationRequestsThisWindow = 0;
const maxTranslationRequestsPerMinute = 30;

function setSecurityHeaders(response) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    );
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
}

async function readJsonBody(request, maxBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBytes) {
            const error = new Error("The request body is too large.");
            error.statusCode = 413;
            throw error;
        }
        chunks.push(chunk);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        const error = new Error("Send a valid JSON request body.");
        error.statusCode = 400;
        throw error;
    }
}

async function callGoogleTranslationApi(method, parameters, body) {
    const url = new URL("https://translation.googleapis.com/language/translate/v2");
    url.searchParams.set("key", translationApiKey);
    Object.entries(parameters || {}).forEach(function (entry) {
        url.searchParams.set(entry[0], entry[1]);
    });

    const options = {
        method: method,
        signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json" }
    };
    if (body) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
        console.error("Google Cloud Translation returned HTTP " + response.status + ".");
        const error = new Error("Google Cloud Translation could not complete the request.");
        error.statusCode = response.status === 429 ? 429 : 502;
        throw error;
    }
    return response.json();
}

function setTranslationRateLimit(response) {
    if (Date.now() - translationRateWindowStart >= 60_000) {
        translationRateWindowStart = Date.now();
        translationRequestsThisWindow = 0;
    }
    translationRequestsThisWindow += 1;
    if (translationRequestsThisWindow > maxTranslationRequestsPerMinute) {
        sendJson(response, 429, { error: "Translation request limit reached. Please wait a minute and try again." });
        return false;
    }
    return true;
}

function classifyField(query) {
    const normalizedQuery = query.toLowerCase();
    let bestField = null;
    let bestScore = 0;

    Object.entries(fields).forEach(function (entry) {
        const score = entry[1].keywords.reduce(function (total, keyword) {
            return total + (normalizedQuery.includes(keyword) ? keyword.length : 0);
        }, 0);
        if (score > bestScore) {
            bestField = entry[0];
            bestScore = score;
        }
    });

    return bestField || "general";
}

function extractYouTubeVideoId(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }

    const allowedHosts = new Set([
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
        "www.youtube-nocookie.com",
        "youtube-nocookie.com"
    ]);
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !allowedHosts.has(url.hostname)
    ) {
        return null;
    }

    let videoId = "";
    if (url.hostname === "youtu.be") {
        videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    } else if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v") || "";
    } else {
        const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/);
        videoId = match ? match[1] : "";
    }

    return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
}

function hasValidAdminToken(request) {
    if (!adminToken) {
        return false;
    }
    const authorization = request.headers.authorization || "";
    const match = authorization.match(/^Bearer (.+)$/);
    if (!match) {
        return false;
    }

    const expected = Buffer.from(adminToken);
    const provided = Buffer.from(match[1]);
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function cleanVideo(item) {
    const id = item.id && typeof item.id === "object" ? item.id.videoId : item.id;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
        return null;
    }
    if (!item.snippet || !item.snippet.title || !item.snippet.channelTitle) {
        return null;
    }

    return {
        id: id,
        title: item.snippet.title,
        description: item.snippet.description || "",
        channelTitle: item.snippet.channelTitle
    };
}

async function fetchYouTube(endpoint, params) {
    const url = new URL("https://www.googleapis.com/youtube/v3/" + endpoint);
    Object.entries(params).forEach(function (entry) {
        url.searchParams.set(entry[0], entry[1]);
    });
    url.searchParams.set("key", apiKey);

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
        console.error("YouTube Data API returned HTTP " + response.status + ".");
        throw new Error("YouTube search could not be completed. Please try again later.");
    }
    return response.json();
}

async function getVideoByUrl(videoUrl) {
    const videoId = extractYouTubeVideoId(videoUrl);
    if (!videoId) {
        return { error: "Enter a valid HTTPS YouTube video URL." };
    }

    const data = await fetchYouTube("videos", {
        part: "snippet,status",
        id: videoId
    });
    const item = Array.isArray(data.items) ? data.items[0] : null;
    if (!item || !item.status || item.status.embeddable !== true) {
        return { error: "That video was not found or is not available for embedding." };
    }

    const video = cleanVideo(item);
    return video
        ? { category: "Curated YouTube video", videos: [video] }
        : { error: "YouTube did not return usable video metadata." };
}

async function searchVideos(query, category) {
    const selectedField = category === "auto" ? classifyField(query) : category;
    const field = fields[selectedField];
    const cacheKey = JSON.stringify([query.toLowerCase(), selectedField, Array.from(allowedChannelIds).sort()]);
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.payload;
    }

    const today = new Date().toISOString().slice(0, 10);
    if (today !== quotaDay) {
        quotaDay = today;
        searchCallsToday = 0;
    }
    if (searchCallsToday >= 80) {
        const error = new Error("The site's daily video-search allowance has been reached. Please try again tomorrow.");
        error.statusCode = 429;
        throw error;
    }

    const params = {
        part: "snippet",
        q: query + " " + field.name,
        type: "video",
        videoEmbeddable: "true",
        safeSearch: "moderate",
        order: "relevance",
        maxResults: "25"
    };
    searchCallsToday += 1;
    const data = await fetchYouTube("search", params);
    const items = Array.isArray(data.items) ? data.items : [];
    const videos = items
        .filter(function (item) {
            return !allowedChannelIds.size || allowedChannelIds.has(item.snippet.channelId);
        })
        .map(cleanVideo)
        .filter(Boolean)
        .slice(0, 9);
    const payload = { category: field.name, videos: videos };

    if (cache.size >= maxCacheEntries) {
        cache.delete(cache.keys().next().value);
    }
    cache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, payload: payload });
    return payload;
}

function serveStatic(response, fileName, contentType) {
    const filePath = path.join(root, fileName);
    fs.readFile(filePath, function (error, content) {
        if (error) {
            console.error("Unable to read a static site file.");
            response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            response.end("The website could not be loaded.");
            return;
        }
        response.writeHead(200, { "Content-Type": contentType });
        response.end(content);
    });
}

const server = http.createServer(async function (request, response) {
    setSecurityHeaders(response);

    const requestUrl = new URL(request.url, "http://localhost");

    try {
        if (await community.handleCommunity(request, response, requestUrl)) {
            return;
        }
    } catch (error) {
        console.error("Community request failed: " + error.message);
        if (!response.headersSent) {
            sendJson(response, 500, { error: "The community service could not complete the request." });
        } else {
            response.destroy();
        }
        return;
    }

    if (requestUrl.pathname === "/api/translation-languages") {
        if (request.method !== "GET") {
            response.setHeader("Allow", "GET");
            sendJson(response, 405, { error: "Only GET requests are supported." });
            return;
        }
        if (!translationApiKey) {
            sendJson(response, 503, {
                error: "Page translation is not configured. Add a server-side GOOGLE_TRANSLATE_API_KEY to enable it."
            });
            return;
        }
        if (
            translationLanguageCache.languages &&
            translationLanguageCache.expiresAt > Date.now()
        ) {
            sendJson(response, 200, { languages: translationLanguageCache.languages });
            return;
        }

        try {
            const data = await callGoogleTranslationApi("GET", { target: "en" });
            const rawLanguages = data && data.data && data.data.languages;
            if (!Array.isArray(rawLanguages)) {
                throw new Error("The translation provider returned an invalid language list.");
            }
            const languages = rawLanguages
                .filter(function (language) {
                    return language &&
                        typeof language.language === "string" &&
                        typeof language.name === "string";
                })
                .map(function (language) {
                    return { code: language.language, name: language.name };
                });
            if (!languages.length) {
                throw new Error("The translation provider returned no supported languages.");
            }

            translationLanguageCache.languages = languages;
            translationLanguageCache.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
            sendJson(response, 200, { languages: languages });
        } catch (error) {
            console.error("Supported translation languages could not be loaded.");
            sendJson(response, error.statusCode || 502, {
                error: "Available languages could not be loaded. Verify the translation API configuration and try again."
            });
        }
        return;
    }

    if (requestUrl.pathname === "/api/translate") {
        if (request.method !== "POST") {
            response.setHeader("Allow", "POST");
            sendJson(response, 405, { error: "Only POST requests are supported." });
            return;
        }
        if (!translationApiKey) {
            sendJson(response, 503, {
                error: "Page translation is not configured. Add a server-side GOOGLE_TRANSLATE_API_KEY to enable it."
            });
            return;
        }
        if (!request.headers["content-type"] ||
            !request.headers["content-type"].toLowerCase().startsWith("application/json")) {
            sendJson(response, 415, { error: "Send translation requests as application/json." });
            return;
        }

        let payload;
        try {
            payload = await readJsonBody(request, 48 * 1024);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { error: error.message });
            return;
        }

        const target = payload && payload.target;
        const texts = payload && payload.texts;
        if (
            typeof target !== "string" ||
            !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(target)
        ) {
            sendJson(response, 400, { error: "Choose a supported target language." });
            return;
        }
        if (
            !Array.isArray(texts) ||
            texts.length < 1 ||
            texts.length > 80 ||
            texts.some(function (text) {
                return typeof text !== "string" || text.length > 5000;
            }) ||
            texts.reduce(function (total, text) { return total + text.length; }, 0) > 10000
        ) {
            sendJson(response, 400, { error: "Translate between 1 and 80 text items, with no item over 5,000 characters or batch over 10,000 characters." });
            return;
        }
        if (!setTranslationRateLimit(response)) {
            return;
        }

        try {
            const data = await callGoogleTranslationApi("POST", {}, {
                q: texts,
                target: target,
                format: "text"
            });
            const translations = data && data.data && data.data.translations;
            if (
                !Array.isArray(translations) ||
                translations.length !== texts.length ||
                translations.some(function (item) {
                    return !item || typeof item.translatedText !== "string";
                })
            ) {
                throw new Error("The translation provider returned an incomplete translation.");
            }

            sendJson(response, 200, {
                translations: translations.map(function (item) {
                    return item.translatedText;
                })
            });
        } catch (error) {
            console.error("Page translation request failed.");
            sendJson(response, error.statusCode || 502, {
                error: "Translation could not be completed. Check the selected language and provider configuration, then try again."
            });
        }
        return;
    }

    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        sendJson(response, 405, { error: "Only GET requests are supported." });
        return;
    }

    if (requestUrl.pathname === "/api/get-engineering-videos") {
        if (!apiKey) {
            sendJson(response, 503, {
                error: "YouTube search is not configured. Add a server-side YOUTUBE_API_KEY to enable live results."
            });
            return;
        }

        const videoUrl = requestUrl.searchParams.get("videoUrl");
        const query = (requestUrl.searchParams.get("query") || "").trim();
        const requestedCategory = requestUrl.searchParams.get("category") || "auto";
        if (videoUrl && !extractYouTubeVideoId(videoUrl)) {
            sendJson(response, 400, { error: "Enter a valid HTTPS YouTube video URL." });
            return;
        }
        if (!videoUrl && (!query || query.length > 240)) {
            sendJson(response, 400, { error: "Enter a search query of 1 to 240 characters." });
            return;
        }
        if (!videoUrl && requestedCategory !== "auto" && !Object.hasOwn(fields, requestedCategory)) {
            sendJson(response, 400, { error: "Choose a recognized engineering field." });
            return;
        }
        if (videoUrl && !hasValidAdminToken(request)) {
            sendJson(response, adminToken ? 401 : 503, {
                error: adminToken
                    ? "A valid administrator token is required for curated video lookup."
                    : "Curated video lookup is not configured."
            });
            return;
        }

        if (Date.now() - rateWindowStart >= 60_000) {
            rateWindowStart = Date.now();
            requestsThisWindow = 0;
        }
        requestsThisWindow += 1;
        if (requestsThisWindow > maxSearchesPerMinute) {
            sendJson(response, 429, { error: "Search limit reached. Please wait a minute and try again." });
            return;
        }

        if (videoUrl) {
            try {
                const payload = await getVideoByUrl(videoUrl);
                sendJson(response, payload.error ? 400 : 200, payload);
            } catch (error) {
                console.error("YouTube metadata lookup failed.");
                sendJson(response, 502, { error: error.message });
            }
            return;
        }

        try {
            const payload = await searchVideos(query, requestedCategory);
            sendJson(response, 200, payload);
        } catch (error) {
            console.error("Engineering video search failed.");
            sendJson(response, error.statusCode || 502, { error: error.message });
        }
        return;
    }

    const staticFile = staticFiles[requestUrl.pathname];
    if (!staticFile) {
        sendJson(response, 404, { error: "Not found." });
        return;
    }
    serveStatic(response, staticFile[0], staticFile[1]);
});

server.listen(port, function () {
    console.log("United World is available at http://localhost:" + port);
    community.startNewsScheduler();
});

server.on("error", function () {
    console.error("The United World server could not start. Check whether the port is available.");
    process.exitCode = 1;
});

process.on("SIGINT", function () {
    server.close(function () {
        community.close();
        process.exit(0);
    });
});
