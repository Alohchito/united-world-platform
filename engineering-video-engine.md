# United World Career Path Explorer

## What is implemented

The Career Path Explorer searches embeddable YouTube videos through a small
server-side route. The server maps searches to an engineering field, requests
official YouTube Data API metadata, and returns video IDs, titles, descriptions,
and channel names. Visitors may open a YouTube link or explicitly load a
privacy-enhanced embedded preview.

The frontend does not scrape pages, load third-party thumbnails, or send search
queries until the visitor submits the search form. Search text is sent to the
United World server and then to YouTube. Opening a preview or result link connects
the visitor to YouTube.

Search results are ranked by YouTube relevance. That does not establish that a
video or its channel is accurate, authoritative, or suitable for a particular
decision. An optional channel-ID allowlist can narrow search results, but the
allowlist must be selected and reviewed by a human.

## Run locally

Requirements: Node.js 18.17 or newer. No third-party Node packages are required.

1. In Google Cloud Console, create a project, enable **YouTube Data API v3**, and
   create an API key. Restrict the key to this API and, for a deployed server,
   restrict it to the server's IP address where supported.
2. Set the key in the server environment. In PowerShell:

   ```powershell
   $env:YOUTUBE_API_KEY = "your-key"
   node .\server.js
   ```

3. Visit `http://localhost:3000`.

Do not put the key in `index.html`, `script.js`, a public repository, or a browser
environment variable. If no key is configured, the site clearly reports that live
results are unavailable and offers a direct YouTube search link instead.

To limit results to channels reviewed by the site owner, optionally set a
comma-separated list of YouTube channel IDs before starting the server:

```powershell
$env:YOUTUBE_EDUCATIONAL_CHANNEL_IDS = "UC_channel_id_one,UC_channel_id_two"
```

An allowlist can reduce or eliminate results; it is not automatically created by
the API and should not be described as comprehensive accreditation.

For owner-curated video URL lookups, also set a separate long random bearer token
in `ENGINEERING_VIDEO_ADMIN_TOKEN`. Keep it private and use the route only over
HTTPS after deployment. For local testing, PowerShell can send it without putting
the token into the page:

```powershell
$env:ENGINEERING_VIDEO_ADMIN_TOKEN = "a-long-random-secret"
$headers = @{ Authorization = "Bearer $env:ENGINEERING_VIDEO_ADMIN_TOKEN" }
$url = "http://localhost:3000/api/get-engineering-videos?videoUrl=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DREPLACE_WITH_VIDEO_ID"
Invoke-RestMethod -Uri $url -Headers $headers
```

Replace `REPLACE_WITH_VIDEO_ID` with an actual 11-character YouTube video ID.

## API

`GET /api/get-engineering-videos?query=<text>&category=<id>`

- `query` is required and limited to 240 characters.
- `category` may be `auto` or one of the categories below.
- Search only requests videos YouTube marks embeddable and applies moderate
  SafeSearch.
- Responses include a resolved category and up to nine video records.
- An optional `videoUrl` query parameter accepts HTTPS YouTube watch, shorts,
  live, embed, or `youtu.be` URLs when called with the administrator bearer token.
  The server extracts only the video ID, then asks the official API for metadata
  and checks whether the video is embeddable.
- Arbitrary URLs are rejected. The service deliberately does not fetch arbitrary
  pages for Open Graph tags: server-side URL fetching can expose the server to
  SSRF, private-network access, malicious redirects, and untrusted HTML.

The server keeps a five-minute in-memory search cache, caps uncached API searches
at 80 per UTC day and requests at 10 per minute per server process. These are
basic safeguards, not a substitute for production-grade shared rate limiting,
monitoring, or Google Cloud quota controls. The YouTube API has project quotas;
check current limits in the Google Cloud Console before publishing the feature.

## Engineering taxonomy

Automatic classification uses phrase matches in the user's search. Visitors can
also select a field directly.

| Category | Matching concepts |
| --- | --- |
| Mechanical Engineering | machines, mechanisms, engines, thermodynamics, manufacturing, mechanical systems |
| Electrical & Electronic Engineering | generation, transmission, electricity, power grids, renewable energy, solar farms, microelectronics, microscopic circuits, processors, semiconductors |
| Chemical Engineering | chemistry, biology, raw materials, pharmaceuticals, plastics, food manufacturing, petroleum processing, clean energy, carbon capture |
| Civil & Structural Engineering | infrastructure, roads, bridges, tunnels, dams, skyscrapers, structural integrity, load-bearing, natural disaster engineering |
| Computer & Software Engineering | hardware, software, microprocessors, memory chips, smart appliances, coding, apps, operating systems, algorithms, web platforms |
| Biomedical Engineering | healthcare technology, medical devices, artificial hearts, prosthetic limbs, diagnostic machinery, MRI scanners |
| Environmental Engineering | planet protection, human health, drinking water systems, industrial waste treatment, air pollution controls, sustainable resource management |
| Industrial Engineering | efficiency, optimization, systems automation, logistics, factory streamlining, airport logistics, hospital workflows, supply chains |
| Mechatronics | robotics, autonomous vehicles, automation, electro-mechanical systems |

If no category keywords match, the engine uses a broad Engineering search instead
of guessing a specialist discipline.

## Future AI instruction

The current feature performs keyword classification and official API search; it
does not use an AI model. If a model is added later, use this behavior as a starting
instruction and review it for the chosen provider before deployment:

```text
You are United World's Engineering Learning Guide. Help the user discover
educational videos related to a stated engineering career path or practical
challenge. Map the request to the supplied engineering taxonomy; if the match is
uncertain, say so and offer the closest fields rather than pretending certainty.
Prioritize videos that explain the field and show real-world applications. Use only
video metadata and source results provided by the application; never invent a video,
creator, credential, citation, or claim about quality. A YouTube search result is
not proof of accuracy or authority. Distinguish general learning from professional
engineering advice, and do not present a video as a safe design or operational
instruction for a high-risk system. Ask one concise clarifying question when the
user's goal is too broad to search usefully. Be respectful of different countries,
languages, education pathways, and levels of prior knowledge.
```

## Future extensions

- Add Vimeo through its official API and documented authentication, terms, and
  embed rules.
- Add a reviewed source catalog or channel allowlist for stronger educational
  curation.
- Add translations and locale-specific career resources only after review by
  knowledgeable local contributors.
- Keep recommendations educational. Do not present a video as a guaranteed
  solution to medical, legal, financial, safety-critical, or other high-stakes
  problems.

## References

- [YouTube Data API: Search: list](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Data API: Videos: list](https://developers.google.com/youtube/v3/docs/videos/list)
- [YouTube API Services: Quota Calculator](https://developers.google.com/youtube/v3/determine_quota_cost)
- [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)
