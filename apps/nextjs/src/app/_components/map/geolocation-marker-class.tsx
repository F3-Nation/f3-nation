/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The marker class renders the marker at the users position.
 * This takes care of the marker itself (optionally including the
 * device-heading) as well as the outer ring indicating the accuracy.
 *
 * The marker only interacts with the map-instance it is added to and
 * not with the geolocation or deviceorientation APIs (for those, see
 * geolocation-service.ts).
 *
 * Usage:
 *
 *     const marker = new GeolocationMarker();
 *     marker.setMap(myMap);
 *
 *     // when updated values are received from the
 *     // geolocation/deviceorientation APIs
 *     marker.position = {lat: geolocationLatitude, lng: geolocationLongitude};
 *     marker.accuracy = geolocationAccuracyMeters;
 *     marker.heading = compassHeading;
 *
 * The color can be customized using css-variables:
 *
 *     :root {
 *       --geolocation-marker-color: #ff0000;
 *     }
 */
export class GeolocationMarkerClass {
  // the svg-code for the main marker with the heading indicator
  static MARKER_SVG = `<?xml version="1.0" encoding="UTF-8" ?>
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="-16 -16 32 32">
    <circle r="5" fill="currentColor" />
    <circle r="6.5" stroke-width="1" stroke="currentColor" fill="none" />

    <style>.no-heading .heading-arrow { display: none; }</style>
    <path class="heading-arrow" d="M-3-9l3-5l3,5z" stroke="currentColor" stroke-linejoin="round" />
    </svg>
  `;

  // the OverlayView instance used to position and scale the marker on the map
  protected overlay: google.maps.OverlayView;

  protected rootEl!: HTMLDivElement;
  private iconSvgEl!: SVGSVGElement;
  private accuracyIndicator!: HTMLElement;

  private _position: google.maps.LatLngLiteral | null = null;
  private _heading: number | null = 0;
  private _size = 48;
  private _accuracy: number | null = null;
  private _drawScheduled: any;

  constructor() {
    try {
      this.overlay = new google.maps.OverlayView();
      this.overlay.onAdd = () => this.onAdd();
      this.overlay.onRemove = () => this.onRemove();
      this.overlay.draw = () => this.draw();
    } catch (err) {
      throw new Error(
        "Google Maps API has to be loaded before a marker can be created",
      );
    }
    this.createDomElements();
  }

  setMap(map: google.maps.Map | null) {
    this.overlay.setMap(map);
  }

  getMap(): google.maps.Map | null {
    return this.overlay.getMap() as any;
  }

  // property accessors for position, heading, accuracy and size

  set position(position: google.maps.LatLngLiteral | null) {
    this._position = position;
    this.scheduleDraw();
  }

  get position(): google.maps.LatLngLiteral | null {
    return this._position;
  }

  set heading(orientation: number | null) {
    this._heading = orientation;
    this.scheduleDraw();
  }

  get heading(): number | null {
    return this._heading;
  }

  set accuracy(accuracy: number | null) {
    this._accuracy = accuracy;
    this.scheduleDraw();
  }

  get accuracy(): number | null {
    return this._accuracy;
  }

  set size(size: number) {
    this._size = size;
    this.scheduleDraw();
  }

  get size(): number {
    return this._size;
  }

  /**
   * Called by the overlay when the marker is added to the map.
   */
  private onAdd() {
    const panes = this.overlay.getPanes()!;
    panes.overlayLayer.appendChild(this.rootEl);
  }

  /**
   * Redraws the marker. Called by the overlay instance.
   */
  private draw() {
    const projection = this.overlay.getProjection();
    if (!projection) return;

    this.rootEl.style.display = this._position === null ? "none" : "";
    if (!this._position) return;

    this.updateDomElements();
  }

  /**
   * Called by the overlay when the marker is removed from the map.
   */
  private onRemove() {
    this.rootEl.remove();
  }

  /**
   * Schedules a microtask to redraw the marker when any of the external
   * properties change. A microtask is used here to prevent multiple redraws
   * caused by updating multiple properties at once.
   */
  protected scheduleDraw() {
    if (this._drawScheduled) return;

    this._drawScheduled = true;
    queueMicrotask(() => {
      this._drawScheduled = false;
      this.overlay.draw();
    });
  }

  /**
   * creates the dom-elements for the marker in this.rootEl.
   * This is using inline-styles to be fully self-contained
   * (no external stylesheet needed).
   *
   * Structure:
   * <div class='geolocation-marker'>
   *   <div class='geolocation-marker__accuracy'></div>
   *   <svg>...</svg>
   * </div>
   */
  protected createDomElements() {
    this.rootEl = document.createElement("div");
    this.rootEl.className = "geolocation-marker";
    this.rootEl.style.cssText = `
      position: absolute; top: 0; left: 0;
      width: var(--size);
      height: var(--size);
      color: var(--geolocation-marker-color, #5a78fa);
    `;

    this.accuracyIndicator = document.createElement("div");
    this.accuracyIndicator.className = "geolocation-marker__accuracy";
    this.accuracyIndicator.style.cssText = `
      position: absolute; top: 50%; left: 50%;
      width: var(--accuracy); height: var(--accuracy);
      transform: translate(-50%, -50%);
      border: 1px solid currentColor;
      background: rgba(0,0,0,0.1);
      border-radius: 50%;
    `;
    this.rootEl.appendChild(this.accuracyIndicator);

    this.iconSvgEl = this.createIconSvgElement();
    this.iconSvgEl.style.cssText = `
      position: absolute; top: 0; left: 0; 
      width: 100%; height: 100%;
    `;

    this.rootEl.appendChild(this.iconSvgEl);
  }

  /**
   * creates the icon svg-element from the svg-code in MARKER_SVG.
   */
  protected createIconSvgElement() {
    const parser = new DOMParser();
    const svgDocument = parser.parseFromString(
      GeolocationMarkerClass.MARKER_SVG,
      "image/svg+xml",
    );

    return this.rootEl.ownerDocument.adoptNode(
      svgDocument.firstChild as SVGSVGElement,
    );
  }

  /**
   * Updates the dom-elements with the current values for position, size,
   * heading and accuracy.
   */
  protected updateDomElements() {
    this.updatePositionAndSize();
    this.updateCompassHeading();
    this.updateAccuracy();
  }

  protected updatePositionAndSize() {
    const projection = this.overlay.getProjection()!;
    const { x, y } = projection.fromLatLngToDivPixel(this._position)!;

    this.rootEl.style.setProperty("--size", this._size + "px");
    this.rootEl.style.transform = `translate(${x - this._size / 2}px, ${
      y - this._size / 2
    }px)`;
  }

  protected updateCompassHeading() {
    const hasHeading = this._heading !== null && !isNaN(this._heading);

    this.iconSvgEl.classList.toggle("no-heading", !hasHeading);
    this.iconSvgEl.style.transform = `rotate(${this._heading}deg)`;
  }

  protected updateAccuracy() {
    const projection = this.overlay.getProjection();

    if (!projection) return;

    const { lat } = this._position!;

    if (this._accuracy === null) {
      this.accuracyIndicator.style.display = "none";
      return;
    }

    const circumferenceAtLatitude = 40e6 * Math.cos(lat * (Math.PI / 180));
    const pxPerMeter = projection.getWorldWidth() / circumferenceAtLatitude;
    const diameterPx = 2 * this._accuracy * pxPerMeter;

    this.accuracyIndicator.style.display = diameterPx < 40 ? "none" : "";
    this.accuracyIndicator.style.setProperty("--accuracy", diameterPx + "px");
  }
}
