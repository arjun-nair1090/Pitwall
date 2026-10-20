# Ask the Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new "Ask the data" page. A fan types a question ("Who had the best race pace at Spa 2024?", "Could Norris still have won the 2024 title after Austin?"). The answer comes only from the app's own deterministic analyses, called as tools by the language model, with every source listed and linked to its page.

**Architecture:**
- A new service, `data_assistant.py`, runs an Anthropic tool-use loop. The tools are thin wrappers over services that already exist: race results, race pace, overtakes and battles, championship odds, pit window and the season schedule.
- Each tool returns a condensed JSON summary. The model must answer from those results only.
- One POST endpoint returns the answer plus the list of tool calls made.
- The frontend is a new `/ask` module with a question box, suggested questions, the answer, and "Sources" links built from the tool inputs.
- The existing AI engineer (`ai_engineer.py`, live-session chat) is not touched. The user has uncommitted work on it.

**Tech Stack:** FastAPI, the `anthropic` SDK (already a dependency), pytest with a scripted fake client; Next.js 14, React 18, TypeScript, Tailwind, Vitest.

**Spec:** None. The user asked for an "ask-the-data assistant using deterministic endpoints as tools" (feature 8 of 8). The Definitions below are the authority.

## Definitions

**Client and model.**
- Use `Anthropic(api_key=settings.ANTHROPIC_API_KEY)` and model `settings.ANTHROPIC_MODEL`. Use the same placeholder check as `ai_engineer.py`: a key containing "your_anthropic" counts as unset.
- Send `output_config={"effort": "low"}` only when `llm_utils.supports_effort(model)`.
- `max_tokens = 2048`.
- With no usable key, the endpoint returns 503 with `The assistant isn't set up on this server (no Anthropic API key).`

**The loop.**
1. Send the system prompt, the conversation and the tool list.
2. While the response's `stop_reason == "tool_use"`, and for at most `MAX_TOOL_ROUNDS = 6` rounds:
   - run every `tool_use` block in that response, each through `asyncio.to_thread`;
   - append the assistant message and one user message carrying all the `tool_result` blocks;
   - call again.
3. When the rounds run out, make one final call with `tool_choice={"type": "none"}`, so the model must answer from what it has.

**Answer.** The answer is `llm_utils.extract_text(final_response)`. If it's empty, the answer is `Sorry, I couldn't put an answer together. Try rephrasing the question.`

**Tool failure.**
- A `SessionDataError`, `ChampionshipError`, `NoResultsError`, `ValueError` or `HTTPException` from a service becomes a `tool_result` with `is_error: true` and the service's own message. The model can then tell the user, for example "that race isn't available".
- Any other exception becomes `is_error: true` with `That analysis failed to load.` and is logged with `print`, as `_analysis_error` does.

**System prompt (verbatim intent, final wording at the implementer's discretion):**
- "You answer questions about Formula 1 using only the results of the tools provided. Never use outside knowledge for numbers, results or facts. If the tools can't answer, say so plainly."
- "Seasons 2018 onward. Telemetry-based tools (race pace, overtakes, pit window) only work for sessions this server has data for. If one returns an error, say that race isn't available here."
- "Keep answers under 150 words, in plain sentences, no tables. Name drivers by surname. Round times to 0.1 s unless a smaller gap matters."
- "Today's date is {date}," taken from `date.today()`.

**Tools.** Each has a JSON schema with `year` (integer), and `round`, `session` or `lap` where relevant. Each returns a condensed summary, never the raw payload, keeping each result under about 4,000 characters.

| Tool | Wraps | Condensed result |
|---|---|---|
| `season_schedule(year)` | `championship_data.load_season(year)`'s schedule frame | `[{round, name, date, sprint}]` |
| `race_result(year, round)` | `latest_result.race_results(year, round)` | top 10 plus DNFs: `[{position, code, team, points, status}]` |
| `championship_odds(year, after_round?)` | `championship_data.championship_odds` | `after_round`, the top 8 drivers `{code, points, title_probability, status}`, the top 4 constructors, and `points_available` |
| `race_pace(year, round, session)` | `race_pace.race_pace_payload(year, "", session, round)` | the ranked top 10 `{code, pace_gap_s, clean_laps}`, plus compound wear `{compound, deg_per_lap}` |
| `overtakes(year, round, session)` | `race_battles.race_battles_payload(year, "", session, round)` | `total_passes`, each driver's `{code, start_gain, made, lost}` (non-zero only), and the 5 longest battles |
| `pit_window(year, round, session, lap)` | `pit_window.pit_window_payload` (feature 1) | each driver's `{code, position, compound, tyre_age, status, window}`, plus undercuts |

- `session` is an enum of `"R"` and `"S"`, defaulting to `"R"`.
- Each tool's description says what it answers, for example "Who was fastest on race pace, fuel-corrected, and how fast each tyre compound wore."
- Results are passed as `json.dumps` text.

**Request and response.**
- **Request:** `POST /api/v1/ask` with body `{question: str (1–500 chars), history: [{role: "user"|"assistant", text: str}] (≤ 6 items)}`.
  - `history` lets a follow-up ("and at Silverstone?") work. Only text turns are replayed; tool calls are not.
- **Response:** `{answer: str, sources: [{tool, input, ok}]}`.
  - Sources are listed in call order, with duplicates (same tool and same input) dropped.
- **Validation:** a blank or over-long question is a 422.
- **Errors:**
  - an Anthropic API error becomes a 502 with `The assistant couldn't be reached. Try again shortly.`;
  - a rate limit becomes a 429 with `The assistant is busy. Try again in a minute.`

