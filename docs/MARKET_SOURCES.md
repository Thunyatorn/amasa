# Celebrity market: source and model investigation

## Existing AI, verified locally

The existing `modelEnv()` configuration was queried at runtime without displaying credentials:

- Provider: `ollama`
- Planner: `qwen3.5:9b`
- Reader: `gemma4:latest`

The local Ollama `/api/tags` endpoint also lists both models. Celebrity extraction should reuse
`modelsFromEnv().reader`; availability of a model is not evidence of celebrity facts.

## Retrieval sources

### Wikidata

- Search: `https://www.wikidata.org/w/api.php?action=wbsearchentities&language=en&format=json&search=...`
- Entity JSON: `https://www.wikidata.org/wiki/Special:EntityData/Q....json`
- Access documentation: <https://www.wikidata.org/wiki/Wikidata:Data_access>
- User-Agent policy: <https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy>
- Structured data is CC0. Send an identifying bot User-Agent with a contact URL, use small
  requests, cache responses, honor `Retry-After`, and use `maxlag` on Action API requests.
- Names alone are insufficient for ambiguous matches. Require human entities and supporting
  labels/aliases and linked professional context. Keep uncertain matches unresolved.
- Distinguish a Wikidata statement from independent verification of its underlying reference.
  A statement's retrieval time is not its effective date or a new financial valuation.

### Wikipedia

- Intro/context API: `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|pageprops&explaintext=1&exintro=1&titles=...&format=json`
- Use the entity's actual sitelink, not a guessed page title; verify the returned Wikidata QID.
- Retain the article URL/revision and attribution. Wikipedia prose is CC BY-SA and secondary
  reporting, not a financial disclosure. Evidence quotations must come from retrieved text.
- Source claims are untrusted data for a tool-free model, never instructions for the worker.

### TMDB (optional authenticated adapter)

- <https://developer.themoviedb.org/docs/faq>
- <https://developer.themoviedb.org/docs/rate-limiting>
- Requires an API key/token. The developer API permits noncommercial use with attribution;
  commercial use requires the appropriate agreement. Display the required TMDB attribution
  when its data is enabled. Respect HTTP 429; the documented approximate upper threshold is
  not an application request budget.
- Prefer an evidenced TMDB identifier over fuzzy person-name matches.

### Financial publications and filings

SEC documentation requests returned HTTP 403 in this environment. Forbes and regulatory
filings must not be scraped around access restrictions or treated as available merely because
a citation URL exists. Retrieve permitted public documents before extracting their contents;
otherwise retain unknown/stale values. A company affiliation does not establish ownership,
nor does an issuer filing establish a celebrity's personal holdings without a matching disclosure.

Do not assume a free Google Trends, follower-count, Forbes, or social-platform API exists.
Implement supported adapters behind documented configuration, report unavailable providers,
and preserve real currencies, source dates, uncertainty, and evidence origin.
