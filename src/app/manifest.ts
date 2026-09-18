import type { MetadataRoute } from "next";

/** Web app manifest: CivicProof installs to the home screen and opens like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CivicProof",
    short_name: "CivicProof",
    description: "Report a damaged road in Bengaluru and get an evidence-backed case: the project, the contractor, the records, and a complaint you can send.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f6f4ef",
    theme_color: "#f6f4ef",
    lang: "en-IN",
    categories: ["government", "utilities", "news"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Report an issue", short_name: "Report", url: "/report?source=pwa", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Cases", url: "/cases?source=pwa", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
