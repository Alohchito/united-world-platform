"use strict";

document.addEventListener("DOMContentLoaded", function () {
    const year = document.getElementById("current-year");
    if (year) {
        year.textContent = String(new Date().getFullYear());
    }

    const languageSelect = document.getElementById("site-language");
    const translateButton = document.getElementById("translate-page");
    const restoreLanguageButton = document.getElementById("restore-page-language");
    const translationStatus = document.getElementById("translation-status");
    const languageToolbar = document.querySelector(".language-toolbar");
    let translationSource = null;
    let translationInProgress = false;
    let pageTranslated = false;
    const rightToLeftLanguages = new Set([
        "ar", "arc", "ckb", "dv", "fa", "he", "iw", "ku", "nqo",
        "ps", "sd", "ug", "ur", "yi"
    ]);

    function collectTranslatableContent() {
        const excludedSelector = [
            ".language-toolbar",
            ".theme-detail",
            ".problem-result",
            ".reflection-result",
            ".video-gallery",
            ".career-search-status",
            ".translation-status",
            "script",
            "style",
            "noscript",
            "iframe"
        ].join(",");
        const entries = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;

        while ((node = walker.nextNode())) {
            if (!node.nodeValue.trim()) {
                continue;
            }
            const parent = node.parentElement;
            if (!parent || parent.closest(excludedSelector)) {
                continue;
            }
            entries.push({ type: "text", node: node, value: node.nodeValue });
        }

        document.body.querySelectorAll("[placeholder], [title], [aria-label], [alt]").forEach(function (element) {
            if (element.closest(excludedSelector)) {
                return;
            }
            ["placeholder", "title", "aria-label", "alt"].forEach(function (attribute) {
                const value = element.getAttribute(attribute);
                if (value && value.trim()) {
                    entries.push({
                        type: "attribute",
                        element: element,
                        attribute: attribute,
                        value: value
                    });
                }
            });
        });

        const description = document.querySelector('meta[name="description"]');
        entries.push({ type: "document-title", value: document.title });
        if (description) {
            entries.push({
                type: "attribute",
                element: description,
                attribute: "content",
                value: description.getAttribute("content") || ""
            });
        }
        return entries;
    }

    function applyTranslatedValue(entry, translatedValue) {
        if (entry.type === "text") {
            const leadingWhitespace = (entry.value.match(/^\s*/) || [""])[0];
            const trailingWhitespace = (entry.value.match(/\s*$/) || [""])[0];
            const contentEnd = entry.value.length - trailingWhitespace.length;
            const translated = leadingWhitespace && contentEnd === leadingWhitespace.length
                ? translatedValue
                : leadingWhitespace + translatedValue + trailingWhitespace;
            entry.node.nodeValue = translated;
        } else if (entry.type === "document-title") {
            document.title = translatedValue;
        } else {
            entry.element.setAttribute(entry.attribute, translatedValue);
        }
    }

    function restoreOriginalLanguage() {
        if (translationSource) {
            translationSource.entries.forEach(function (entry) {
                applyTranslatedValue(entry, entry.value);
            });
            document.documentElement.lang = translationSource.originalLanguage;
            document.documentElement.dir = translationSource.originalDirection;
            translationSource = null;
        }
        pageTranslated = false;
        if (languageSelect) {
            languageSelect.value = "en";
        }
        if (translationStatus) {
            translationStatus.textContent = "Showing the original English text.";
        }
        if (restoreLanguageButton) {
            restoreLanguageButton.disabled = true;
        }
    }

    async function loadTranslationLanguages() {
        if (!languageSelect || !translateButton || !translationStatus) {
            return;
        }
        try {
            const response = await fetch("/api/translation-languages", {
                headers: { Accept: "application/json" }
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || "Available languages could not be loaded.");
            }
            if (!Array.isArray(payload.languages) || payload.languages.length === 0) {
                throw new Error("The translation provider returned no supported languages.");
            }

            const fragment = document.createDocumentFragment();
            const englishOption = document.createElement("option");
            englishOption.value = "en";
            englishOption.textContent = "English (original)";
            fragment.appendChild(englishOption);

            payload.languages
                .filter(function (language) {
                    return language && typeof language.code === "string" &&
                        typeof language.name === "string" && language.code !== "en";
                })
                .sort(function (first, second) {
                    return first.name.localeCompare(second.name);
                })
                .forEach(function (language) {
                    const option = document.createElement("option");
                    option.value = language.code;
                    option.textContent = language.name;
                    fragment.appendChild(option);
                });

            languageSelect.replaceChildren(fragment);
            languageSelect.disabled = false;
            translateButton.disabled = false;
            translationStatus.textContent = payload.languages.length + " languages are available from the translation provider. Search the list by typing a language name.";
        } catch (error) {
            translationStatus.textContent = error.message;
        }
    }

    async function requestTranslations(targetLanguage, texts) {
        const response = await fetch("/api/translate", {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ target: targetLanguage, texts: texts })
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || "Translation failed.");
        }
        if (!Array.isArray(payload.translations) || payload.translations.length !== texts.length) {
            throw new Error("The translation service returned an incomplete result.");
        }
        return payload.translations;
    }

    if (languageToolbar && languageSelect && translateButton && restoreLanguageButton && translationStatus) {
        loadTranslationLanguages();

        languageSelect.addEventListener("change", function () {
            if (languageSelect.value === "en" && translationSource && !translationInProgress) {
                restoreOriginalLanguage();
            }
        });

        translateButton.addEventListener("click", async function () {
            const targetLanguage = languageSelect.value;
            if (!targetLanguage || targetLanguage === "en" || translationInProgress) {
                return;
            }

            if (!translationSource) {
                translationSource = {
                    entries: collectTranslatableContent(),
                    originalLanguage: document.documentElement.lang || "en",
                    originalDirection: document.documentElement.getAttribute("dir") || "ltr"
                };
            } else if (pageTranslated) {
                translationSource.entries.forEach(function (entry) {
                    applyTranslatedValue(entry, entry.value);
                });
                document.documentElement.lang = translationSource.originalLanguage;
                document.documentElement.dir = translationSource.originalDirection;
                pageTranslated = false;
            }

            translationInProgress = true;
            translateButton.disabled = true;
            languageSelect.disabled = true;
            restoreLanguageButton.disabled = true;
            const entries = translationSource.entries;

            try {
                const chunks = [];
                let currentChunk = [];
                let currentLength = 0;
                entries.forEach(function (entry, index) {
                    if (currentChunk.length >= 80 || currentLength + entry.value.length > 8000) {
                        chunks.push(currentChunk);
                        currentChunk = [];
                        currentLength = 0;
                    }
                    currentChunk.push({ entry: entry, index: index });
                    currentLength += entry.value.length;
                });
                if (currentChunk.length) {
                    chunks.push(currentChunk);
                }

                let completed = 0;
                for (const chunk of chunks) {
                    translationStatus.textContent = "Translating page text… " + completed + " of " + entries.length + ".";
                    const translatedValues = await requestTranslations(
                        targetLanguage,
                        chunk.map(function (item) { return item.entry.value; })
                    );
                    chunk.forEach(function (item, index) {
                        applyTranslatedValue(item.entry, translatedValues[index]);
                    });
                    completed += chunk.length;
                }

                document.documentElement.lang = targetLanguage;
                const baseLanguage = targetLanguage.toLowerCase().split("-")[0];
                const rightToLeftScript = /-(Arab|Hebr|Thaa|Nkoo|Adlm|Rohg)$/i.test(targetLanguage);
                document.documentElement.dir = rightToLeftLanguages.has(baseLanguage) || rightToLeftScript
                    ? "rtl"
                    : "ltr";
                pageTranslated = true;
                languageSelect.disabled = false;
                translateButton.disabled = false;
                restoreLanguageButton.disabled = false;
                translationStatus.textContent = "Page translation complete. Machine translations may be imperfect; the original English text is available at any time.";
            } catch (error) {
                restoreOriginalLanguage();
                translationStatus.textContent = "Translation could not be completed; the page has been restored. " + error.message;
            } finally {
                translationInProgress = false;
                languageSelect.disabled = false;
                translateButton.disabled = false;
            }
        });

        restoreLanguageButton.addEventListener("click", restoreOriginalLanguage);
    }

    const chapterTabs = Array.from(document.querySelectorAll(".chapter-tab"));

    function activateChapterTab(activeTab, moveFocus) {
        chapterTabs.forEach(function (tab) {
            const isActive = tab === activeTab;
            const panel = document.getElementById(tab.getAttribute("aria-controls"));
            tab.setAttribute("aria-selected", String(isActive));
            tab.tabIndex = isActive ? 0 : -1;
            if (panel) {
                panel.hidden = !isActive;
            }
        });

        if (moveFocus) {
            activeTab.focus();
        }
    }

    chapterTabs.forEach(function (tab, index) {
        tab.addEventListener("click", function () {
            activateChapterTab(tab, false);
        });

        tab.addEventListener("keydown", function (event) {
            let nextIndex;
            if (event.key === "ArrowRight") {
                nextIndex = (index + 1) % chapterTabs.length;
            } else if (event.key === "ArrowLeft") {
                nextIndex = (index - 1 + chapterTabs.length) % chapterTabs.length;
            } else if (event.key === "Home") {
                nextIndex = 0;
            } else if (event.key === "End") {
                nextIndex = chapterTabs.length - 1;
            } else {
                return;
            }

            event.preventDefault();
            activateChapterTab(chapterTabs[nextIndex], true);
        });
    });

    const themes = {
        creation: {
            title: "Creation & wonder",
            passage: "Begin with Genesis 1–2 or Psalm 104. Read slowly and notice the images, structure, and descriptions of the created world.",
            questions: [
                "What details in the passage invite you to wonder?",
                "What questions does this reading leave open for you?"
            ]
        },
        wisdom: {
            title: "Wisdom & discernment",
            passage: "Begin with Proverbs 3:1–12 or Ecclesiastes 3:1–15. Read the surrounding verses to see how the passage develops its ideas.",
            questions: [
                "What does the passage suggest about wisdom or humility?",
                "How might the historical and literary context shape your reading?"
            ]
        },
        purpose: {
            title: "Identity & purpose",
            passage: "Begin with Psalm 139:1–18 or Micah 6:6–8. Notice the language, speaker, and hopes expressed in the passage.",
            questions: [
                "Which words or ideas resonate with you, and why?",
                "What does a meaningful life look like in your own experience?"
            ]
        },
        renewal: {
            title: "Renewal & growth",
            passage: "Begin with Isaiah 43:18–21 or Romans 12:1–2. Consider the imagery and the changes the passage describes.",
            questions: [
                "What might renewal mean in this passage?",
                "Is there a small change or practice you would like to reflect on?"
            ]
        },
        community: {
            title: "Love & community",
            passage: "Begin with Leviticus 19:9–18 or Luke 10:25–37. Read the full story or instruction in context.",
            questions: [
                "Who is included in the passage's vision of care?",
                "What might compassion look like in your community?"
            ]
        },
        hope: {
            title: "Hope & restoration",
            passage: "Begin with Isaiah 65:17–25 or Revelation 21:1–5. Pay attention to the images of renewal and hope.",
            questions: [
                "What kind of future does the passage imagine?",
                "How does its literary form influence the way you read it?"
            ]
        }
    };

    const themeButtons = document.querySelectorAll(".theme-button");
    const themePanel = document.getElementById("theme-detail");
    const themeTitle = document.getElementById("theme-detail-title");
    const themePassage = document.getElementById("theme-detail-passage");
    const themeQuestions = document.getElementById("theme-detail-questions");
    const closeThemeButton = document.querySelector(".close-theme");

    function closeThemePanel() {
        if (themePanel) {
            themePanel.hidden = true;
        }
        themeButtons.forEach(function (button) {
            button.setAttribute("aria-expanded", "false");
        });
    }

    if (themePanel && themeTitle && themePassage && themeQuestions) {
        themeButtons.forEach(function (button) {
            button.addEventListener("click", function () {
                const theme = themes[button.dataset.theme];
                if (!theme) {
                    return;
                }

                themeTitle.textContent = theme.title;
                themePassage.textContent = theme.passage;
                themeQuestions.replaceChildren();

                theme.questions.forEach(function (question) {
                    const item = document.createElement("li");
                    item.textContent = question;
                    themeQuestions.appendChild(item);
                });

                themePanel.hidden = false;
                themeButtons.forEach(function (otherButton) {
                    otherButton.setAttribute(
                        "aria-expanded",
                        String(otherButton === button)
                    );
                });
            });
        });
    }

    if (closeThemeButton) {
        closeThemeButton.addEventListener("click", closeThemePanel);
    }

    const problemForm = document.getElementById("problem-form");
    const problemResult = document.getElementById("problem-result");
    const problemResultContent = document.getElementById("problem-result-content");

    const areaQuestions = {
        work: "What is the next observable sign that this work or study plan is helping?",
        relationships: "What can you say about your own needs while making room to hear the other person's perspective?",
        health: "What question could you take to a qualified health professional, and what reliable information would help you prepare?",
        "money-law": "What deadline, document, or qualified local adviser should you check before making an irreversible decision?",
        technology: "What is the smallest safe test that could show whether your proposed fix works?",
        purpose: "Which values matter most here, and what would a choice shaped by those values look like in practice?",
        other: "What part of this situation is within your influence, and what support could help with the rest?"
    };

    function appendProblemSection(container, title, content, isList) {
        const heading = document.createElement("h4");
        heading.textContent = title;
        container.appendChild(heading);

        if (isList) {
            const list = document.createElement("ol");
            content.forEach(function (itemText) {
                const item = document.createElement("li");
                item.textContent = itemText;
                list.appendChild(item);
            });
            container.appendChild(list);
            return;
        }

        const paragraph = document.createElement("p");
        paragraph.textContent = content;
        container.appendChild(paragraph);
    }

    if (problemForm && problemResult && problemResultContent) {
        problemForm.addEventListener("submit", function (event) {
            event.preventDefault();

            if (!problemForm.reportValidity()) {
                return;
            }

            const formData = new FormData(problemForm);
            const area = String(formData.get("area"));
            const problem = String(formData.get("problem")).trim();
            const goal = String(formData.get("goal")).trim();
            const constraint = String(formData.get("constraint")).trim();
            const urgent = formData.get("urgency") === "yes";

            problemResultContent.replaceChildren();

            appendProblemSection(problemResultContent, "What you are working with", problem);
            appendProblemSection(problemResultContent, "The outcome you want", goal);

            if (constraint) {
                appendProblemSection(problemResultContent, "A limit to respect", constraint);
            }

            if (urgent) {
                appendProblemSection(
                    problemResultContent,
                    "Put safety and urgent support first",
                    "This reflection guide cannot assess or respond to an emergency. If someone may be in immediate danger or needs urgent care, contact your local emergency number or crisis service, go to the nearest emergency department, or ask a trusted person nearby to help you reach urgent support. Do not wait for this website to provide a solution."
                );
            } else {
                appendProblemSection(problemResultContent, "A question worth asking", areaQuestions[area] || areaQuestions.other);
                appendProblemSection(problemResultContent, "A grounded way to proceed", [
                    "Separate what you know from what you fear, assume, or still need to find out.",
                    "Describe the outcome you want in observable terms, while respecting the limits you named.",
                    "List at least three options, including asking a trusted person or qualified professional for help.",
                    "Compare likely benefits, risks, costs, and reversibility. Avoid rushed or unsafe decisions.",
                    "Choose one small, safe next step. Decide when you will try it and what would make you review the plan."
                ], true);
                appendProblemSection(
                    problemResultContent,
                    "A reflection to carry with you",
                    "Insight begins when a tangled problem becomes an honest question and a doable next step."
                );
                appendProblemSection(
                    problemResultContent,
                    "The riddle",
                    "What can you change, what must you accept for now, and what could become possible if you asked for help?"
                );
            }

            appendProblemSection(
                problemResultContent,
                "A note about this guide",
                "These prompts are a starting point, not a guaranteed answer or professional advice. Check important facts with reliable sources and people qualified in the relevant field."
            );
            problemResult.hidden = false;
            problemResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
    }

    const careerSearchForm = document.getElementById("career-search-form");
    const careerSearchStatus = document.getElementById("career-search-status");
    const videoGallery = document.getElementById("video-gallery");

    function addYouTubeFallback(statusElement, query) {
        if (!statusElement) {
            return;
        }

        const link = document.createElement("a");
        link.href = "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Search YouTube directly";
        statusElement.appendChild(document.createTextNode(" "));
        statusElement.appendChild(link);
    }

    function createVideoCard(video) {
        if (!video || !/^[A-Za-z0-9_-]{11}$/.test(video.id)) {
            return null;
        }

        const card = document.createElement("article");
        card.className = "video-card";

        const title = document.createElement("h3");
        title.textContent = video.title || "Untitled video";
        card.appendChild(title);

        const channel = document.createElement("p");
        channel.className = "video-channel";
        channel.textContent = video.channelTitle || "YouTube channel";
        card.appendChild(channel);

        const description = document.createElement("p");
        description.className = "video-description";
        description.textContent = video.description || "No description provided.";
        card.appendChild(description);

        const actions = document.createElement("div");
        actions.className = "video-card-actions";

        const watchLink = document.createElement("a");
        watchLink.className = "button button-outline";
        watchLink.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(video.id);
        watchLink.target = "_blank";
        watchLink.rel = "noopener noreferrer";
        watchLink.textContent = "Watch on YouTube";
        actions.appendChild(watchLink);

        const previewButton = document.createElement("button");
        previewButton.className = "button button-primary";
        previewButton.type = "button";
        previewButton.textContent = "Preview here";
        actions.appendChild(previewButton);
        card.appendChild(actions);

        const preview = document.createElement("div");
        preview.className = "video-preview";
        previewButton.addEventListener("click", function () {
            const existingFrame = preview.querySelector("iframe");
            if (existingFrame) {
                existingFrame.remove();
                previewButton.textContent = "Preview here";
                return;
            }

            const frame = document.createElement("iframe");
            frame.title = "Video preview: " + (video.title || "YouTube video");
            frame.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(video.id);
            frame.loading = "lazy";
            frame.referrerPolicy = "strict-origin-when-cross-origin";
            frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
            frame.allowFullscreen = true;
            preview.appendChild(frame);
            previewButton.textContent = "Close preview";
        });
        card.appendChild(preview);
        return card;
    }

    if (careerSearchForm && careerSearchStatus && videoGallery) {
        careerSearchForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            if (!careerSearchForm.reportValidity()) {
                return;
            }

            const category = document.getElementById("engineering-field");
            const queryField = document.getElementById("engineering-query");
            const submitButton = careerSearchForm.querySelector('button[type="submit"]');
            const query = queryField.value.trim();
            const selectedCategory = category.value;
            const searchPhrase = (selectedCategory === "auto" ? "" : category.selectedOptions[0].textContent) + " " + query;

            careerSearchStatus.replaceChildren();
            videoGallery.replaceChildren();
            careerSearchStatus.textContent = "Searching YouTube for relevant learning videos…";
            submitButton.disabled = true;

            try {
                const params = new URLSearchParams({
                    query: query,
                    category: selectedCategory
                });
                const response = await fetch("/api/get-engineering-videos?" + params.toString(), {
                    headers: { Accept: "application/json" }
                });
                const payload = await response.json();

                if (!response.ok) {
                    const message = payload && typeof payload.error === "string"
                        ? payload.error
                        : "The video search service returned an unexpected response.";
                    throw new Error(message);
                }

                const videos = Array.isArray(payload.videos) ? payload.videos : [];
                if (videos.length === 0) {
                    careerSearchStatus.textContent = "No embeddable videos were found for that search.";
                    addYouTubeFallback(careerSearchStatus, searchPhrase);
                    return;
                }

                videos.forEach(function (video) {
                    const card = createVideoCard(video);
                    if (card) {
                        videoGallery.appendChild(card);
                    }
                });

                if (!videoGallery.childElementCount) {
                    careerSearchStatus.textContent = "The search returned no usable video results.";
                    addYouTubeFallback(careerSearchStatus, searchPhrase);
                    return;
                }

                careerSearchStatus.textContent = "Showing YouTube results for " + (payload.category || "engineering") + ". Results are not independently vetted.";
            } catch (error) {
                careerSearchStatus.textContent = error instanceof TypeError
                    ? "The video service is unavailable. Start the United World server and configure its YouTube API key to load results."
                    : "Video search could not be completed: " + error.message;
                addYouTubeFallback(careerSearchStatus, searchPhrase);
            } finally {
                submitButton.disabled = false;
            }
        });
    }

    const newsStatus = document.getElementById("news-status");
    const newsGrid = document.getElementById("news-grid");
    const creativeGrid = document.getElementById("creative-grid");
    const accountStatus = document.getElementById("account-status");
    const accountForms = document.getElementById("account-forms");
    const registerForm = document.getElementById("register-form");
    const loginForm = document.getElementById("login-form");
    const logoutButton = document.getElementById("logout-button");
    const creativePostForm = document.getElementById("creative-post-form");
    const creativeStatus = document.getElementById("creative-status");
    const moderatorAuthForm = document.getElementById("moderator-auth-form");
    const moderatorStatus = document.getElementById("moderator-status");
    const moderatorQueue = document.getElementById("moderator-queue");
    let moderatorToken = "";

    async function communityRequest(url, options) {
        const response = await fetch(url, Object.assign({
            headers: { Accept: "application/json" }
        }, options || {}));
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || "The request could not be completed.");
        }
        return payload;
    }

    function addText(parent, tagName, className, value) {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        element.textContent = value;
        parent.appendChild(element);
        return element;
    }

    async function loadNews() {
        if (!newsStatus || !newsGrid) {
            return;
        }
        try {
            const payload = await communityRequest("/api/community/news");
            newsGrid.replaceChildren();
            if (!payload.items.length) {
                newsStatus.textContent = payload.sourcesConfigured < 3
                    ? "The news hub is not publishing yet. At least three RSS sources must be enabled after reviewing their reuse terms."
                    : "No recent stories currently meet the three-source corroboration threshold.";
                return;
            }

            payload.items.forEach(function (item) {
                const card = document.createElement("article");
                card.className = "news-card";
                addText(card, "span", "news-source-tag", "PRIMARY SOURCE · " + item.primarySource);
                addText(card, "h3", "", item.title);
                const time = document.createElement("p");
                time.className = "news-meta";
                const timeElement = document.createElement("time");
                const publishedDate = new Date(item.publishedAt);
                if (!Number.isNaN(publishedDate.valueOf())) {
                    timeElement.dateTime = publishedDate.toISOString();
                    timeElement.textContent = "Originally published " + new Intl.DateTimeFormat(
                        undefined,
                        { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }
                    ).format(publishedDate) + " UTC";
                } else {
                    timeElement.textContent = "Original timestamp unavailable";
                }
                time.appendChild(timeElement);
                card.appendChild(time);
                addText(
                    card,
                    "p",
                    "",
                    item.corroborationCount + " independent publishers report on this topic."
                );
                const publisherLink = document.createElement("a");
                publisherLink.className = "news-card-link";
                publisherLink.href = item.url;
                publisherLink.target = "_blank";
                publisherLink.rel = "noopener noreferrer";
                publisherLink.textContent = "Read the original report at " + item.primarySource;
                card.appendChild(publisherLink);
                const factCheck = item.factCheckSummary || "No fact-check note is available.";
                addText(card, "p", "news-fact-check", "Fact-check status: " + item.factCheckStatus.replaceAll("_", " ") + ". " + factCheck);
                newsGrid.appendChild(card);
            });
            newsStatus.textContent = "Showing " + payload.items.length + " cross-source corroborated stories. Corroboration is not proof of truth.";
        } catch (error) {
            newsStatus.textContent = error.message;
        }
    }

    async function loadCreativePosts() {
        if (!creativeGrid) {
            return;
        }
        try {
            const payload = await communityRequest("/api/community/posts");
            creativeGrid.replaceChildren();
            payload.posts.forEach(function (post) {
                const card = document.createElement("article");
                card.className = "creative-card";
                addText(card, "p", "creative-category", post.category);
                addText(card, "h3", "", post.title);
                addText(card, "p", "creative-body", post.body);
                const date = new Date(post.createdAt);
                addText(
                    card,
                    "p",
                    "",
                    "By " + post.author + " · " + (Number.isNaN(date.valueOf()) ? "date unavailable" : date.toLocaleDateString())
                );
                const actions = document.createElement("div");
                actions.className = "creative-card-actions";
                const reasonSelect = document.createElement("select");
                reasonSelect.setAttribute("aria-label", "Reason for reporting this post");
                [
                    ["copyright", "Copyright"],
                    ["misinformation", "Misleading content"],
                    ["harassment", "Harassment"],
                    ["illegal", "Illegal content"],
                    ["spam", "Spam"],
                    ["other", "Other concern"]
                ].forEach(function (entry) {
                    const option = document.createElement("option");
                    option.value = entry[0];
                    option.textContent = entry[1];
                    reasonSelect.appendChild(option);
                });
                actions.appendChild(reasonSelect);
                const reportButton = document.createElement("button");
                reportButton.type = "button";
                reportButton.className = "button button-outline";
                reportButton.textContent = "Report post";
                reportButton.addEventListener("click", async function () {
                    reportButton.disabled = true;
                    try {
                        const result = await communityRequest(
                            "/api/community/posts/" + encodeURIComponent(post.id) + "/report",
                            {
                                method: "POST",
                                headers: { Accept: "application/json", "Content-Type": "application/json" },
                                body: JSON.stringify({ reason: reasonSelect.value })
                            }
                        );
                        if (creativeStatus) {
                            creativeStatus.textContent = result.message;
                        }
                        if (result.hidden) {
                            await loadCreativePosts();
                        }
                    } catch (error) {
                        if (creativeStatus) {
                            creativeStatus.textContent = error.message;
                        }
                        reportButton.disabled = false;
                    }
                });
                actions.appendChild(reportButton);
                card.appendChild(actions);
                creativeGrid.appendChild(card);
            });
            if (creativeStatus && !payload.posts.length) {
                creativeStatus.textContent = "No creative posts have been published yet. Sign in to submit work for review.";
            }
        } catch (error) {
            if (creativeStatus) {
                creativeStatus.textContent = error.message;
            }
        }
    }

    async function loadCurrentUser() {
        if (!accountStatus) {
            return;
        }
        try {
            const payload = await communityRequest("/api/community/me");
            const user = payload.user;
            accountForms.hidden = Boolean(user);
            logoutButton.hidden = !user;
            creativePostForm.hidden = !user;
            accountStatus.textContent = user
                ? "Signed in as " + user.displayName + ". Creator trust score: " + user.trustScore + "/100. New creators' posts are reviewed."
                : "Sign in to submit creative work or report a post. Posts are plain text and require review.";
        } catch (error) {
            accountStatus.textContent = error.message;
        }
    }

    async function submitAccountForm(form, endpoint) {
        const formData = new FormData(form);
        const body = Object.fromEntries(formData.entries());
        try {
            const payload = await communityRequest(endpoint, {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            accountStatus.textContent = payload.message ||
                ("Signed in as " + payload.user.displayName + ". Trust score: " + payload.user.trustScore + "/100.");
            form.reset();
            await loadCurrentUser();
        } catch (error) {
            accountStatus.textContent = error.message;
        }
    }

    if (newsStatus) {
        loadNews();
    }
    if (creativeGrid) {
        loadCreativePosts();
        loadCurrentUser();
    }

    if (registerForm) {
        registerForm.addEventListener("submit", function (event) {
            event.preventDefault();
            if (registerForm.reportValidity()) {
                submitAccountForm(registerForm, "/api/community/register");
            }
        });
    }
    if (loginForm) {
        loginForm.addEventListener("submit", function (event) {
            event.preventDefault();
            if (loginForm.reportValidity()) {
                submitAccountForm(loginForm, "/api/community/login");
            }
        });
    }
    if (logoutButton) {
        logoutButton.addEventListener("click", async function () {
            try {
                const payload = await communityRequest("/api/community/logout", {
                    method: "POST",
                    headers: { Accept: "application/json", "Content-Type": "application/json" },
                    body: "{}"
                });
                accountStatus.textContent = payload.message;
                await loadCurrentUser();
            } catch (error) {
                accountStatus.textContent = error.message;
            }
        });
    }

    if (creativePostForm) {
        creativePostForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            if (!creativePostForm.reportValidity()) {
                return;
            }
            const values = new FormData(creativePostForm);
            try {
                const payload = await communityRequest("/api/community/posts", {
                    method: "POST",
                    headers: { Accept: "application/json", "Content-Type": "application/json" },
                    body: JSON.stringify({
                        category: values.get("category"),
                        title: values.get("title"),
                        body: values.get("body"),
                        copyrightCertified: values.get("copyrightCertified") === "on"
                    })
                });
                creativeStatus.textContent = payload.message;
                creativePostForm.reset();
                await loadCreativePosts();
            } catch (error) {
                creativeStatus.textContent = error.message;
            }
        });
    }

    if (moderatorAuthForm && moderatorStatus && moderatorQueue) {
        moderatorAuthForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const tokenField = document.getElementById("moderator-token");
            moderatorToken = tokenField.value.trim();
            moderatorQueue.replaceChildren();
            try {
                const payload = await communityRequest("/api/community/admin/pending", {
                    headers: {
                        Accept: "application/json",
                        Authorization: "Bearer " + moderatorToken
                    }
                });
                moderatorStatus.textContent = payload.posts.length + " post(s) await review.";
                payload.posts.forEach(function (post) {
                    const card = document.createElement("article");
                    card.className = "moderator-card";
                    addText(card, "p", "creative-category", post.category + " · " + post.moderation_status + " · " + post.reports + " reports");
                    addText(card, "h4", "", post.title);
                    addText(card, "p", "", post.body);
                    addText(card, "p", "", "Creator: " + post.display_name + " · trust " + post.trust_score + "/100 · " + post.email);
                    if (post.report_details) {
                        try {
                            JSON.parse(post.report_details).forEach(function (report) {
                                addText(
                                    card,
                                    "p",
                                    "",
                                    "Report (" + report.reason + "): " + (report.details || "No additional details.")
                                );
                            });
                        } catch (error) {
                            addText(card, "p", "", "One or more report details could not be displayed.");
                        }
                    }
                    const actions = document.createElement("div");
                    actions.className = "moderation-actions";
                    ["approve", "reject", "hide", "restore"].forEach(function (action) {
                        const button = document.createElement("button");
                        button.type = "button";
                        button.className = action === "approve" || action === "restore"
                            ? "button button-primary"
                            : "button button-outline";
                        button.textContent = action.charAt(0).toUpperCase() + action.slice(1);
                        button.addEventListener("click", async function () {
                            button.disabled = true;
                            try {
                                const result = await communityRequest(
                                    "/api/community/admin/posts/" + encodeURIComponent(post.id),
                                    {
                                        method: "POST",
                                        headers: {
                                            Accept: "application/json",
                                            "Content-Type": "application/json",
                                            Authorization: "Bearer " + moderatorToken
                                        },
                                        body: JSON.stringify({ action: action })
                                    }
                                );
                                moderatorStatus.textContent = result.message;
                                card.remove();
                                await loadCreativePosts();
                            } catch (error) {
                                moderatorStatus.textContent = error.message;
                                button.disabled = false;
                            }
                        });
                        actions.appendChild(button);
                    });
                    card.appendChild(actions);
                    moderatorQueue.appendChild(card);
                });
            } catch (error) {
                moderatorToken = "";
                moderatorStatus.textContent = error.message;
                tokenField.value = "";
            }
        });
    }

    const loveBankStorageKey = "united-world-love-bank-demo-v1";
    const loveCurrencies = [
        { code: "USD", name: "US Dollar", perUsd: 1 },
        { code: "EUR", name: "Euro", perUsd: 0.92 },
        { code: "GBP", name: "British Pound", perUsd: 0.79 },
        { code: "CAD", name: "Canadian Dollar", perUsd: 1.36 },
        { code: "AUD", name: "Australian Dollar", perUsd: 1.52 },
        { code: "JPY", name: "Japanese Yen", perUsd: 150 },
        { code: "CNY", name: "Chinese Yuan", perUsd: 7.2 },
        { code: "INR", name: "Indian Rupee", perUsd: 83 },
        { code: "BRL", name: "Brazilian Real", perUsd: 5 },
        { code: "MXN", name: "Mexican Peso", perUsd: 17 },
        { code: "NGN", name: "Nigerian Naira", perUsd: 1500 },
        { code: "KES", name: "Kenyan Shilling", perUsd: 130 },
        { code: "ZAR", name: "South African Rand", perUsd: 18.5 },
        { code: "CHF", name: "Swiss Franc", perUsd: 0.9 },
        { code: "SGD", name: "Singapore Dollar", perUsd: 1.35 },
        { code: "NZD", name: "New Zealand Dollar", perUsd: 1.65 },
        { code: "KRW", name: "South Korean Won", perUsd: 1330 },
        { code: "IDR", name: "Indonesian Rupiah", perUsd: 15700 },
        { code: "PHP", name: "Philippine Peso", perUsd: 56 },
        { code: "TRY", name: "Turkish Lira", perUsd: 32 },
        { code: "AED", name: "UAE Dirham", perUsd: 3.67 },
        { code: "GHS", name: "Ghanaian Cedi", perUsd: 12 },
        { code: "EGP", name: "Egyptian Pound", perUsd: 48 },
        { code: "THB", name: "Thai Baht", perUsd: 36 },
        { code: "VND", name: "Vietnamese Dong", perUsd: 25000 },
        { code: "PKR", name: "Pakistani Rupee", perUsd: 278 },
        { code: "BDT", name: "Bangladeshi Taka", perUsd: 110 },
        { code: "LKR", name: "Sri Lankan Rupee", perUsd: 300 },
        { code: "MAD", name: "Moroccan Dirham", perUsd: 10 },
        { code: "COP", name: "Colombian Peso", perUsd: 3900 },
        { code: "ARS", name: "Argentine Peso", perUsd: 900 },
        { code: "MYR", name: "Malaysian Ringgit", perUsd: 4.7 },
        { code: "SAR", name: "Saudi Riyal", perUsd: 3.75 },
        { code: "NPR", name: "Nepalese Rupee", perUsd: 133 },
        { code: "UGX", name: "Ugandan Shilling", perUsd: 3800 },
        { code: "TZS", name: "Tanzanian Shilling", perUsd: 2500 }
    ];
    const loveCurrencyByCode = new Map(loveCurrencies.map(function (currency) {
        return [currency.code, currency];
    }));
    const loveHomeCurrency = document.getElementById("love-home-currency");
    const loveDisplayCurrency = document.getElementById("love-display-currency");
    const loveAccountForm = document.getElementById("love-account-form");
    const loveDashboard = document.getElementById("love-bank-dashboard");
    const loveActiveAccount = document.getElementById("love-active-account");
    const loveActiveUsername = document.getElementById("love-active-username");
    const loveBalance = document.getElementById("love-balance");
    const loveBalanceCurrency = document.getElementById("love-balance-currency");
    const loveCreditBalance = document.getElementById("love-credit-balance");
    const loveAccountNumber = document.getElementById("love-account-number");
    const loveRecipient = document.getElementById("love-recipient");
    const loveTransferForm = document.getElementById("love-transfer-form");
    const loveInterestYears = document.getElementById("love-interest-years");
    const loveInterestProjection = document.getElementById("love-interest-projection");
    const loveActivityCount = document.getElementById("love-activity-count");
    const loveActivityProgress = document.getElementById("love-activity-progress");
    const loveActivityStatus = document.getElementById("love-activity-status");
    const loveTransferStatus = document.getElementById("love-transfer-status");
    const loveLedger = document.getElementById("love-ledger");
    const loveClearDataButton = document.getElementById("love-clear-data");
    const loveBankStatus = document.getElementById("love-bank-status");
    const loveResetCorruptButton = document.getElementById("love-reset-corrupt");
    const loveRateDate = document.getElementById("love-rate-date");
    const loveRateChart = document.getElementById("love-rate-chart");
    let loveBankData = { version: 1, activeAccountId: null, accounts: [] };
    let loveBankStorageError = "";
    let loveBankNeedsMigration = false;
    let selectedLoveDisplayCurrency = null;

    function isLoveCurrency(code) {
        return typeof code === "string" && loveCurrencyByCode.has(code);
    }

    function isLoveAccount(account) {
        return account && typeof account.id === "string" &&
            typeof account.accountNumber === "string" &&
            typeof account.username === "string" &&
            typeof account.country === "string" &&
            Number.isSafeInteger(account.balance) && account.balance >= 0 &&
            typeof account.activities === "object" && account.activities !== null &&
            Array.isArray(account.transactions) &&
            (account.homeCurrency === undefined || isLoveCurrency(account.homeCurrency));
    }

    function readLoveBankData() {
        try {
            const saved = localStorage.getItem(loveBankStorageKey);
            if (!saved) {
                return { version: 1, activeAccountId: null, accounts: [] };
            }
            const parsed = JSON.parse(saved);
            if (
                !parsed ||
                parsed.version !== 1 ||
                !Array.isArray(parsed.accounts) ||
                !parsed.accounts.every(isLoveAccount) ||
                (parsed.activeAccountId !== null &&
                    !parsed.accounts.some(function (account) {
                        return account.id === parsed.activeAccountId;
                    }))
            ) {
                throw new Error("Saved demo wallet data is invalid. Clear this site's saved data in your browser before opening a new demo account.");
            }
            parsed.accounts.forEach(function (account) {
                if (account.homeCurrency === undefined) {
                    account.homeCurrency = "USD";
                    loveBankNeedsMigration = true;
                }
            });
            return parsed;
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error("Saved demo wallet data could not be read. Clear this site's saved data in your browser before continuing.");
            }
            throw error;
        }
    }

    function saveLoveBankData(nextData) {
        try {
            localStorage.setItem(loveBankStorageKey, JSON.stringify(nextData));
            loveBankData = nextData;
            loveBankStorageError = "";
            return true;
        } catch (error) {
            loveBankStorageError = error instanceof DOMException && error.name === "QuotaExceededError"
                ? "This browser has no space left for demo data. Clear browser storage or erase the demo data and try again."
                : "This browser cannot save the demo wallet. Enable local site storage to use the simulation.";
            return false;
        }
    }

    function currentLoveAccount() {
        return loveBankData.accounts.find(function (account) {
            return account.id === loveBankData.activeAccountId;
        }) || null;
    }

    function localDateKey(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");
    }

    function loveNumber(amount) {
        return new Intl.NumberFormat(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(amount);
    }

    function formatLoveCurrency(amount, code) {
        if (!isLoveCurrency(code)) {
            throw new Error("Unsupported simulated currency: " + code);
        }
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: code,
            maximumFractionDigits: 2
        }).format(amount);
    }

    function loveCreditValueInCurrency(credits, code) {
        const currency = loveCurrencyByCode.get(code);
        if (!currency) {
            throw new Error("Unsupported simulated currency: " + code);
        }
        return credits * currency.perUsd;
    }

    function populateLoveCurrencyControls() {
        [loveHomeCurrency, loveDisplayCurrency].forEach(function (select) {
            if (!select) {
                return;
            }
            select.replaceChildren();
            loveCurrencies.forEach(function (currency) {
                const option = document.createElement("option");
                option.value = currency.code;
                option.textContent = currency.name + " (" + currency.code + ")";
                select.appendChild(option);
            });
        });
        if (loveRateDate) {
            const today = new Date();
            loveRateDate.dateTime = localDateKey(today);
            loveRateDate.textContent = today.toLocaleDateString();
        }
        if (loveRateChart) {
            loveRateChart.replaceChildren();
            loveCurrencies.forEach(function (currency) {
                const row = document.createElement("tr");
                const name = document.createElement("th");
                const rate = document.createElement("td");
                name.scope = "row";
                name.textContent = currency.name + " (" + currency.code + ")";
                rate.textContent = formatLoveCurrency(currency.perUsd, currency.code);
                row.append(name, rate);
                loveRateChart.appendChild(row);
            });
        }
    }

    function addLoveTransaction(account, kind, amount, description, counterparty, nextBalance) {
        account.transactions.unshift({
            id: "tx-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            kind: kind,
            amount: amount,
            balanceAfter: nextBalance,
            description: description,
            counterparty: counterparty || "",
            createdAt: new Date().toISOString()
        });
        account.transactions = account.transactions.slice(0, 50);
    }

    function renderLoveBank() {
        if (!loveDashboard || !loveAccountForm) {
            return;
        }
        const account = currentLoveAccount();
        const hasAccounts = loveBankData.accounts.length > 0;
        loveAccountForm.hidden = hasAccounts;
        loveDashboard.hidden = !hasAccounts || !account;
        if (loveBankStatus && loveBankStorageError) {
            loveBankStatus.textContent = loveBankStorageError;
        }
        if (loveResetCorruptButton) {
            loveResetCorruptButton.hidden = !loveBankStorageError;
        }
        if (!account) {
            return;
        }

        loveActiveAccount.replaceChildren();
        loveBankData.accounts.forEach(function (profile) {
            const option = document.createElement("option");
            option.value = profile.id;
            option.textContent = profile.username + " · " + profile.accountNumber;
            option.selected = profile.id === account.id;
            loveActiveAccount.appendChild(option);
        });
        loveActiveUsername.textContent = account.username;
        if (!isLoveCurrency(selectedLoveDisplayCurrency)) {
            selectedLoveDisplayCurrency = isLoveCurrency(account.homeCurrency)
                ? account.homeCurrency
                : "USD";
        }
        if (loveDisplayCurrency) {
            loveDisplayCurrency.value = selectedLoveDisplayCurrency;
        }
        loveBalance.textContent = formatLoveCurrency(
            loveCreditValueInCurrency(account.balance, selectedLoveDisplayCurrency),
            selectedLoveDisplayCurrency
        );
        loveBalanceCurrency.textContent = selectedLoveDisplayCurrency + " · simulated";
        loveCreditBalance.textContent = loveNumber(account.balance) +
            " Love Credits · fictional base balance";
        loveAccountNumber.textContent = account.accountNumber;

        loveRecipient.replaceChildren();
        const otherAccounts = loveBankData.accounts.filter(function (profile) {
            return profile.id !== account.id;
        });
        if (!otherAccounts.length) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "Create another local demo profile first";
            loveRecipient.appendChild(option);
            loveRecipient.disabled = true;
        } else {
            loveRecipient.disabled = false;
            otherAccounts.forEach(function (profile) {
                const option = document.createElement("option");
                option.value = profile.id;
                option.textContent = profile.username + " · " + profile.accountNumber;
                loveRecipient.appendChild(option);
            });
        }

        const today = localDateKey(new Date());
        const completed = Array.isArray(account.activities[today]) ? account.activities[today] : [];
        loveActivityCount.textContent = completed.length + " of 2 activities";
        loveActivityProgress.value = Math.min(completed.length, 2);
        if (loveTransferForm) {
            loveTransferForm.querySelectorAll("input, button").forEach(function (element) {
                element.disabled = Boolean(loveBankStorageError);
            });
            loveRecipient.disabled = Boolean(loveBankStorageError) || !otherAccounts.length;
        }
        document.querySelectorAll(".love-activity").forEach(function (button) {
            const isComplete = completed.includes(button.dataset.loveActivity);
            button.disabled = isComplete || Boolean(loveBankStorageError);
            const label = button.querySelector("span");
            if (label) {
                if (!button.dataset.defaultLabel) {
                    button.dataset.defaultLabel = label.textContent;
                }
                label.textContent = button.dataset.defaultLabel +
                    (isComplete ? " · completed today" : "");
            }
        });

        loveLedger.replaceChildren();
        account.transactions.forEach(function (transaction) {
            const item = document.createElement("li");
            const timestamp = new Date(transaction.createdAt);
            const dateText = Number.isNaN(timestamp.valueOf())
                ? "Date unavailable"
                : timestamp.toLocaleString();
            const direction = transaction.kind === "sent" ? "−" : "+";
            const other = transaction.counterparty ? " · " + transaction.counterparty : "";
            item.textContent = dateText + " · " + transaction.description + other +
                " · " + direction + loveNumber(transaction.amount) +
                " · balance " + loveNumber(transaction.balanceAfter) + " credits";
            loveLedger.appendChild(item);
        });
        if (!account.transactions.length) {
            const item = document.createElement("li");
            item.className = "love-ledger-empty";
            item.textContent = "No demo activity yet.";
            loveLedger.appendChild(item);
        }
        if (loveHomeCurrency) {
            loveHomeCurrency.value = isLoveCurrency(account.homeCurrency)
                ? account.homeCurrency
                : "USD";
        }
        updateLoveInterestProjection();
    }

    function updateLoveInterestProjection() {
        if (!loveInterestYears || !loveInterestProjection) {
            return;
        }
        const account = currentLoveAccount();
        const years = Number(loveInterestYears.value);
        if (!account || !Number.isFinite(years) || years < 1 || years > 50) {
            loveInterestProjection.textContent = "Choose 1–50 years";
            return;
        }
        const futureBalance = account.balance * Math.pow(1.02, years);
        const displayCurrency = isLoveCurrency(selectedLoveDisplayCurrency)
            ? selectedLoveDisplayCurrency
            : "USD";
        const projectedValue = loveCreditValueInCurrency(futureBalance, displayCurrency);
        const growthValue = loveCreditValueInCurrency(futureBalance - account.balance, displayCurrency);
        loveInterestProjection.textContent =
            formatLoveCurrency(projectedValue, displayCurrency) + " · increase " +
            formatLoveCurrency(growthValue, displayCurrency);
    }

    if (loveAccountForm && loveBankStatus) {
        try {
            populateLoveCurrencyControls();
            loveBankData = readLoveBankData();
            if (loveBankNeedsMigration && !saveLoveBankData(loveBankData)) {
                loveBankStatus.textContent = loveBankStorageError;
            }
        } catch (error) {
            loveBankStorageError = error.message;
            loveBankStatus.textContent = error.message;
            loveAccountForm.querySelectorAll("input, button").forEach(function (element) {
                element.disabled = true;
            });
        }
        renderLoveBank();

        loveAccountForm.addEventListener("submit", function (event) {
            event.preventDefault();
            if (!loveAccountForm.reportValidity() || loveBankStorageError) {
                return;
            }
            if (loveBankData.accounts.length >= 20) {
                loveBankStatus.textContent = "This browser demo supports up to 20 fictional profiles.";
                return;
            }

            const username = document.getElementById("love-username").value.trim();
            const country = document.getElementById("love-country").value.trim();
            const homeCurrency = loveHomeCurrency ? loveHomeCurrency.value : "USD";
            if (!isLoveCurrency(homeCurrency)) {
                loveBankStatus.textContent = "Choose a supported simulated home currency.";
                return;
            }
            if (loveBankData.accounts.some(function (account) {
                return account.username.toLocaleLowerCase() === username.toLocaleLowerCase();
            })) {
                loveBankStatus.textContent = "That demo username already exists in this browser. Choose another.";
                return;
            }

            let accountNumber;
            do {
                const randomDigits = window.crypto && window.crypto.getRandomValues
                    ? window.crypto.getRandomValues(new Uint32Array(1))[0] % 100000000
                    : Math.floor(Math.random() * 100000000);
                accountNumber = "UW-" + String(randomDigits).padStart(8, "0");
            } while (loveBankData.accounts.some(function (account) {
                return account.accountNumber === accountNumber;
            }));

            const account = {
                id: "demo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
                accountNumber: accountNumber,
                username: username,
                country: country,
                homeCurrency: homeCurrency,
                balance: 0,
                createdAt: new Date().toISOString(),
                activities: {},
                transactions: []
            };
            const nextData = {
                version: 1,
                activeAccountId: account.id,
                accounts: loveBankData.accounts.concat(account)
            };
            if (!saveLoveBankData(nextData)) {
                loveBankStatus.textContent = loveBankStorageError;
                return;
            }
            loveAccountForm.reset();
            loveBankStatus.textContent = "Your free fictional demo profile is ready with a 0 Love Credit balance.";
            renderLoveBank();
        });
    }

    if (loveResetCorruptButton) {
        loveResetCorruptButton.addEventListener("click", function () {
            if (!window.confirm("Erase unreadable Love Bank demo data saved in this browser? This cannot be undone.")) {
                return;
            }
            try {
                localStorage.removeItem(loveBankStorageKey);
                loveBankData = { version: 1, activeAccountId: null, accounts: [] };
                loveBankStorageError = "";
                loveAccountForm.querySelectorAll("input, button").forEach(function (element) {
                    element.disabled = false;
                });
                loveBankStatus.textContent = "Saved demo data erased. You can create a new fictional profile.";
                renderLoveBank();
            } catch (error) {
                loveBankStatus.textContent = "This browser could not erase the data. Clear this site's storage in your browser settings.";
            }
        });
    }

    if (loveActiveAccount) {
        loveActiveAccount.addEventListener("change", function () {
            selectedLoveDisplayCurrency = null;
            const nextData = Object.assign({}, loveBankData, {
                activeAccountId: loveActiveAccount.value
            });
            if (!saveLoveBankData(nextData)) {
                loveBankStatus.textContent = loveBankStorageError;
                return;
            }
            if (loveActivityStatus) {
                loveActivityStatus.textContent = "";
            }
            if (loveTransferStatus) {
                loveTransferStatus.textContent = "";
            }
            renderLoveBank();
        });
    }

    if (loveDisplayCurrency) {
        loveDisplayCurrency.addEventListener("change", function () {
            if (!isLoveCurrency(loveDisplayCurrency.value)) {
                loveDisplayCurrency.value = "USD";
                selectedLoveDisplayCurrency = "USD";
            } else {
                selectedLoveDisplayCurrency = loveDisplayCurrency.value;
            }
            renderLoveBank();
        });
    }

    document.querySelectorAll(".love-activity").forEach(function (button) {
        button.addEventListener("click", function () {
            const account = currentLoveAccount();
            const activityKey = button.dataset.loveActivity;
            const reward = Number(button.dataset.reward);
            if (!account || !activityKey || !Number.isSafeInteger(reward) || reward <= 0) {
                if (loveActivityStatus) {
                    loveActivityStatus.textContent = "This demo activity is not available.";
                }
                return;
            }
            const today = localDateKey(new Date());
            if (!Array.isArray(account.activities[today])) {
                account.activities[today] = [];
            }
            if (account.activities[today].includes(activityKey)) {
                loveActivityStatus.textContent = "This activity has already been completed today.";
                return;
            }
            if (account.balance + reward > 1000000000) {
                loveActivityStatus.textContent = "The demo wallet has reached its fictional balance limit.";
                return;
            }

            account.activities[today].push(activityKey);
            account.balance += reward;
            addLoveTransaction(account, "reward", reward, "Daily learning activity", "", account.balance);
            if (!saveLoveBankData(loveBankData)) {
                account.activities[today].pop();
                account.balance -= reward;
                account.transactions.shift();
                loveActivityStatus.textContent = loveBankStorageError;
                renderLoveBank();
                return;
            }
            loveActivityStatus.textContent = "Completed! " + reward + " fictional Love Credits were added to this local demo wallet.";
            renderLoveBank();
        });
    });

    if (loveInterestYears) {
        loveInterestYears.addEventListener("input", updateLoveInterestProjection);
    }

    if (loveTransferForm && loveTransferStatus) {
        loveTransferForm.addEventListener("submit", function (event) {
            event.preventDefault();
            if (!loveTransferForm.reportValidity() || loveBankStorageError) {
                return;
            }
            const sender = currentLoveAccount();
            const recipient = loveBankData.accounts.find(function (account) {
                return account.id === loveRecipient.value;
            });
            const amount = Number(document.getElementById("love-transfer-amount").value);
            if (!sender || !recipient || sender.id === recipient.id) {
                loveTransferStatus.textContent = "Choose another fictional profile in this browser.";
                return;
            }
            if (!Number.isSafeInteger(amount) || amount <= 0) {
                loveTransferStatus.textContent = "Enter a positive whole number of demo credits.";
                return;
            }
            if (amount > sender.balance) {
                loveTransferStatus.textContent = "Insufficient fictional demo credits. The transfer was not made.";
                return;
            }

            const senderBalance = sender.balance - amount;
            const recipientBalance = recipient.balance + amount;
            if (!Number.isSafeInteger(recipientBalance) || recipientBalance > 1000000000) {
                loveTransferStatus.textContent = "The recipient demo wallet reached its fictional balance limit.";
                return;
            }
            sender.balance = senderBalance;
            recipient.balance = recipientBalance;
            addLoveTransaction(sender, "sent", amount, "Sent demo credits", recipient.username, senderBalance);
            addLoveTransaction(recipient, "received", amount, "Received demo credits", sender.username, recipientBalance);
            if (!saveLoveBankData(loveBankData)) {
                sender.balance += amount;
                recipient.balance -= amount;
                sender.transactions.shift();
                recipient.transactions.shift();
                loveTransferStatus.textContent = loveBankStorageError;
                renderLoveBank();
                return;
            }
            loveTransferForm.reset();
            loveTransferStatus.textContent = amount + " fictional credits were moved locally to " + recipient.username + ". No real payment or external transfer occurred.";
            renderLoveBank();
        });
    }

    if (loveClearDataButton) {
        loveClearDataButton.addEventListener("click", function () {
            if (!window.confirm("Erase all fictional Love Bank profiles, balances, activities, and transfers saved in this browser?")) {
                return;
            }
            try {
                localStorage.removeItem(loveBankStorageKey);
                loveBankData = { version: 1, activeAccountId: null, accounts: [] };
                loveBankStorageError = "";
                if (loveBankStatus) {
                    loveBankStatus.textContent = "All local demo data has been erased.";
                }
                if (loveTransferStatus) {
                    loveTransferStatus.textContent = "";
                }
                if (loveActivityStatus) {
                    loveActivityStatus.textContent = "";
                }
                renderLoveBank();
            } catch (error) {
                loveBankStatus.textContent = "This browser could not erase the demo data. Clear this site's data in browser settings.";
            }
        });
    }

    const form = document.getElementById("reflection-form");
    const intentionField = document.getElementById("reflection-intention");
    const result = document.getElementById("reflection-result");
    const resultIntention = document.getElementById("result-intention");
    const promptsList = document.getElementById("reflection-prompts");
    const status = document.getElementById("reflection-status");
    const copyButton = document.getElementById("copy-reflection");
    const downloadButton = document.getElementById("download-reflection");

    function getReflectionText() {
        if (!promptsList || !resultIntention) {
            return "";
        }
        const lines = [
            "United World — Reflection prompts",
            "",
            "My reflection: " + resultIntention.textContent,
            ""
        ];

        promptsList.querySelectorAll("li").forEach(function (item, index) {
            lines.push((index + 1) + ". " + item.textContent);
        });

        lines.push("", "Take these prompts at your own pace. They are for personal reflection, not professional advice.");
        return lines.join("\n");
    }

    if (form && intentionField && result && resultIntention && promptsList) {
        form.addEventListener("submit", function (event) {
            event.preventDefault();

            const intention = intentionField.value.trim();
            if (!intention) {
                intentionField.focus();
                return;
            }

            resultIntention.textContent = "You would like to explore: " + intention;
            promptsList.replaceChildren();

            [
                "Pause for a moment. What thoughts, feelings, or questions come up as you sit with this?",
                "If it feels helpful, is there a Bible passage or trusted perspective you would like to explore in context?",
                "What is one gentle, realistic next step that fits your values and circumstances?",
                "When you return to this reflection, what might you want to notice or ask next?"
            ].forEach(function (prompt) {
                const item = document.createElement("li");
                item.textContent = prompt;
                promptsList.appendChild(item);
            });

            result.hidden = false;
            if (status) {
                status.textContent = "";
            }
            result.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
    }

    if (copyButton) {
        copyButton.addEventListener("click", async function () {
            const text = getReflectionText();
            if (!text) {
                if (status) {
                    status.textContent = "Create reflection prompts before copying.";
                }
                return;
            }

            try {
                await navigator.clipboard.writeText(text);
                if (status) {
                    status.textContent = "Your prompts have been copied.";
                }
            } catch (error) {
                if (status) {
                    status.textContent = "Copying is unavailable here. You can select and copy the prompts manually.";
                }
            }
        });
    }

    if (downloadButton) {
        downloadButton.addEventListener("click", function () {
            const text = getReflectionText();
            if (!text) {
                if (status) {
                    status.textContent = "Create reflection prompts before downloading.";
                }
                return;
            }

            const file = new Blob([text], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(file);
            const link = document.createElement("a");
            link.href = url;
            link.download = "reflection-prompts.txt";
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(function () {
                URL.revokeObjectURL(url);
            }, 1000);

            if (status) {
                status.textContent = "Your prompt download has started.";
            }
        });
    }
});
