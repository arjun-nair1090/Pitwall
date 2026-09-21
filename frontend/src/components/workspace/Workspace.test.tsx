import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import Workspace, { type WorkspacePanelDef } from "./Workspace";
import type { Layouts } from "@/lib/layoutStore";

function Chat() {
  const [text, setText] = useState("");
  return <input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} />;
}

const panels: WorkspacePanelDef[] = [
  { id: "a", title: "Race tower", render: () => <p>tower body</p> },
  { id: "b", title: "Race engineer", render: () => <Chat /> },
];
const defaults: Layouts = {
  lg: [{ i: "a", x: 0, y: 0, w: 6, h: 4 }, { i: "b", x: 6, y: 0, w: 6, h: 4 }],
  sm: [{ i: "a", x: 0, y: 0, w: 1, h: 4 }, { i: "b", x: 0, y: 4, w: 1, h: 4 }],
};

beforeEach(() => window.localStorage.clear());

describe("Workspace", () => {
  it("does not wipe a saved layout on mount, even under React StrictMode's double effects", () => {
    const saved = { v: 1, layouts: { lg: [{ i: "a", x: 6, y: 0, w: 6, h: 4 }, { i: "b", x: 0, y: 0, w: 6, h: 4 }], sm: defaults.sm } };
    window.localStorage.setItem("pitwall.layout.v1.t", JSON.stringify(saved));
    render(<StrictMode><Workspace name="t" panels={panels} defaults={defaults} /></StrictMode>);
    expect(JSON.parse(window.localStorage.getItem("pitwall.layout.v1.t")!).layouts.lg[0].x).toBe(6);
  });

  it("resets to the defaults only when resetKey changes", () => {
    const saved = { v: 1, layouts: { lg: [{ i: "a", x: 6, y: 0, w: 6, h: 4 }, { i: "b", x: 0, y: 0, w: 6, h: 4 }], sm: defaults.sm } };
    window.localStorage.setItem("pitwall.layout.v1.t", JSON.stringify(saved));
    const { rerender } = render(<StrictMode><Workspace name="t" panels={panels} defaults={defaults} resetKey={0} /></StrictMode>);
    expect(window.localStorage.getItem("pitwall.layout.v1.t")).not.toBeNull();
    rerender(<StrictMode><Workspace name="t" panels={panels} defaults={defaults} resetKey={1} /></StrictMode>);
    const after = window.localStorage.getItem("pitwall.layout.v1.t");
    // Reset clears the saved layout; RGL may then re-save the defaults it lays out.
    expect(after === null || JSON.parse(after).layouts.lg[0].x === 0).toBe(true);
  });

  it("renders every panel as a titled region", () => {
    render(<Workspace name="t" panels={panels} defaults={defaults} />);
    expect(screen.getByRole("region", { name: "Race tower" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Race engineer" })).toBeInTheDocument();
  });

  it("expands a panel full screen and closes it with Escape, restoring focus", async () => {
    const user = userEvent.setup();
    render(<Workspace name="t" panels={panels} defaults={defaults} />);
    const expand = screen.getByRole("button", { name: "Expand Race tower" });
    await user.click(expand);
    const dialog = screen.getByRole("dialog", { name: "Race tower" });
    expect(dialog).toHaveTextContent("tower body");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(expand).toHaveFocus();
  });

  it("keeps a panel's state when it is expanded and collapsed", async () => {
    const user = userEvent.setup();
    render(<Workspace name="t" panels={panels} defaults={defaults} />);
    await user.type(screen.getByLabelText("Message"), "box box");
    await user.click(screen.getByRole("button", { name: "Expand Race engineer" }));
    expect(screen.getByRole("dialog", { name: "Race engineer" })).toContainElement(screen.getByLabelText("Message"));
    expect(screen.getByLabelText("Message")).toHaveValue("box box");
    await user.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(screen.getByLabelText("Message")).toHaveValue("box box");
  });
});
