# Brave search tool for opencode

A custom opencode tool that adds web search backed by the Brave Search API.

opencode's own `websearch` tool routes through Exa's hosted service and is only available on the opencode provider or with `OPENCODE_ENABLE_EXA` set. This one calls Brave directly, works on any provider, and returns a compact result list instead of a full API response object.

It is a single file with no dependencies beyond `@opencode-ai/plugin`.

## A note on the tool's name

The tool is called `brave`, not `websearch`.

`websearch` is reserved. A custom tool with that name is silently dropped: it never appears in the tool list, and nothing is written to the log. This holds whether the file sits in `~/.config/opencode/tools/`, a project's `.opencode/tools/`, or is registered through the plugin API, and it holds with Exa both enabled and disabled. Verified on opencode 1.18.16.

opencode's docs state that a custom tool with the same name as a built-in takes precedence. That is not true for `websearch` on this version. Don't spend time on it; name the file something else.

You do not need to tell the model to use the `brave` tool. Models select tools from their descriptions, so a request that calls for a web search will reach for it on its own.

---

## Install

**1. Get a Brave Search API key**

Sign up at [api-dashboard.search.brave.com](https://api-dashboard.search.brave.com) and generate a subscription token under API Keys.

Brave's API is metered and requires a card at signup, so check [the pricing page](https://brave.com/search/api/) for current rates. Set a monthly spend cap in the dashboard so requests past your limit fail with an error instead of billing you. This tool handles that failure cleanly (see Errors below).

*As of mid-2026: the old zero-cost plan was removed in February 2026 and replaced with $5 in monthly credits, roughly 1,000 queries at $5 per thousand requests, with the credit conditional on publicly attributing Brave. Treat these figures as a snapshot.*

**2. Drop the file in place**

```sh
mkdir -p ~/.config/opencode/tools
cp brave.ts ~/.config/opencode/tools/brave.ts
```

The filename becomes the tool name, so `brave.ts` creates a `brave` tool. Rename it to whatever you like, avoiding the names of built-in tools.

Use `.opencode/tools/brave.ts` inside a project instead if you want it scoped to that project only.

**3. Check the plugin dependency**

The tool imports `@opencode-ai/plugin`, which opencode installs from a `package.json` in your config directory at startup.

```sh
cat ~/.config/opencode/package.json
opencode --version
```

The two versions should match. If the file doesn't exist, or the pin is behind your opencode version:

```sh
cd ~/.config/opencode
npm install @opencode-ai/plugin@latest
```

**4. Store the key as an environment variable** *(systemd Linux)*

An environment variable is a named value your login session hands to every program it starts. The tool looks up `BRAVE_API_KEY` when it runs, so the key never gets written into the tool or into any file you'd commit.

This step uses `environment.d`, which is a systemd feature. It works on Ubuntu 22.04 and later, and equally on Fedora, Debian 12+, Arch, and other current systemd distros. It does not apply to macOS or Windows, or to non-systemd distros like Alpine, Void, or Gentoo on OpenRC.

The part that makes GUI apps inherit the variable is your desktop session running under `systemd --user`, which is the default for GNOME and KDE. If you start your session with `startx` or a bare window manager outside systemd, GUI launches won't pick it up and you'd need the shell rc route instead.

```sh
mkdir -p ~/.config/environment.d
echo 'BRAVE_API_KEY=your-key-here' > ~/.config/environment.d/brave.conf
```

Only `your-key-here` needs replacing. One `KEY=VALUE` per line, value unquoted, and the filename must end in `.conf`.

systemd merges every `.conf` in that directory, so this leaves any existing ones alone. Note that `>` overwrites `brave.conf` itself, so if you later add other variables to that file, don't re-run the command.

**You will probably need to reboot.** The session environment is built at login, so `systemctl --user daemon-reload` won't do it and neither will relaunching the app. Logging out and back in is supposed to be enough, but in practice it wasn't: on Ubuntu with GNOME the variable only showed up after a full restart. Try the logout first, and reboot if `echo $BRAVE_API_KEY` still comes back empty.

This covers everything your desktop session starts: apps launched from the apps menu, pinned AppImages, terminals you open, and opencode run inside them. It does not cover SSH or TTY logins, which bypass the session manager; add `export BRAVE_API_KEY="..."` to your `~/.zshrc` if you need those.

**5. Verify**

From a project directory, not your home directory:

```sh
opencode run "list every tool you have available, names only"
```

`brave` should be in the list. If it isn't, the file isn't loading: check the path and the plugin dependency from step 3. opencode does not log tool loading errors, so the tool list is the only signal you get.

Once it's listed:

```sh
opencode run "use the brave tool to search for: brave search api pricing"
```

Output starting with `Brave results for "..."` means it's working. A message about `BRAVE_API_KEY` not being set means step 4 hasn't taken effect yet, which usually means a reboot is still needed.

---

## Usage

You don't call the tool directly. Ask normally and the model decides when to search:

```
> what changed in Vite 7's build defaults
> find me recent writing on RAG chunking strategies
```

The model can pass three arguments:

| Argument | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | required | Max 400 chars |
| `count` | int 1-20 | 10 | Each result costs roughly 60-80 tokens |
| `freshness` | `pd` \| `pw` \| `pm` \| `py` | none | Past day / week / month / year |

Output looks like this:

```
Brave results for "vite 7 build defaults":

1. Vite 7.0 Release (vite.dev) [2 weeks ago]
   https://vite.dev/blog/announcing-vite7
   Vite 7 raises the default browser target and drops the legacy...

2. ...
```

---

## How it works with `webfetch`

This tool deliberately does only half the job. It handles **discovery**: given a question, find candidate URLs. It does not handle **retrieval**: getting the actual text of a page. That second half is opencode's built-in `webfetch`, and the two are meant to be used as a pair.

A typical exchange looks like:

1. You ask something the model can't answer from training data
2. `brave` returns however many results `count` is set to, 10 by default, as titles, URLs, and one-line snippets. At the default that's roughly 1,200 tokens
3. The model picks the one or two URLs that look right
4. `webfetch` pulls those pages as markdown and reads them in full
5. The model answers from the retrieved text

Nothing wires the two together in code. They're independent tools, and the model chains them because the tool description tells it to. The description ends with "use the webfetch tool afterwards to read any result in full", which is what nudges it toward step 4 rather than answering from snippets alone. If you rewrite that description, keep the pointer.

**Why split it this way.** The alternative is a search tool that fetches and inlines page content itself, which is what Brave's `brave_llm_context` endpoint and Exa's search both do. That approach costs several thousand tokens per search whether or not any given result turns out to be useful. Splitting it means you pay around 1,200 tokens to see what's out there and only pay full page cost for the pages actually worth reading.

The tradeoff is an extra round trip. Snippet-only search means the model sometimes has to fetch before it can tell whether a result answers the question.

**Practical notes on `webfetch`:**

- It needs permission. If it's prompting or refusing, set it in your opencode config:
  ```json
  { "permission": { "webfetch": "allow" } }
  ```
- It has a 5MB response ceiling and errors with "Response too large" past that.
- Cloudflare and similar bot protection will block some fetches. When one fails, the snippet from search is still in context.

**Models sometimes skip search entirely.** If a model already knows a likely URL, it will often go straight to `webfetch`. Asking for "the latest opencode release" gets you a direct fetch of the GitHub API, no search involved. This is model behaviour, not a problem with the tool. If it bothers you, an `AGENTS.md` line like "prefer the brave tool over webfetch when you don't have a specific URL" is the lever.

---

## Why this instead of the Brave MCP server

The official Brave MCP server exposes eight tools (web, news, local, place, image, video, summarizer, llm_context). All eight schemas are injected into every request: 110,955 characters of tool definitions, against 5,640 for the single web search tool. That one tool carries fifteen parameters by itself.

This tool exposes three arguments and one schema, and it prunes the response before returning it. Two request parameters do most of that work:

- `text_decorations=false` stops Brave wrapping matched terms in `<strong>` tags
- `result_filter=web` drops the query-analysis and infobox blocks from the payload

The remaining fields are formatted down to title, source, age, URL, and snippet. A raw Brave result object carries a dozen more fields including nested `meta_url` and `thumbnail` objects. Measured on a 10-result response, this tool's output was roughly a third the size of what the MCP server returns for the same query.

Measured on opencode 1.18.16:

| | Fixed per request | Per search call |
| --- | --- | --- |
| Brave MCP, all 8 tools | 9,879 | ~4,200 |
| Brave MCP, whitelisted to web search | 1,674 | ~4,200 |
| This tool | 222 | ~1,200 |

All three fixed-cost figures are real context tokens on opencode 1.18.16, measured by sending one word in a fresh session and reading the counter, with and without each configuration. Baseline was 13,556; adding the MCP server whitelisted to one tool took it to 15,230, and with all eight tools to 23,435. The custom tool adds 222.

Whitelisting only affects the fixed column. It doesn't change what a search returns, since it's the same `brave_web_search` tool being invoked either way.

The MCP per-call figure is measured too, by calling `brave_web_search` directly over stdio: 16,682 characters against 4,773 for the same query through this tool, so roughly 3.5x. Worth noting the server does trim: Brave's raw JSON for that query was 71,661 characters, so most of the bloat is removed before it reaches the model.

Whitelisting removes about 83% of the MCP server's fixed cost, so the seven tools you probably don't want account for most of it. Even so, the whitelisted server still costs 7.5x what the custom tool does, because the MCP transport and the tool's fifteen parameters carry weight the two-argument version doesn't.

A note on method, since it matters: sizing schemas by counting characters on the wire and dividing by four does not work. That approach gave 27,700 for the eight-tool case against a real 9,879, and 1,410 for the whitelisted case against a real 1,674. Wrong in both directions. Only the in-session token counter gives numbers worth quoting.

To reproduce any of these:

```sh
# this tool's per-call output
curl -s --compressed -H "Accept: application/json" \
  -H "X-Subscription-Token: $BRAVE_API_KEY" \
  "https://api.search.brave.com/res/v1/web/search?q=YOUR+QUERY&count=10&text_decorations=false&result_filter=web" \
  | jq -r '.web.results | to_entries[] | "\(.key+1). \(.value.title)\n   \(.value.url)\n   \(.value.description)"' \
  | wc -c

# the MCP server's per-call output (needs Node 20+)
BRAVE_API_KEY=$BRAVE_API_KEY npx -y @brave/brave-search-mcp-server --transport stdio << 'EOF' | wc -c
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"brave_web_search","arguments":{"query":"YOUR QUERY","count":10}}}
EOF
```

Swap `tools/call` for `tools/list` to size the schemas instead; that one costs no Brave credit. Divide characters by about four for a token estimate.

If you'd rather keep the MCP server, you can cut most of the fixed cost without any code by whitelisting a single tool:

```json
"mcp": {
  "brave-search": {
    "type": "local",
    "command": ["npx", "-y", "@brave/brave-search-mcp-server"],
    "environment": {
      "BRAVE_API_KEY": "...",
      "BRAVE_MCP_ENABLED_TOOLS": "brave_web_search"
    }
  }
}
```

---

## Errors

Every failure returns as a string rather than throwing, so the model sees a readable message and can tell you what went wrong.

| Condition | Behaviour |
| --- | --- |
| `BRAVE_API_KEY` unset | Says so; check step 4 |
| 401 / 403 | Key rejected, or subscription inactive |
| 402 / 429 | Rate limit or spend cap hit. Explicitly instructs the model not to retry or reword, so a dead key doesn't burn queries in a loop |
| Other non-2xx | Status code plus the first 300 chars of the body |
| Network failure or 15s timeout | Returns the error message |
| Zero results | `No results for: <query>` |

---

## Tweaks

**Different name.** Rename the file and the tool renames with it. Avoid built-in tool names.

**Fewer results.** The default is 10. Dropping `.default(10)` to 5 roughly halves per-call tokens and is usually plenty for a targeted question. The `.max(20)` is Brave's own ceiling; quality falls off well before that.

**Region and language.** Brave defaults to `US` and `en`. Add `url.searchParams.set("country", "DK")` and `search_lang` next to the other params if you want different defaults. Hardcode them rather than exposing them as arguments, since every argument costs schema tokens.

**Trim the output further.** Drop `source` and `age` from the template in the `lines.map` block. `profile.name` is often just the domain repeated, so it may not earn its tokens.
