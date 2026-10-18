import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PaceRanking from "./PaceRanking";
import { PACE } from "./fixtures";
import { formatLapTime } from "@/lib/timing";

const rows = () => screen.getAllByRole("row").slice(1);

describe("PaceRanking", () => {
  it("lists drivers in payload order, numbering only the ranked ones", () => {
    render(<PaceRanking drivers={PACE.drivers} />);
    const r = rows();
    expect(r).toHaveLength(4);
    expect(within(r[0]).getAllByRole("cell")[0]).toHaveTextContent("1");
    expect(within(r[0]).getAllByRole("cell")[1]).toHaveTextContent("NOR");
    expect(within(r[1]).getAllByRole("cell")[0]).toHaveTextContent("2");
    expect(within(r[2]).getAllByRole("cell")[0]).toHaveTextContent("—");
    expect(within(r[3]).getAllByRole("cell")[0]).toHaveTextContent("—");
  });

  it("shows pace, gap and clean laps", () => {
    render(<PaceRanking drivers={PACE.drivers} />);
    const [first, second, third] = rows();
    expect(first).toHaveTextContent(formatLapTime(106.3));
    expect(first).toHaveTextContent("Fastest");
    expect(first).toHaveTextContent("39");
    expect(second).toHaveTextContent("+0.312 s");
    expect(second).toHaveTextContent("37");
    expect(third).toHaveTextContent("2");
  });

  it("shows each stint as a compound badge with a spoken name", () => {
    render(<PaceRanking drivers={PACE.drivers} />);
    expect(screen.getByLabelText("Stint 1, Medium, +0.106 s/lap")).toHaveTextContent("M");
    expect(screen.getByLabelText("Stint 1, Hard, −0.012 s/lap")).toHaveTextContent("H");
  });

  it("draws an unknown compound as a question mark", () => {
    render(<PaceRanking drivers={PACE.drivers} />);
    expect(screen.getByLabelText("Stint 2, Unknown, —")).toHaveTextContent("?");
  });

  it("says how many drivers could not be ranked", () => {
    render(<PaceRanking drivers={PACE.drivers} />);
    expect(screen.getByText("2 drivers ran too few clean laps to compare with the field.")).toBeInTheDocument();
  });

  it("uses the singular for one driver, and says nothing for none", () => {
    const { rerender } = render(<PaceRanking drivers={PACE.drivers.slice(0, 3)} />);
    expect(screen.getByText("1 driver ran too few clean laps to compare with the field.")).toBeInTheDocument();
    rerender(<PaceRanking drivers={PACE.drivers.slice(0, 2)} />);
    expect(screen.queryByText(/too few clean laps/)).not.toBeInTheDocument();
  });
});
