// Brave Search as an OpenCode 2 plugin tool.
//
// OpenCode 2 registers tools through plugins, not the old
// ~/.config/opencode/tools/ files, so this is a plugin. Drop it in
// ~/.config/opencode/plugins/ for every project, or .opencode/plugins/ for one.
//
// Requires BRAVE_API_KEY in the environment.

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search"

type BraveResult = {
  title?: string
  url?: string
  description?: string
  age?: string
  profile?: { name?: string }
}

type Input = {
  query: string
  count?: number
  freshness?: "pd" | "pw" | "pm" | "py"
}

export default {
  id: "brave-search",

  async setup(ctx: any) {
    await ctx.tool.transform((editor: any) => {
      editor.add({
        name: "brave",
        description:
          "Search the web using Brave Search. Returns a ranked list of titles, URLs and short snippets. Use this to discover sources; use the webfetch tool afterwards to read any result in full.",
        // Expose the tool directly rather than behind Code Mode's catalog, so
        // the model sees `brave` in its tool list.
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: 400,
              description: "Search query. Keep it under 50 words.",
            },
            count: {
              type: "integer",
              minimum: 1,
              maximum: 20,
              default: 10,
              description: "Number of results to return. Default 10, max 20.",
            },
            freshness: {
              type: "string",
              enum: ["pd", "pw", "pm", "py"],
              description:
                "Optional recency filter: pd = past day, pw = past week, pm = past month, py = past year. Omit for no time limit.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },

        async execute(args: Input, context: { signal?: AbortSignal }) {
          const key = process.env.BRAVE_API_KEY
          if (!key) {
            return { content: "BRAVE_API_KEY is not set in the environment." }
          }

          const url = new URL(ENDPOINT)
          url.searchParams.set("q", args.query)
          url.searchParams.set("count", String(args.count ?? 10))
          url.searchParams.set("text_decorations", "false")
          url.searchParams.set("result_filter", "web")
          if (args.freshness) url.searchParams.set("freshness", args.freshness)

          const signal = context.signal
            ? AbortSignal.any([context.signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000)

          let res: Response
          try {
            res = await fetch(url, {
              headers: {
                Accept: "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": key,
              },
              signal,
            })
          } catch (err) {
            return {
              content: `Brave search request failed: ${err instanceof Error ? err.message : String(err)}`,
            }
          }

          if (res.status === 401 || res.status === 403) {
            return { content: "Brave rejected the API key (401/403). Check BRAVE_API_KEY." }
          }
          if (res.status === 402 || res.status === 429) {
            return {
              content: [
                `Brave search is unavailable (HTTP ${res.status}): rate limit or monthly spend cap reached.`,
                "Do not retry this search and do not try a reworded version of it.",
                "Tell the user their Brave Search credit may be exhausted, and continue without web search.",
              ].join(" "),
            }
          }
          if (!res.ok) {
            const body = await res.text().catch(() => "")
            return { content: `Brave search failed with HTTP ${res.status}. ${body.slice(0, 300)}` }
          }

          let data: { web?: { results?: BraveResult[] } }
          try {
            data = await res.json()
          } catch {
            return { content: "Brave returned a response that could not be parsed as JSON." }
          }

          const results = data?.web?.results ?? []
          if (results.length === 0) {
            return { content: `No results for: ${args.query}` }
          }

          const lines = results.map((r, i) => {
            const source = r.profile?.name ? ` (${r.profile.name})` : ""
            const age = r.age ? ` [${r.age}]` : ""
            const snippet = (r.description ?? "").trim()
            return `${i + 1}. ${r.title ?? "Untitled"}${source}${age}\n   ${r.url ?? ""}\n   ${snippet}`
          })

          return { content: `Brave results for "${args.query}":\n\n${lines.join("\n\n")}` }
        },
      })
    })
  },
}
