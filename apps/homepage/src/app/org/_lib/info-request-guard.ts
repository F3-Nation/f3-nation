/**
 * Coordinates which in-flight sidebar request is allowed to update the info
 * panel. Org and location details load asynchronously; whichever selection is
 * current when a fetch resolves is the only one permitted to render, so a
 * late-resolving request from a previous selection can't overwrite the panel.
 *
 * Org and location selections are mutually exclusive — selecting one clears the
 * other, matching the panel which shows either an org or a location, never both.
 */
export class InfoRequestGuard {
  private orgId: number | null = null;
  private locationId: number | null = null;
  private pinnedOrgId: number | null = null;

  /**
   * Mark `id` as the active org selection. Clears any location selection.
   * Returns `true` when this is a switch to a different org, so callers can
   * reset org-derived UI (e.g. the nearest-admin fallback).
   */
  selectOrg(id: number): boolean {
    const changed = this.orgId !== id;
    this.orgId = id;
    this.locationId = null;
    return changed;
  }

  /** Mark `id` as the active location selection. Clears any org selection. */
  selectLocation(id: number): void {
    this.locationId = id;
    this.orgId = null;
  }

  /**
   * Mark `id` as the org whose location pins are shown.
   *
   * Switching to a new org's pins invalidates any pending location request, so
   * a late-resolving one from the previously-viewed org can't populate the
   * sidebar after the switch.
   *
   * Re-fanning the current org's pins (e.g. on map zoom) preserves any active
   * or in-flight location selection.
   *
   * Returns `true` when switching to a different org, `false` when re-fanning
   * the same org.
   */
  showPinsForOrg(id: number): boolean {
    const changed = this.pinnedOrgId !== id;
    this.pinnedOrgId = id;
    if (changed) {
      this.locationId = null;
    }
    return changed;
  }

  /** Clear the pinned org tracking (e.g. when pins are hidden). */
  clearPins(): void {
    this.pinnedOrgId = null;
  }

  /**
   * Switching the map to a new org's location pins must invalidate any pending
   * location request, so a late-resolving one from the previously-viewed org
   * can't populate the sidebar after the switch. The org selection is left
   * intact — the panel keeps showing the current org until a pin is chosen.
   */
  clearLocation(): void {
    this.locationId = null;
  }

  isOrgCurrent(id: number): boolean {
    return this.orgId === id;
  }

  isLocationCurrent(id: number): boolean {
    return this.locationId === id;
  }
}
