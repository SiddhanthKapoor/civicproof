"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { cn } from "@/lib/utils";

export interface MapCase {
  id: string;
  lat: number;
  lng: number;
  status: string;
  title?: string;
}

export interface MapProject {
  id: string;
  name: string;
  geometry: GeoJSON.Geometry;
  /** Approximate alignment (e.g. traced from OpenStreetMap): drawn dashed. */
  approx?: boolean;
}

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
/** Served from /public (see scripts/copy-maplibre-worker.mjs). */
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

/** Case status → marker colour. Colour means state, so only a few are used. */
export const STATUS_COLOR: Record<string, string> = {
  reported: "#737987",
  investigating: "#8f5507",
  evidence_found: "#2542c8",
  case_prepared: "#2542c8",
  submitted: "#16181d",
  awaiting_response: "#16181d",
  resolved: "#17744a",
  closed: "#9aa0ab",
};

function tintBaseMap(map: MLMap) {
  const set = (layer: string, prop: string, value: unknown) => {
    if (map.getLayer(layer)) (map as unknown as { setPaintProperty: (l: string, p: string, v: unknown) => void }).setPaintProperty(layer, prop, value);
  };
  set("background", "background-color", "#efece5");
  set("water", "fill-color", "#d6dee6");
  set("park", "fill-color", "#e2e4d6");
  set("landcover_wood", "fill-color", "#e2e4d6");
  set("landuse_residential", "fill-color", "#ebe7de");
  set("building", "fill-color", "#e4e0d6");
  for (const l of ["highway_minor", "highway_major_inner", "highway_motorway_inner", "highway_major_subtle", "highway_motorway_subtle"]) set(l, "line-color", "#fbfaf6");
  for (const l of ["highway_major_casing", "highway_motorway_casing"]) set(l, "line-color", "#dcd7cb");
}

