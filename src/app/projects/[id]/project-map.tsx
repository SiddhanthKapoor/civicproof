"use client";

import dynamic from "next/dynamic";

const MapView = dynamic(() => import("@/components/map-view").then((m) => m.MapView), { ssr: false, loading: () => <div className="h-full w-full bg-paper-2" /> });

export function ProjectMap({
  project,
  cases,
}: {
  project: { id: string; name: string; geometry: GeoJSON.Geometry; approx?: boolean };
  cases: Array<{ id: string; lat: number; lng: number; status: string }>;
}) {
  return <MapView className="h-[300px]" projects={[project]} highlightProjectId={project.id} cases={cases} label={`Alignment of ${project.name}`} />;
}
