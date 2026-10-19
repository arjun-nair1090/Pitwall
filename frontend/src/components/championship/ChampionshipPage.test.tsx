import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChampionshipPage from "./ChampionshipPage";
import { CHAMPIONSHIP, SEASON_OVER } from "./fixtures";

vi.mock("axios");
const post = vi.mocked(axios.post);

const initial = { year: 2026, afterRound: null };

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: CHAMPIONSHIP });
});

describe("ChampionshipPage", () => {
  it("asks for the latest round of the chosen season", async () => {
    render(<ChampionshipPage initial={initial} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/championship/odds", { year: 2026, after_round: null });
    expect(await screen.findByText("Kimi Antonelli")).toBeInTheDocument();
  });

  it("asks for the round named in the link", async () => {
    render(<ChampionshipPage initial={{ year: 2025, afterRound: 9 }} />);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/championship/odds", { year: 2025, after_round: 9 }));
    await screen.findByText("Kimi Antonelli");
  });

  it("says what it is doing while it simulates", () => {
    post.mockReturnValue(new Promise(() => {}));
    render(<ChampionshipPage initial={initial} />);
    expect(
      screen.getByText("Simulating the rest of the season… The first time a season is opened this can take up to a minute."),
    ).toBeInTheDocument();
  });

  it("offers every season from 2018 to the current year, newest first", async () => {
    render(<ChampionshipPage initial={initial} />);
    const years = within(screen.getByLabelText("Season")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    const current = new Date().getFullYear();
    expect(years[0]).toBe(String(current));
    expect(years.at(-1)).toBe("2018");
    expect(years).toHaveLength(current - 2017);
    await screen.findByText("Kimi Antonelli");
  });

  it("fills the round picker from the response", async () => {
    render(<ChampionshipPage initial={initial} />);
    await screen.findByText("Kimi Antonelli");
    const picker = screen.getByLabelText("After round");
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "After round 16: Italian Grand Prix", "After round 17: Singapore Grand Prix",
    ]);
    expect(picker).toHaveValue("17");
  });

  it("asks again for a round the viewer picks", async () => {
    const user = userEvent.setup();
    render(<ChampionshipPage initial={initial} />);
    await screen.findByText("Kimi Antonelli");
    await user.selectOptions(screen.getByLabelText("After round"), "16");
    await waitFor(() => expect(post).toHaveBeenLastCalledWith("/api/v1/championship/odds", { year: 2026, after_round: 16 }));
  });

  it("goes back to the latest round when the season changes", async () => {
    const user = userEvent.setup();
    render(<ChampionshipPage initial={{ year: 2026, afterRound: 9 }} />);
    await screen.findByText("Kimi Antonelli");
    await user.selectOptions(screen.getByLabelText("Season"), "2024");
    await waitFor(() => expect(post).toHaveBeenLastCalledWith("/api/v1/championship/odds", { year: 2024, after_round: null }));
  });

  it("never shows the previous season's numbers while the next one loads", async () => {
    const user = userEvent.setup();
    render(<ChampionshipPage initial={initial} />);
    await screen.findByText("Kimi Antonelli");
    post.mockReturnValue(new Promise(() => {}));
    await user.selectOptions(screen.getByLabelText("Season"), "2024");
    await waitFor(() => expect(screen.queryByText("Kimi Antonelli")).not.toBeInTheDocument());
  });

  it("names the simulation count, the caveat and the three panels", async () => {
    render(<ChampionshipPage initial={initial} />);
    await screen.findByText("Kimi Antonelli");
    expect(screen.getByText("10,000 simulations")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Each remaining race and sprint is simulated 10,000 times from every driver's finishing positions this season, weighted towards recent races, with their own retirement rate. It knows nothing about upgrades, grid penalties or team orders.",
      ),
    ).toBeInTheDocument();
    for (const name of ["Drivers' title odds", "Constructors' title odds", "Races still to run"]) {
      expect(screen.getByRole("heading", { name, level: 2 })).toBeInTheDocument();
    }
    expect(screen.getByText("Up to 166 points still available to each driver")).toBeInTheDocument();
  });

  it("crowns the champion and says the season is over", async () => {
    post.mockResolvedValue({ data: SEASON_OVER });
    render(<ChampionshipPage initial={initial} />);
    expect(await screen.findByText("Champion")).toBeInTheDocument();
    expect(screen.getByText("The season is over.")).toBeInTheDocument();
  });

  it("shows a 404's message with no retry button", async () => {
    post.mockRejectedValue({ response: { status: 404, data: { detail: "No races have been run in 2026 yet." } } });
    render(<ChampionshipPage initial={initial} />);
    expect(await screen.findByText("No races have been run in 2026 yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("offers a retry for any other failure", async () => {
    post.mockRejectedValue({ response: { status: 500, data: { detail: "The mirror is down." } } });
    render(<ChampionshipPage initial={initial} />);
    expect(await screen.findByText("The mirror is down.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
