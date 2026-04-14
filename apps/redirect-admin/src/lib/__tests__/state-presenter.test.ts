import { describe, it, expect } from "vitest";

import { presentLifecycleState } from "../state-presenter";
import type { LifecycleState } from "../state-presenter";

describe("presentLifecycleState", () => {
  const ALL_STATES: LifecycleState[] = [
    "pending",
    "awaiting_dns_challenge",
    "validating",
    "provisioning_cert",
    "awaiting_probe",
    "awaiting_cutover",
    "active",
    "degraded",
    "tombstoned",
    "quarantined",
    "released",
  ];

  it.each(ALL_STATES)("returns a populated view model for %s", (state) => {
    const presented = presentLifecycleState(state);
    expect(presented.state).toBe(state);
    expect(presented.label.length).toBeGreaterThan(0);
    expect(presented.description.length).toBeGreaterThan(10);
    expect(["info", "warning", "error", "success"]).toContain(
      presented.variant,
    );
  });

  it("marks awaiting_dns_challenge with an actionable CTA", () => {
    const p = presentLifecycleState("awaiting_dns_challenge");
    expect(p.actionable).toBeDefined();
    expect(p.actionable?.button).toBe("View DNS Records");
    expect(p.variant).toBe("warning");
  });

  it("marks awaiting_cutover as success with CTA", () => {
    const p = presentLifecycleState("awaiting_cutover");
    expect(p.variant).toBe("success");
    expect(p.actionable?.button).toBe("View Cutover Instructions");
  });

  it("marks active as success with no CTA", () => {
    const p = presentLifecycleState("active");
    expect(p.variant).toBe("success");
    expect(p.actionable).toBeUndefined();
  });

  it("marks degraded as error and folds reconciler error into description", () => {
    const p = presentLifecycleState("degraded", {
      drift_kind: "cert_missing",
      resource_name: "dns-auth-foo",
    });
    expect(p.variant).toBe("error");
    expect(p.description).toContain("dns-auth-foo");
    expect(p.description).toContain("cert_missing");
    expect(p.actionable?.button).toBe("View Recovery Steps");
  });

  it("degraded without an error payload still renders", () => {
    const p = presentLifecycleState("degraded");
    expect(p.variant).toBe("error");
    expect(p.description).toContain("unknown");
  });

  it("marks quarantined as error", () => {
    const p = presentLifecycleState("quarantined");
    expect(p.variant).toBe("error");
  });

  it("marks pending as info without actionable", () => {
    const p = presentLifecycleState("pending");
    expect(p.variant).toBe("info");
    expect(p.actionable).toBeUndefined();
  });

  it("returns stable label wording for snapshot stability", () => {
    // Lock a few labels so UI layouts can rely on them without
    // re-approving a snapshot on every minor tweak.
    expect(presentLifecycleState("awaiting_dns_challenge").label).toBe(
      "Awaiting DNS Challenge",
    );
    expect(presentLifecycleState("awaiting_probe").label).toBe(
      "Awaiting Health Probe",
    );
    expect(presentLifecycleState("released").label).toBe("Released");
  });
});
