# United World page translation

## What it does

The language toolbar gets the current supported-language list from Google Cloud
Translation. A visitor selects a language and explicitly starts translation; the
browser sends batches of visible site copy, static accessibility labels, the page
title, and the description to this site's server. The server calls Google Cloud
Translation and returns translated strings. “Show English” restores the original
text without reloading.

The language chooser is a native select control, so keyboard users can type to
jump to a language. The page's `lang` and text direction are updated, including
right-to-left direction for common RTL languages.

The service supports the languages listed by the configured Google Cloud
Translation API, not every language or dialect. Machine translation may be
inaccurate, especially for Scripture, technical claims, cultural context, and
idioms. Important content should be reviewed by fluent human translators.

The site does not send form values, personal reflection output, problem-solving
results, video search results, or the language toolbar itself for translation.
Only the visitor's selected page copy is sent, after they press “Translate page.”
Google Cloud processes that text; configure the provider and privacy notice in line
with the site's legal and data-protection requirements. Do not use translations as
professional medical, legal, or financial advice.

## Configure the service

1. In Google Cloud Console, create or select a project, enable **Cloud Translation
   API**, configure billing and quota limits, and create a restricted API key.
2. Keep the key in the server environment; do not put it in HTML, client JavaScript,
   or a public repository. In PowerShell:

   ```powershell
   $env:GOOGLE_TRANSLATE_API_KEY = "your-restricted-key"
   node .\server.js
   ```

3. Open `http://localhost:3000`. For public deployment, use HTTPS, restrict the key
   to the Translation API and server where possible, and set provider budgets and
   quotas.

If the key is absent or the API is unavailable, the site remains in English and
announces that translation cannot be loaded. No third-party translation script or
provider credential is loaded by the browser.

## Endpoints

- `GET /api/translation-languages` returns language codes and English display names.
  Successful results are cached in memory for 24 hours.
- `POST /api/translate` accepts JSON:

  ```json
  {
    "target": "fr",
    "texts": ["Welcome to United World.", "Explore with care."]
  }
  ```

  The route validates the language-code shape, limits batches to 80 items and
  10,000 total characters, applies a basic per-process request limit, and returns
  translated strings in the same order. Translation text is not cached or logged
  by this application.

The deployment owner must configure Google Cloud API access, billing, quotas,
HTTPS, and an appropriate privacy notice. The source English page is the fallback.

## Provider references

- [Cloud Translation API v2: translate](https://cloud.google.com/translate/docs/reference/rest/v2/translate)
- [Cloud Translation API v2: supported languages](https://cloud.google.com/translate/docs/languages)
