import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PaletteView from "./PaletteView";
import type { PaletteItem } from "./paletteItems";

const items: PaletteItem[] = [
  { id: "p:live", section: "Pages", label: "Live timing", href: "/live", keywords: ["race"] },
  { id: "p:map", section: "Pages", label: "Track map", href: "/map" },
  { id: "d:NOR", section: "Drivers", label: "Lando Norris", href: "/drivers/NOR", hint: "McLaren", keywords: ["NOR"] },
];

function setup(open = true) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  render(<PaletteView open={open} items={items} onClose={onClose} onSelect={onSelect} />);
  return { onClose, onSelect, user: userEvent.setup() };
}

describe("PaletteView", () => {
  it("renders nothing when closed", () => {
    setup(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("is a modal dialog with a focused combobox and a listbox", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Search" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });
  it("filters as you type", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("combobox"), "norr");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Lando NorrisMcLaren"]);
  });
  it("moves the active option with arrow keys and wraps", async () => {
    const { user } = setup();
    const box = screen.getByRole("combobox");
    const options = () => screen.getAllByRole("option");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options()[0].id);
    await user.keyboard("{ArrowDown}");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(options()[2]).toHaveAttribute("aria-selected", "true");
  });
  it("selects the active option with Enter", async () => {
    const { user, onSelect } = setup();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });
  it("selects an option on click", async () => {
    const { user, onSelect } = setup();
    await user.click(screen.getByRole("option", { name: /Lando Norris/ }));
    expect(onSelect).toHaveBeenCalledWith(items[2]);
  });
  it("closes on Escape", async () => {
    const { user, onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
  it("explains an empty result and gives direction", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("combobox"), "zzzz");
    expect(screen.getByRole("status")).toHaveTextContent(/No matches for “zzzz”/);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
  it("does nothing on Enter when there is no match", async () => {
    const { user, onSelect } = setup();
    await user.type(screen.getByRole("combobox"), "zzzz{Enter}");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
