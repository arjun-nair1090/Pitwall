import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
