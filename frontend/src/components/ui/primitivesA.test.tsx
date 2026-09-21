import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Button, { buttonClass } from "./Button";
import EmptyState from "./EmptyState";
import IconButton from "./IconButton";
import PageHeader from "./PageHeader";
import Panel from "./Panel";
import Pill from "./Pill";
import { Loading } from "./Skeleton";

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });
  it("is disabled and busy while loading", () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
  });
  it("exposes its classes for links styled as buttons", () => {
    expect(buttonClass({ variant: "primary" })).toContain("bg-chalk");
    expect(buttonClass({ variant: "danger" })).toContain("bg-live");
  });
});

describe("IconButton", () => {
  it("is named by its label", () => {
    render(<IconButton label="Expand panel"><span aria-hidden>+</span></IconButton>);
    const b = screen.getByRole("button", { name: "Expand panel" });
    expect(b).toHaveAttribute("title", "Expand panel");
  });
  it("reports its pressed state", () => {
    render(<IconButton label="Mute" pressed><span aria-hidden>m</span></IconButton>);
    expect(screen.getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Panel", () => {
  it("is a region named by its title", () => {
    render(<Panel title="Race tower"><p>rows</p></Panel>);
    expect(screen.getByRole("region", { name: "Race tower" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Race tower" })).toBeInTheDocument();
  });
  it("renders meta and actions in the header", () => {
    render(<Panel title="T" meta="Lap 14/58" actions={<button>Go</button>}>x</Panel>);
    expect(screen.getByText("Lap 14/58")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });
});

describe("PageHeader", () => {
  it("renders exactly one h1", () => {
    render(<PageHeader title="Season stats" description="Standings" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("Loading", () => {
  it("announces itself politely with readable text", () => {
    render(<Loading label="Loading standings"><div /></Loading>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading standings");
  });
});

describe("EmptyState and Pill", () => {
  it("shows the title, description and action", () => {
    render(<EmptyState title="No races yet" description="Pick a season." action={<button>Change season</button>} />);
    expect(screen.getByText("No races yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change season" })).toBeInTheDocument();
  });
  it("renders pill text", () => {
    render(<Pill tone="green">Personal best</Pill>);
    expect(screen.getByText("Personal best")).toBeInTheDocument();
  });
});
