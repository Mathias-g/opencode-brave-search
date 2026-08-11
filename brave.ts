import { tool } from "@opencode-ai/plugin"

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search"

export default tool({
  description:
    "Search the web using Brave Search. Returns a ranked list of titles, URLs and short snippets. Use this to discover sources; use the webfetch tool afterwards to read any result in full.",
  args: {
    query: tool.schema
      .string()
      .min(1)
      .max(400)
      .describe("Search query. Keep it under 50 words."),
    count: tool.schema
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Number of results to return. Default 10, max 20."),
    freshness: tool.schema
      .enum(["pd", "pw", "pm", "py"])
      .optional()
      .describe(
        "Optional recency filter: pd = past day, pw = past week, pm = past month, py = past year. Omit for no time limit.",
      ),
  },
  async execute(args) {
    const key = process.env.BRAVE_API_KEY
    if (!key) {
      return "BRAVE_API_KEY is not set in the environment."
    }

    const url = new URL(ENDPOINT)
    url.searchParams.set("q", args.query)
    url.searchParams.set("count", String(args.count ?? 10))
    url.searchParams.set("text_decorations", "false")
    url.searchParams.set("result_filter", "web")
    if (args.freshness) url.searchParams.set("freshness", args.freshness)

    let res
    try {
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": key,
        },
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      return `Brave search request failed: ${err instanceof Error ? err.message : String(err)}`
    }

    if (res.status === 401 || res.status === 403) {
      return "Brave rejected the API key (401/403). Check BRAVE_API_KEY."
    }
    if (res.status === 402 || res.status === 429) {
      return [
        `Brave search is unavailable (HTTP ${res.status}): rate limit or monthly spend cap reached.`,
        "Do not retry this search and do not try a reworded version of it.",
        "Tell the user their Brave Search credit may be exhausted, and continue without web search.",
      ].join(" ")
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return `Brave search failed with HTTP ${res.status}. ${body.slice(0, 300)}`
    }

    let data
    try {
      data = await res.json()
    } catch {
      return "Brave returned a response that could not be parsed as JSON."
    }

    const results = data?.web?.results ?? []
    if (results.length === 0) {
      return `No results for: ${args.query}`
    }

    const lines = results.map((r: any, i: number) => {
      const source = r.profile?.name ? ` (${r.profile.name})` : ""
      const age = r.age ? ` [${r.age}]` : ""
      const snippet = (r.description ?? "").trim()
      return `${i + 1}. ${r.title ?? "Untitled"}${source}${age}\n   ${r.url ?? ""}\n   ${snippet}`
    })

    return `Brave results for "${args.query}":\n\n${lines.join("\n\n")}`
  },
})