**Source links (frontend).**

| Tool | Link |
|---|---|
| `race_pace` | `/pace?year=&round=&session=` |
| `overtakes` | `/battles?year=&round=&session=` |
| `championship_odds` | `/championship?year=&round=` |
| `pit_window` | `/pitwindow?year=&round=&session=&lap=` |
| `race_result` | `/archive?year=` |
| `season_schedule` | none (no link) |

- **Labels:** "Race pace · 2024 round 14", "Overtakes · 2024 round 14", "Championship odds · 2024 after round 19", "Pit window · 2024 round 14, lap 20", "Result · 2024 round 14", "Calendar · 2024".
- A failed source (`ok: false`) is listed in `text-faint` with "(not available)".

**Rulings made in this plan:**
- **A1:** `ai_engineer.py` is untouched, because the user has uncommitted edits to it. The assistant is a separate service and page.
- **A2:** Anthropic only, with no OpenAI fallback. Tool use is the point, and the configured key is Anthropic.
- **A3:** no streaming. The answer arrives whole, and a spinner shows while tools run. Streaming tool loops through FastAPI adds complexity for little gain at about 5–15 s per answer.
- **A4:** no auth or rate limit beyond what `/ai/chat` has today, which is none. This is noted for the user as a cost risk on a public deployment.

## Global Constraints

- **Commits:** `git -c user.name="Arjun Nair" -c user.email=headhunter10900@gmail.com commit …`. No Co-Authored-By trailers, and never mention Claude or AI in commits or code comments.
  - User-facing copy may say "assistant". It must not name the model vendor.
- **Push:** after every commit, run `git push -q`, after checking that `git log -1 --format='%an <%ae> | %cn <%ce>'` shows only Arjun Nair.
- **Backend tests:** from `backend/`, run `SECRET_KEY=ci-test-secret-key RUNNING_LOCALLY=true python -m pytest -q -p no:cacheprovider` with the system python.
  - Tests never call the real API. Use a fake client whose `messages.create` returns scripted responses: objects with `.content` blocks (`type`, `text` / `id`, `name`, `input`) and `.stop_reason`.
- **Frontend checks:** from `frontend/`, run `npx vitest run`, `npx tsc --noEmit` and `node scripts/check-legacy.mjs --all`.
- **House style:**
  - sentence case;
  - `uppercase` only with `font-display`;
  - no `text-white`;
  - Tailwind tokens, never hex.
- **Axios mocks:** resolve `{ data: PAYLOAD }`, and the component reads `res.data`.
- **Main checkout:** never touch `C:\Users\arjun\f1-pitwall`. Its `.env` holds the real key. The controller alone uses it for the final real check.

## Review Focus

1. **A tool error mid-loop.** For example, a race not in the cache: the model gets `is_error` with the service's message and answers that the race isn't available. The endpoint must not return a 500.
2. **The model asks for a tool that doesn't exist, or sends bad input** (a missing year, or a string round). The result is `is_error` with `Unknown tool` or the validation message, and the loop continues.
3. **The round cap.** A model that keeps calling tools stops after 6 rounds, and the final call forces a text answer.
4. **No API key.** A 503 with the exact message, and the page shows it with no retry.
5. **Prompt injection through the question** ("ignore your rules and…"). The system prompt holds. Only tools are callable, and they're read-only. Tested by asserting that the tool list sent is exactly the six tools.

---

### Task 1: The assistant service and the endpoint

**Files:**
- Create: `backend/app/services/data_assistant.py`
- Modify: `backend/app/api/v1/endpoints.py`
- Test: `backend/app/tests/test_data_assistant.py`, plus endpoint tests in `backend/app/tests/test_analysis_endpoints.py`

**Interfaces:**
- **Consumes:** the services in the Tools table. Read each one's signature before wrapping it.
- **Produces:**
  - `TOOLS` (the Anthropic tool schemas).
  - `run_tool(name: str, args: dict) -> tuple[str, bool]`, returning the result text and an ok flag.
  - `async ask(question: str, history: list, client=None) -> dict`.
  - `POST /api/v1/ask`.

