import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import DataTable from "./DataTable";
import Input from "./Input";
import Select from "./Select";
import Tabs, { tabPanelProps } from "./Tabs";

describe("Select", () => {
  it("is labelled by a real label", () => {
    render(<Select label="Season"><option>2025</option></Select>);
    expect(screen.getByLabelText("Season")).toBeInTheDocument();
  });
  it("keeps the label for screen readers when visually hidden", () => {
    render(<Select label="Season" hideLabel><option>2025</option></Select>);
    expect(screen.getByLabelText("Season")).toBeInTheDocument();
    expect(screen.getByText("Season")).toHaveClass("sr-only");
  });
});

describe("Input", () => {
  it("links the hint and marks errors invalid", () => {
    render(<Input label="Password" hint="At least 8 characters" error="Too short" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Too short/);
    expect(screen.getByRole("alert")).toHaveTextContent("Too short");
  });
  it("is valid without an error", () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
  });
});

function Harness() {
  const [value, setValue] = useState("a");
  return (
    <>
      <Tabs
        label="View" idBase="t" value={value} onChange={setValue}
        tabs={[{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }]}
      />
      <div {...tabPanelProps("t", value)}>panel {value}</div>
    </>
  );
}

describe("Tabs", () => {
  it("selects with arrow keys, wraps, and supports Home/End", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true");
  });
  it("only the selected tab is in the tab order and it controls the panel", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Alpha");
  });
});

describe("DataTable", () => {
  const rows = [
    { code: "VER", time: "1:29.526" },
    { code: "NOR", time: "1:29.890" },
  ];
  const columns = [
    { key: "code", header: "Driver", cell: (r: (typeof rows)[number]) => r.code },
    { key: "time", header: "Best lap", align: "right" as const, cell: (r: (typeof rows)[number]) => r.time },
  ];
  it("is an accessible table with a caption and column headers", () => {
    render(<DataTable caption="Fastest laps" columns={columns} rows={rows} rowKey={(r) => r.code} />);
    expect(screen.getByRole("table", { name: "Fastest laps" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Driver", "Best lap"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
  it("draws the team spine on the first cell of each row", () => {
    render(<DataTable caption="c" columns={columns} rows={rows} rowKey={(r) => r.code} accent={() => "#FF8000"} />);
    // jsdom may serialise the colour as hex or rgb(); accept either.
    expect(screen.getByText("VER").closest("td")?.getAttribute("style")).toMatch(/inset 3px 0(px)? 0(px)? (#ff8000|rgb\(255, 128, 0\))/i);
    expect(screen.getByText("1:29.526").closest("td")?.getAttribute("style") ?? "").not.toMatch(/inset/);
  });
});