export function MapView({
  cases = [],
  projects = [],
  selectedCaseId,
  highlightProjectId,
  center,
  zoom = 12,
  onSelectCase,
  onPick,
  pick,
  fitToData = true,
  className,
  label = "Map",
}: {
  cases?: MapCase[];
  projects?: MapProject[];
  selectedCaseId?: string;
  highlightProjectId?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  onSelectCase?: (id: string) => void;
  /** Enables pin-dropping: click the map to choose a location. */
  onPick?: (p: { lat: number; lng: number }) => void;
  pick?: { lat: number; lng: number } | null;
  fitToData?: boolean;
  className?: string;
  label?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const handlers = useRef({ onSelectCase, onPick });
  useEffect(() => {
    handlers.current = { onSelectCase, onPick };
  });

  useEffect(() => {
    let cancelled = false;
    let map: MLMap | undefined;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !el.current) return;
      if (maplibre.getWorkerUrl() !== WORKER_URL) maplibre.setWorkerUrl(WORKER_URL);
      map = new maplibre.Map({
        container: el.current,
        style: STYLE_URL,
        center: center ? [center.lng, center.lat] : [77.5946, 12.9716],
        zoom,
        attributionControl: { compact: true },
        cooperativeGestures: false,
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", (e) => {
        if (String(e.error?.message ?? "").includes("style")) setFailed(true);
      });
      map.on("load", () => {
        if (!map) return;
        tintBaseMap(map);
        map.addSource("projects", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "project-casing", type: "line", source: "projects", paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 12], "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
        const lineColor = ["case", ["boolean", ["get", "hl"], false], "#2542c8", "#6f80d6"] as unknown as string;
        const lineWidth = ["interpolate", ["linear"], ["zoom"], 11, 2.2, 16, 7] as unknown as number;
        const lineOpacity = ["case", ["boolean", ["get", "hl"], false], 0.95, 0.7] as unknown as number;
        map.addLayer({
          id: "project-line",
          type: "line",
          source: "projects",
          filter: ["!", ["boolean", ["get", "approx"], false]],
          paint: { "line-color": lineColor, "line-width": lineWidth, "line-opacity": lineOpacity },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "project-line-approx",
          type: "line",
          source: "projects",
          filter: ["boolean", ["get", "approx"], false],
          paint: { "line-color": lineColor, "line-width": lineWidth, "line-opacity": lineOpacity, "line-dasharray": [1.6, 1.2] },
          layout: { "line-join": "round" },
        });
        map.addLayer({ id: "project-point", type: "circle", source: "projects", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 7, "circle-color": "#2542c8", "circle-opacity": 0.25, "circle-stroke-color": "#2542c8", "circle-stroke-width": 1.5 } });

        map.addSource("cases", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "case-halo", type: "circle", source: "cases", filter: ["boolean", ["get", "sel"], false], paint: { "circle-radius": 16, "circle-color": "#2542c8", "circle-opacity": 0.14 } });
        map.addLayer({
          id: "case-dot",
          type: "circle",
          source: "cases",
          paint: {
            "circle-radius": ["case", ["boolean", ["get", "sel"], false], 8, 6],
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        map.addSource("pick", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "pick-ring", type: "circle", source: "pick", paint: { "circle-radius": 14, "circle-color": "#2542c8", "circle-opacity": 0.15 } });
        map.addLayer({ id: "pick-dot", type: "circle", source: "pick", paint: { "circle-radius": 7, "circle-color": "#16181d", "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } });

        map.on("click", "case-dot", (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) handlers.current.onSelectCase?.(String(id));
        });
        map.on("mouseenter", "case-dot", () => (map!.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "case-dot", () => (map!.getCanvas().style.cursor = handlers.current.onPick ? "crosshair" : ""));
        map.on("click", (e: MapMouseEvent) => {
          if (!handlers.current.onPick) return;
          const hit = map!.queryRenderedFeatures(e.point, { layers: ["case-dot"] });
          if (hit.length) return;
          handlers.current.onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        });
        if (handlers.current.onPick) map.getCanvas().style.cursor = "crosshair";
        setReady(true);
      });
    })().catch(() => setFailed(true));
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // The map is created once; data updates flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data → sources.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("projects") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: projects.map((p) => ({ type: "Feature", geometry: p.geometry, properties: { id: p.id, name: p.name, hl: p.id === highlightProjectId, approx: Boolean(p.approx) } })),
    });
    (map.getSource("cases") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: cases.map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
        properties: { id: c.id, color: STATUS_COLOR[c.status] ?? "#737987", sel: c.id === selectedCaseId },
      })),
    });
    (map.getSource("pick") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: pick ? [{ type: "Feature", geometry: { type: "Point", coordinates: [pick.lng, pick.lat] }, properties: {} }] : [],
    });
  }, [ready, cases, projects, selectedCaseId, highlightProjectId, pick]);

  // Initial framing.
  const framed = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || framed.current || !fitToData) return;
    const pts: [number, number][] = [
      ...cases.map((c) => [c.lng, c.lat] as [number, number]),
      ...projects.flatMap((p) => coordsOf(p.geometry)),
      ...(pick ? [[pick.lng, pick.lat] as [number, number]] : []),
    ];
    if (pts.length === 0) return;
    framed.current = true;
    if (pts.length === 1) {
      map.jumpTo({ center: pts[0], zoom: Math.max(zoom, 15) });
      return;
    }
    const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 48, maxZoom: 16, duration: 0 });
  }, [ready, cases, projects, pick, fitToData, zoom]);

  // Fly to externally selected case / centre.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !center) return;
    map.easeTo({ center: [center.lng, center.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
  }, [ready, center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn("relative overflow-hidden bg-paper-2", className)} role="region" aria-label={label}>
      <div ref={el} className="!absolute inset-0 h-full w-full" />
      {!ready && !failed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[13px] text-ink-3">Loading map…</span>
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-xs text-[13px] text-ink-2">
            The map tiles could not be loaded. Coordinates are still shown as text, and every link below works without the map.
          </p>
        </div>
      )}
    </div>
  );
}

function coordsOf(g: GeoJSON.Geometry): [number, number][] {
  if (g.type === "Point") return [g.coordinates as [number, number]];
  if (g.type === "LineString") return g.coordinates as [number, number][];
  if (g.type === "MultiLineString") return (g.coordinates as [number, number][][]).flat();
  return [];
}
