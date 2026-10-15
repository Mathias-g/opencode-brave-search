# Brave search plugin for opencode

An OpenCode 2 plugin that adds a web search tool backed by the Brave Search API.

OpenCode's own `websearch` tool routes through Exa's hosted service and is only available on the opencode provider or with `OPENCODE_ENABLE_EXA` set. This one calls Brave directly, works on any provider, and returns a compact result list instead of a full API response object.

It is a single file with no dependencies.

## A note on the tool's name

The tool is called `brave`.

OpenCode 2 ships its own `websearch` tool, so this plugin registers a distinct name and the two can coexist. The name is set by the `name` field inside the plugin, not by the filename, so rename the file freely.

You do not need to tell the model to use the `brave` tool. Models select tools from their descriptions, so a request that calls for a web search will reach for it on its own.

---

## Install

**1. Get a Brave Search API key**

Sign up at [api-dashboard.search.brave.com](https://api-dashboard.search.brave.com) and generate a subscription token under API Keys.

Brave's API is metered and requires a card at signup, so check [the pricing page](https://brave.com/search/api/) for current rates. Set a monthly spend cap in the dashboard so requests past your limit fail with an error instead of billing you. This tool handles that failure cleanly (see Errors below).

*As of mid-2026: the old zero-cost plan was removed in February 2026 and replaced with $5 in monthly credits, roughly 1,000 queries at $5 per thousand requests, with the credit conditional on publicly attributing Brave. Treat these figures as a snapshot.*

**2. Drop the file in place**

OpenCode 2 discovers plugins under a `plugins/` directory, not the old `tools/` directory.

```sh
mkdir -p ~/.config/opencode/plugins
cp brave.ts ~/.config/opencode/plugins/brave.ts
```

That installs it for every project. Use `.opencode/plugins/brave.ts` inside a project instead to scope it to that project only.

There is no dependency to install. The plugin is a plain default export with no imports.

**3. Store the key as an environment variable** *(systemd Linux)*

An environment variable is a named value your login session hands to every program it starts. The plugin looks up `BRAVE_API_KEY` when it runs, so the key never gets written into the plugin or into any file you'd commit.

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

**4. Verify**

From a project directory, not your home directory:

```sh
opencode run "list every tool you have available, names only"
```

`brave` should be in the list. If it isn't, the file isn't loading: check the path. OpenCode does not log tool loading errors, so the tool list is the only signal you get.

Once it's listed:

```sh
opencode run "use the brave tool to search for: brave search api pricing"
```

Output starting with `Brave results for "..."` means it's working. A message about `BRAVE_API_KEY` not being set means step 3 hasn't taken effect yet, which usually means a reboot is still needed.

Changes to a plugin file are picked up when OpenCode reloads; a restart of the service is the reliable way to be sure.

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
2. The model calls `brave`, choosing how many results it wants via the `count` argument (1 to 20, or 10 if it doesn't say). Each result comes back as a title, URL, and one-line snippet, so ten of them is roughly 1,200 tokens
3. The model picks the one or two URLs that look right
4. `webfetch` pulls those pages as markdown and reads them in full
5. The model answers from the retrieved text

Nothing wires the two together in code. They're independent tools, and the model chains them because the tool description tells it to. The description ends with "use the webfetch tool afterwards to read any result in full", which is what nudges it toward step 4 rather than answering from snippets alone. If you rewrite that description, keep the pointer.

**Why split it this way.** The alternative is a search tool that fetches and inlines page content itself, which is what Brave's `brave_llm_context` endpoint and Exa's search both do. That approach costs several thousand tokens per search whether or not any given result turns out to be useful. Splitting it means you pay around 1,200 tokens to see what's out there and only pay full page cost for the pages actually worth reading.

The tradeoff is an extra round trip. Snippet-only search means the model sometimes has to fetch before it can tell whether a result answers the question.

**Practical notes on `webfetch`:**

- It needs permission. If it's prompting or refusing, set it in your opencode config:
  ```json
  { "permissions": [{ "action": "webfetch", "resource": "*", "effect": "allow" }] }
  ```
- It has a 5MB response ceiling and errors with "Response too large" past that.
- Cloudflare and similar bot protection will block some fetches. When one fails, the snippet from search is still in context.

**Models sometimes skip search entirely.** If a model already knows a likely URL, it will often go straight to `webfetch`. Asking for "the latest opencode release" gets you a direct fetch of the GitHub API, no search involved. This is model behaviour, not a problem with the tool. If it bothers you, an `AGENTS.md` line like "prefer the brave tool over webfetch when you don't have a specific URL" is the lever.

---

## Why this instead of the Brave MCP server

The official Brave MCP server exposes eight tools (web, news, local, place, image, video, summarizer, llm_context). All eight schemas are injected into every request. Measured with `tools/list`: **111,105 characters** of tool definitions for the full set, against **5,645** for the same server whitelisted to web search alone. That one tool carries fifteen parameters by itself.

This plugin exposes three arguments and one schema, and it prunes the response before returning it. Two request parameters do most of that work:

- `text_decorations=false` stops Brave wrapping matched terms in `<strong>` tags
- `result_filter=web` drops the query-analysis and infobox blocks from the payload

The remaining fields are formatted down to title, source, age, URL, and snippet. A raw Brave result object carries a dozen more fields including nested `meta_url` and `thumbnail` objects.

Measured on the same query, `count=10`:

| | Tool schema (all tools) | Per search call |
| --- | --- | --- |
| Brave MCP, all 8 tools | 111,105 chars | 13,442 chars |
| Brave MCP, whitelisted to web search | 5,645 chars | 13,442 chars |
| This plugin | one tool, three arguments | 3,763 chars |

The per-call figure is roughly 3.5x smaller than the MCP server's, and the fixed cost drops from eight schemas to one small one. Whitelisting only affects the fixed column; it doesn't change what a search returns, since it's the same `brave_web_search` tool being invoked either way.

To reproduce any of these:

```sh
# this plugin's per-call output
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
  "servers": {
    "brave-search": {
      "type": "local",
      "command": ["npx", "-y", "@brave/brave-search-mcp-server"],
      "environment": {
        "BRAVE_API_KEY": "...",
        "BRAVE_MCP_ENABLED_TOOLS": "brave_web_search"
      }
    }
  }
}
```

---

## Errors

Every failure returns as a string rather than throwing, so the model sees a readable message and can tell you what went wrong.

| Condition | Behaviour |
| --- | --- |
| `BRAVE_API_KEY` unset | Says so; check step 3 |
| 401 / 403 | Key rejected, or subscription inactive |
| 402 / 429 | Rate limit or spend cap hit. Explicitly instructs the model not to retry or reword, so a dead key doesn't burn queries in a loop |
| Other non-2xx | Status code plus the first 300 chars of the body |
| Network failure or 15s timeout | Returns the error message |
| Zero results | `No results for: <query>` |

---

## Tweaks

**Different name.** Change the `name` field in the tool definition; the filename doesn't matter. Avoid built-in tool names.

**Show it in Code Mode instead of directly.** The tool sets `options: { codemode: false }`, which puts `brave` straight in the model's tool list. Remove that line to let OpenCode 2 fold it into the Code Mode catalog instead.

**Result count.** The model can already ask for anything from 1 to 20 per search; 10 is only what it uses when it doesn't specify. To steer that per query without touching the code, put a line in your `AGENTS.md`, for example "use count 20 for research questions and count 5 for quick lookups".

To change the default itself, edit the `default: 10` in the `count` property. Dropping it to 5 roughly halves per-call tokens and is plenty for a targeted question. The `maximum: 20` is Brave's own ceiling, and quality falls off well before that.

**Region and language.** Brave defaults to `US` and `en`. Add `url.searchParams.set("country", "DK")` and `search_lang` next to the other params if you want different defaults. Hardcode them rather than exposing them as arguments, since every argument costs schema tokens.

**Trim the output further.** Drop `source` and `age` from the template in the `lines.map` block. `profile.name` is often just the domain repeated, so it may not earn its tokens.
