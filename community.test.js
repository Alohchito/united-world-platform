"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const previousDatabasePath = process.env.UKOS_DB_PATH;
const testDatabasePath = path.join(os.tmpdir(), "united-world-test-" + crypto.randomUUID() + ".sqlite");
process.env.UKOS_DB_PATH = testDatabasePath;
const { testTools, close } = require("./community");
if (previousDatabasePath === undefined) {
    delete process.env.UKOS_DB_PATH;
} else {
    process.env.UKOS_DB_PATH = previousDatabasePath;
}

test.after(function () {
    close();
    [testDatabasePath, testDatabasePath + "-wal", testDatabasePath + "-shm"].forEach(function (file) {
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
        }
    });
});

function article(publisher, independenceGroup, title) {
    return {
        title: title,
        description: "",
        source: {
            publisher: publisher,
            independenceGroup: independenceGroup
        }
    };
}

test("RSS parser extracts attributed headline, secure source link, and original timestamp", function () {
    const publishedAt = new Date().toUTCString();
    const xml = [
        "<rss><channel><item>",
        "<title><![CDATA[Coastal city opens a new flood barrier]]></title>",
        "<link>https://publisher.example/news/123</link>",
        "<pubDate>" + publishedAt + "</pubDate>",
        "<description>Engineers completed the flood barrier after storm damage.</description>",
        "</item></channel></rss>"
    ].join("");
    const parsed = testTools.parseFeed(xml, {
        id: "example",
        publisher: "Example News",
        independenceGroup: "example-group",
        feedUrl: "https://publisher.example/feed.xml",
        allowedHosts: new Set(["publisher.example"])
    });

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].title, "Coastal city opens a new flood barrier");
    assert.equal(parsed[0].url, "https://publisher.example/news/123");
    assert.equal(parsed[0].publishedAt, new Date(publishedAt).toISOString());
});

test("RSS parser rejects non-HTTPS and off-publisher links", function () {
    const xml = [
        "<rss><channel>",
        "<item><title>First story</title><link>http://publisher.example/story</link>",
        "<pubDate>" + new Date().toUTCString() + "</pubDate></item>",
        "<item><title>Second story</title><link>https://other.example/story</link>",
        "<pubDate>" + new Date().toUTCString() + "</pubDate></item>",
        "</channel></rss>"
    ].join("");
    const parsed = testTools.parseFeed(xml, {
        id: "example",
        publisher: "Example News",
        independenceGroup: "example-group",
        feedUrl: "https://publisher.example/feed.xml",
        allowedHosts: new Set(["publisher.example"])
    });
    assert.equal(parsed.length, 0);
});

test("story matching requires three distinct publisher groups", function () {
    const titleA = "Coastal city opens new flood barrier after storm damage";
    const titleB = "City opens flood barrier after storm damage following coastal storm";
    const group = testTools.groupArticles([
        article("Publisher One", "one", titleA),
        article("Publisher One", "one", titleB),
        article("Publisher Two", "two", titleB),
        article("Publisher Three", "three", titleA)
    ]);
    const corroborated = group.find(function (item) {
        return item.articles.length >= 3;
    });

    assert.ok(corroborated, "related reports should cluster");
    assert.equal(testTools.hasIndependentCorroboration(corroborated, 3), true);
    assert.equal(testTools.hasIndependentCorroboration(corroborated, 4), false);
});

test("unrelated stories remain separate and are not corroborated", function () {
    const groups = testTools.groupArticles([
        article("Publisher One", "one", "Coastal city opens new flood barrier after storm damage"),
        article("Publisher Two", "two", "Researchers discover new treatment for tropical disease"),
        article("Publisher Three", "three", "National election results announced after vote")
    ]);

    assert.equal(groups.length, 3);
    groups.forEach(function (group) {
        assert.equal(testTools.hasIndependentCorroboration(group, 3), false);
    });
});
