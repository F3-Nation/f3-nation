import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WorkoutCard } from "@/components/workout-card";
import type { Workout } from "@/types/region";

const makeWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: "workout-1",
  regionId: "region-1",
  name: "Hammer Time",
  time: "5:30 AM - 6:15 AM",
  type: "Bootcamp",
  types: ["Bootcamp", "Running"],
  group: "thursday",
  notes: null,
  latitude: null,
  longitude: null,
  location: "Central Park",
  city: null,
  state: null,
  zip: null,
  country: null,
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("WorkoutCard", () => {
  it("renders the workout name as a heading", () => {
    render(<WorkoutCard workout={makeWorkout()} />);

    const heading = screen.getByRole("heading", {
      level: 3,
      name: "Hammer Time",
    });
    expect(heading.textContent).toBe("Hammer Time");
  });

  it("renders the day group and the time", () => {
    render(<WorkoutCard workout={makeWorkout()} />);

    expect(screen.getByText("thursday")).toBeInTheDocument();
    expect(screen.getByText("5:30 AM - 6:15 AM")).toBeInTheDocument();
  });

  it("renders each workout type as a badge", () => {
    render(<WorkoutCard workout={makeWorkout()} />);

    expect(screen.getByText("Bootcamp")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("falls back to the single type when the types list is empty", () => {
    render(<WorkoutCard workout={makeWorkout({ types: [] })} />);

    expect(screen.getByText("Bootcamp").textContent).toBe("Bootcamp");
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("links to Google Maps by coordinates when they are available", () => {
    render(
      <WorkoutCard
        workout={makeWorkout({ latitude: 40.7812, longitude: -73.9665 })}
      />,
    );

    const link = screen.getByRole("link", { name: /Central Park/ });
    expect(link.getAttribute("href")).toBe(
      "https://www.google.com/maps?q=40.7812,-73.9665",
    );
  });

  it("falls back to a location search link when coordinates are missing", () => {
    render(<WorkoutCard workout={makeWorkout()} />);

    const link = screen.getByRole("link", { name: /Central Park/ });
    expect(link.getAttribute("href")).toBe(
      "https://www.google.com/maps/search/Central%20Park",
    );
  });

  it("omits the location link when there is no location", () => {
    render(<WorkoutCard workout={makeWorkout({ location: "" })} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders notes when present", () => {
    render(<WorkoutCard workout={makeWorkout({ notes: "Bring a gift" })} />);

    expect(screen.getByText("Notes:").textContent).toBe("Notes:");
    expect(screen.getByText("Bring a gift").textContent).toContain(
      "Bring a gift",
    );
  });

  it("omits the notes section when notes are null", () => {
    render(<WorkoutCard workout={makeWorkout({ notes: null })} />);

    expect(screen.queryByText("Notes:")).toBeNull();
  });
});