- [ ] **Step 1: Write the failing tests.** Use a `FakeClient` that records each `create(**kwargs)` call and returns scripted responses.
  - `test_answers_without_tools`: one text response gives the answer, with no sources.
  - `test_runs_a_tool_and_feeds_the_result_back`. Script a `tool_use` of `race_pace` (monkeypatched to return a fixed payload), then text. Assert:
    - the second call's messages end with a user message holding a `tool_result` for that `tool_use_id`;
    - its content is the condensed JSON;
    - `sources == [{tool: "race_pace", input: {...}, ok: True}]`.
  - `test_runs_every_tool_use_block_in_one_turn`.
  - `test_tool_error_is_reported_to_the_model_not_raised`: `SessionDataError("No data for that race.")` becomes `is_error` with that text, and `ok: False`.
  - `test_unknown_tool_and_bad_input_are_errors`.
  - `test_round_cap_forces_a_text_answer`: after 6 tool rounds, the next call has `tool_choice == {"type": "none"}`.
  - `test_tool_list_is_exactly_the_six_tools`.
  - `test_effort_sent_only_to_supporting_models`.
  - `test_history_is_replayed_as_text_turns`.
  - `test_duplicate_sources_are_dropped`.
  - One test per condenser, each asserting the shape and that the result is under 4,000 characters for a realistic payload. Use real-shaped fixtures, such as the payload builders in the existing tests.
  - Endpoint tests:
    - a 503 with no key;
    - a 422 for a blank question and for 501 characters;
    - a 200 shape;
    - an Anthropic `RateLimitError` becomes a 429;
    - an `APIError` becomes a 502;
    - neither leaks internals.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - The endpoint calls `await ask(...)`, with the client built per request from settings. This mirrors `ai_engineer`'s setup without importing `ai_engineer`.
  - Tool functions run in `asyncio.to_thread`.
- [ ] **Step 4: Run the full backend suite.**
- [ ] **Step 5: Commit and push**: `feat(ask): answer questions from the app's own analyses`.

### Task 2: The page

**Files:**
- Create:
  - `frontend/src/lib/ask.ts` and `.test.ts`;
  - `frontend/src/components/ask/AskPage.tsx` and `AskPage.test.tsx`, plus `fixtures.ts`;
  - `frontend/src/app/ask/page.tsx`.
- Modify: `frontend/src/lib/modules.ts` and its test.

**Interfaces:**
- **Consumes:** the response; `PageHeader`, `Panel`, `Button`, `ErrorState`.
- **Produces:**
  - `sourceLink(source): string | null`.
  - `sourceLabel(source): string`.
  - `AskPage()`.

- [ ] **Step 1: Write the failing tests.**
  - `sourceLink` and `sourceLabel` for each tool, per the Definitions tables. `season_schedule` has no link.
  - **The page:**
    - A textarea labelled "Your question", with a 500-character limit and a counter.
    - An "Ask" button, disabled when the question is blank or a request is running.
    - Pressing Enter submits, and Shift+Enter adds a new line.
    - Four suggested questions as buttons. Clicking one fills the box and asks it:
      - "Who had the best race pace at the 2024 Belgian Grand Prix?"
      - "How many on-track passes were there at Silverstone in 2022?"
      - "Could anyone still beat Verstappen to the 2024 title after round 19?"
      - "When should Norris have pitted at Spa in 2024?"
    - The conversation shows each question, then its answer (`whitespace-pre-wrap`), then a "Sources" list of links (Next `Link`), with the labels from `sourceLabel`.
    - Failed sources are faint, with "(not available)".
    - A follow-up sends the last 3 question-and-answer pairs as `history`.
    - While waiting, "Looking that up…" shows with a spinner, and `aria-live="polite"` is on the answer region.
    - On a 503, the message shows and the Ask button is disabled.
    - On a 429 or 502, the message shows as an inline error under the question, with the question kept for retry.
  - A fixed note under the box, verbatim: `"Answers come only from this app's own analyses, and each one lists its sources. The assistant can still misread a question, so check the linked page."`
  - **Module:** `{ id: "ask", label: "Ask the data", href: "/ask", group: "Analysis", icon: MessageSquareText }`, first in Analysis. Keep five `mobilePrimary` modules.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run vitest, tsc and check-legacy.**
- [ ] **Step 5: Commit and push**: `feat(ask): ask the data page`.

### Task 3: Changelog and real check

- [ ] **Step 1: Changelog and sweep.**
  - Add this item to the "Deeper analysis" changelog entry: `"Ask the data: type a question about any race or season and get an answer worked out only from the app's own analyses (race pace, overtakes, championship odds, pit windows and results), with links to every page it used."`
  - Add `/ask` to `frontend/scripts/ui-sweep.mjs`.
- [ ] **Step 2: Controller real check.** Run the scratch backend with the main checkout's `.env` key loaded into the environment only, never copied into the worktree. Ask the four suggested questions plus one question about an uncached race. Record:
  - the answers;
  - the sources;
  - the timings;
  - that every number in each answer appears in a tool result.

  Also check for:
  - no console errors at 390, 768 and 1280;
  - ui-sweep clean apart from known issues;
  - `next build` passing.
- [ ] **Step 3: Commit and push**: `docs(changelog): ask the data`.
