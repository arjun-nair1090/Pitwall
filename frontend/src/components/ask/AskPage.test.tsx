import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AskPage from "./AskPage";
import { ASK_ANSWER } from "./fixtures";

vi.mock("axios");
const post = vi.mocked(axios.post);

const NOTE = "Answers come only from this app's own analyses, and each one lists its sources. The assistant can still misread a question, so check the linked page.";
const failure = (status: number, detail: string) => ({ response: { status, data: { detail } } });
const box = () => screen.getByLabelText("Your question") as HTMLTextAreaElement;
const askButton = () => screen.getByRole("button", { name: "Ask" });

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: ASK_ANSWER });
});

describe("AskPage", () => {
  it("has a labelled box with a 500 character limit and counter, and the fixed note", () => {
    render(<AskPage />);
    expect(box()).toHaveAttribute("maxlength", "500");
    expect(screen.getByText("0/500")).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "hello" } });
    expect(screen.getByText("5/500")).toBeInTheDocument();
  });

  it("disables Ask while the question is blank", () => {
    render(<AskPage />);
    expect(askButton()).toBeDisabled();
    fireEvent.change(box(), { target: { value: "   " } });
    expect(askButton()).toBeDisabled();
    fireEvent.change(box(), { target: { value: "Who won?" } });
    expect(askButton()).toBeEnabled();
  });

  it("posts the question, then shows it with its answer and linked sources", async () => {
    render(<AskPage />);
    fireEvent.change(box(), { target: { value: "Who had the best pace?" } });
    fireEvent.click(askButton());
    expect(post).toHaveBeenCalledWith("/api/v1/ask", { question: "Who had the best pace?", history: [] });
    expect(await screen.findByText(ASK_ANSWER.answer)).toHaveClass("whitespace-pre-wrap");
    expect(screen.getByRole("region", { name: "Who had the best pace?" })).toBeInTheDocument();
    expect(box().value).toBe("");
    const pace = screen.getByRole("link", { name: "Race pace · 2024 round 14" });
    expect(pace).toHaveAttribute("href", "/pace?year=2024&round=14&session=R");
    expect(screen.getByText("Calendar · 2024")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Calendar/ })).toBeNull();
    const failed = screen.getByText(/Overtakes · 2024 round 14/);
    expect(failed).toHaveClass("text-faint");
    expect(failed).toHaveTextContent("(not available)");
    expect(screen.queryByRole("link", { name: /Overtakes/ })).toBeNull();
  });

  it("submits on Enter and adds a line on Shift+Enter", async () => {
    const user = userEvent.setup();
    render(<AskPage />);
    await user.type(box(), "one{Shift>}{Enter}{/Shift}two");
    expect(box().value).toBe("one\ntwo");
    expect(post).not.toHaveBeenCalled();
    await user.type(box(), "{Enter}");
    expect(post).toHaveBeenCalledWith("/api/v1/ask", { question: "one\ntwo", history: [] });
  });

  it("does not submit on Enter while an input method is composing", () => {
    render(<AskPage />);
    fireEvent.change(box(), { target: { value: "Verstappen" } });
    fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(box(), { key: "Enter", keyCode: 229 });
    expect(post).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("repeats the full question in the body, as the panel title is cut to one line", async () => {
    const question = "Across the whole 2024 season, " + "which driver gained the most places at the start ".repeat(5) + "?";
    render(<AskPage />);
    fireEvent.change(box(), { target: { value: question } });
    fireEvent.click(askButton());
    await screen.findByText(ASK_ANSWER.answer);
    const exchange = screen.getByRole("region", { name: question.trim() });
    const body = Array.from(exchange.querySelectorAll("p")).find((p) => p.textContent === question.trim());
    expect(body).toBeDefined();
    expect(body).not.toHaveClass("truncate");
  });

  it("trims a long earlier answer to 2000 characters when sending it as history", async () => {
    const user = userEvent.setup();
    const long = "a".repeat(2500);
    post.mockResolvedValueOnce({ data: { answer: long, sources: [] } });
    render(<AskPage />);
    await user.type(box(), "q1{Enter}");
    await screen.findByText(long);
    await user.type(box(), "q2{Enter}");
    const history = (post.mock.calls[1][1] as { history: { role: string; text: string }[] }).history;
    expect(history).toEqual([{ role: "user", text: "q1" }, { role: "assistant", text: "a".repeat(2000) }]);
  });

  it("asks a suggested question when it is clicked", async () => {
    render(<AskPage />);
    const suggestions = [
      "Who had the best race pace at the 2024 Belgian Grand Prix?",
      "How many on-track passes were there at Silverstone in 2022?",
      "Could anyone still beat Verstappen to the 2024 title after round 19?",
      "When should Norris have pitted at Spa in 2024?",
    ];
    for (const q of suggestions) expect(screen.getByRole("button", { name: q })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: suggestions[3] }));
    expect(post).toHaveBeenCalledWith("/api/v1/ask", { question: suggestions[3], history: [] });
    expect(await screen.findByText(ASK_ANSWER.answer)).toBeInTheDocument();
  });

  it("sends only the last three question and answer pairs as history", async () => {
    const user = userEvent.setup();
    render(<AskPage />);
    for (let i = 1; i <= 5; i++) {
      post.mockResolvedValueOnce({ data: { answer: `answer ${i}`, sources: [] } });
      await user.type(box(), `q${i}{Enter}`);
      await screen.findByText(`answer ${i}`);
    }
    expect(post.mock.calls[0][1]).toEqual({ question: "q1", history: [] });
    expect(post.mock.calls[4][1]).toEqual({
      question: "q5",
      history: [
        { role: "user", text: "q2" }, { role: "assistant", text: "answer 2" },
        { role: "user", text: "q3" }, { role: "assistant", text: "answer 3" },
        { role: "user", text: "q4" }, { role: "assistant", text: "answer 4" },
      ],
    });
  });

  it("shows a spinner and a polite live region while waiting", async () => {
    let resolve: (v: unknown) => void = () => {};
    post.mockReturnValueOnce(new Promise((r) => (resolve = r)) as never);
    render(<AskPage />);
    fireEvent.change(box(), { target: { value: "Who won?" } });
    fireEvent.click(askButton());
    expect(screen.getByText("Looking that up…")).toBeInTheDocument();
    expect(askButton()).toBeDisabled();
    const live = screen.getByText("Looking that up…").closest("[aria-live]");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveAttribute("aria-relevant", "additions");
    resolve({ data: ASK_ANSWER });
    await waitFor(() => expect(screen.queryByText("Looking that up…")).toBeNull());
  });

  it("shows the server's message on a 503 and disables Ask", async () => {
    const msg = "The assistant isn't set up on this server (no Anthropic API key).";
    post.mockRejectedValueOnce(failure(503, msg));
    render(<AskPage />);
    fireEvent.change(box(), { target: { value: "Who won?" } });
    fireEvent.click(askButton());
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(askButton()).toBeDisabled();
    fireEvent.change(box(), { target: { value: "Another" } });
    expect(askButton()).toBeDisabled();
  });

  it.each([
    [429, "The assistant is busy. Try again in a minute."],
    [502, "The assistant couldn't be reached. Try again shortly."],
  ])("shows a %i inline and keeps the question for a retry", async (status, detail) => {
    post.mockRejectedValueOnce(failure(status, detail));
    render(<AskPage />);
    fireEvent.change(box(), { target: { value: "Who won?" } });
    fireEvent.click(askButton());
    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(box().value).toBe("Who won?");
    expect(askButton()).toBeEnabled();
    fireEvent.click(askButton());
    expect(await screen.findByText(ASK_ANSWER.answer)).toBeInTheDocument();
    expect(screen.queryByText(detail)).toBeNull();
  });

  it("asks a signed-out visitor to log in, and keeps the question", async () => {
    post.mockRejectedValueOnce(failure(401, "Not authenticated"));
    render(<AskPage />);
    fireEvent.change(box(), { target: { value: "Who won?" } });
    fireEvent.click(askButton());
    expect(await screen.findByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByText("Not authenticated")).toBeNull();
    expect(box().value).toBe("Who won?");
  });

  it("falls back to a generic message when the server gives no detail", async () => {
    post.mockRejectedValueOnce(new Error("network"));
    render(<AskPage />);
    fireEvent.change(box(), { target: { value: "Who won?" } });
    fireEvent.click(askButton());
    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
  });

  it("never names the model vendor or AI in its copy", () => {
    render(<AskPage />);
    expect(document.body.textContent).not.toMatch(/anthropic|claude|\bAI\b/i);
  });
});
