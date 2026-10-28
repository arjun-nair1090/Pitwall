"use client";

import axios from "axios";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, type KeyboardEvent } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import {
  MAX_HISTORY_TEXT,
  MAX_QUESTION,
  sourceLabel,
  sourceLink,
  type AskResponse,
  type AskSource,
  type AskTurn,
} from "@/lib/ask";

const NOTE =
  "Answers come only from this app's own analyses, and each one lists its sources. The assistant can still misread a question, so check the linked page.";

const SUGGESTIONS = [
  "Who had the best race pace at the 2024 Belgian Grand Prix?",
  "How many on-track passes were there at Silverstone in 2022?",
  "Could anyone still beat Verstappen to the 2024 title after round 19?",
  "When should Norris have pitted at Spa in 2024?",
];

const HISTORY_PAIRS = 3;
const FALLBACK_ERROR = "Something went wrong. Try again.";

interface Exchange {
  question: string;
  answer: string;
  sources: AskSource[];
}

// The server's own wording for a refusal ("busy", "couldn't be reached", "not set up") is the message.
function failureOf(err: unknown): { status: number | null; message: string } {
  const response = (err as { response?: { status?: number; data?: { detail?: unknown } } } | null)?.response;
  const detail = response?.data?.detail;
  return { status: response?.status ?? null, message: typeof detail === "string" && detail ? detail : FALLBACK_ERROR };
}

function historyOf(exchanges: Exchange[]): AskTurn[] {
  return exchanges.slice(-HISTORY_PAIRS).flatMap((e): AskTurn[] => [
    { role: "user", text: e.question.slice(0, MAX_HISTORY_TEXT) },
    { role: "assistant", text: e.answer.slice(0, MAX_HISTORY_TEXT) },
  ]);
}

// Ask a question in plain English; the answer comes only from the app's own analyses, with sources.
export default function AskPage() {
  const [text, setText] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const ask = async (raw: string) => {
    const question = raw.trim();
    if (!question || pending !== null || unavailable) return;
    setPending(question);
    setError(null);
    setSignedOut(false);
    try {
      const res = await axios.post<AskResponse>("/api/v1/ask", { question, history: historyOf(exchanges) });
      setExchanges((prev) => [...prev, { question, answer: res.data.answer, sources: res.data.sources }]);
      setText("");
    } catch (err) {
      const { status, message } = failureOf(err);
      if (status === 503) setUnavailable(true);
      if (status === 401) setSignedOut(true);
      else setError(message);
    } finally {
      setPending(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter also confirms a word in an input method (Japanese, Chinese, Korean); that isn't a submit.
    // Safari reports such an Enter as keyCode 229 rather than isComposing.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void ask(text);
    }
  };

  const suggest = (question: string) => {
    setText(question);
    void ask(question);
  };

  const blocked = unavailable || pending !== null || text.trim() === "";

  return (
    <>
      <PageHeader
        title="Ask the data"
        description="Ask a question in plain English. The assistant looks it up in this app's own analyses and shows which ones it used."
      />
      <Panel title="Ask a question" className="mb-4">
        <div className="flex flex-col gap-3 p-4">
          <label htmlFor="ask-question" className="sr-only">
            Your question
          </label>
          <textarea
            id="ask-question"
            value={text}
            maxLength={MAX_QUESTION}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="For example: who had the best race pace at Spa in 2024?"
            className="w-full resize-y rounded-control border border-edge bg-kerb p-3 text-sm text-chalk placeholder:text-faint focus:border-chalk focus:outline-none"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-faint tabular-nums">
              {text.length}/{MAX_QUESTION}
            </span>
            <Button variant="primary" onClick={() => void ask(text)} disabled={blocked}>
              Ask
            </Button>
          </div>
          {signedOut && (
            <p role="alert" className="text-sm text-live-text">
              <Link href="/login" className="underline underline-offset-2">
                Log in
              </Link>{" "}
              to ask a question.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-live-text">
              {error}
            </p>
          )}
          <p className="text-xs text-faint">{NOTE}</p>
        </div>
      </Panel>

      {exchanges.length === 0 && pending === null && (
        <Panel title="Try asking" className="mb-4">
          <div className="flex flex-wrap gap-2 p-4">
            {SUGGESTIONS.map((q) => (
              <Button key={q} size="sm" disabled={unavailable} onClick={() => suggest(q)} className="h-auto py-2 text-left font-normal">
                {q}
              </Button>
            ))}
          </div>
        </Panel>
      )}

      <div aria-live="polite" aria-relevant="additions" className="flex flex-col gap-4">
        {exchanges.map((e, i) => (
          <Panel key={i} title={e.question}>
            <div className="p-4">
              <p className="mb-3 whitespace-pre-wrap text-sm text-mute">{e.question}</p>
              <p className="whitespace-pre-wrap text-sm text-chalk">{e.answer}</p>
              {e.sources.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-1 text-xs font-semibold text-mute">Sources</h3>
                  <ul className="flex flex-col gap-1 text-sm">
                    {e.sources.map((s, j) => (
                      <SourceItem key={j} source={s} />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Panel>
        ))}
        {pending !== null && (
          <Panel title={pending}>
            <div className="p-4">
              <p className="mb-3 whitespace-pre-wrap text-sm text-mute">{pending}</p>
              <p className="flex items-center gap-2 text-sm text-mute">
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                Looking that up…
              </p>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}

function SourceItem({ source }: { source: AskSource }) {
  const label = sourceLabel(source);
  if (!source.ok) {
    return <li className="text-faint">{label} (not available)</li>;
  }
  const href = sourceLink(source);
  return (
    <li className="text-mute">
      {href ? (
        <Link href={href} className="text-chalk underline-offset-2 hover:underline">
          {label}
        </Link>
      ) : (
        label
      )}
    </li>
  );
}
