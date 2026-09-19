"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/schemas";
import { Button, Card, Eyebrow } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COARSE_FIX_M, GeolocationFailure, describeAccuracy, geolocationErrorMessage, getDeviceLocation } from "@/lib/geo";
import { saveOwnerKey } from "@/lib/use-owner-key";

const MapView = dynamic(() => import("@/components/map-view").then((m) => m.MapView), { ssr: false });

type LocationSource = "photo_exif" | "device" | "map_pin" | "geocoded";

interface PreparedPhoto {
  id: string;
  name: string;
  previewUrl: string;
  blob: Blob;
  originalSha256: string;
  width: number;
  height: number;
  exif: { takenAt?: string; lat?: number; lng?: number; make?: string; model?: string };
}

const MAX_EDGE = 2000;
const TODAY = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST calendar date

async function sha256(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads EXIF, hashes the original, and re-encodes to ≤2000px JPEG (strips EXIF from the upload). */
async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const buf = await file.arrayBuffer();
  const originalSha256 = await sha256(buf);
  const exif: PreparedPhoto["exif"] = {};
  try {
    const exifr = (await import("exifr")).default;
    const tags = await exifr.parse(buf, { gps: true, pick: ["DateTimeOriginal", "CreateDate", "Make", "Model", "latitude", "longitude"] });
    if (tags) {
      const dt: Date | undefined = tags.DateTimeOriginal ?? tags.CreateDate;
      if (dt instanceof Date && !isNaN(dt.getTime())) exif.takenAt = dt.toISOString();
      if (typeof tags.latitude === "number" && typeof tags.longitude === "number") {
        exif.lat = Math.round(tags.latitude * 1e6) / 1e6;
        exif.lng = Math.round(tags.longitude * 1e6) / 1e6;
      }
      if (tags.Make) exif.make = String(tags.Make).slice(0, 60);
      if (tags.Model) exif.model = String(tags.Model).slice(0, 60);
    }
  } catch {
    /* no EXIF */
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.86));
  return { id: originalSha256.slice(0, 12), name: file.name, previewUrl: URL.createObjectURL(blob), blob, originalSha256, width: w, height: h, exif };
}

function Field({ label, hint, error, children, htmlFor, optional }: { label: string; hint?: string; error?: string; children: React.ReactNode; htmlFor?: string; optional?: boolean }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-3 text-[14px] font-medium text-ink">
        {label}
        {optional && <span className="text-[12px] font-normal text-ink-3">Optional</span>}
      </label>
      {hint && <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p>}
      <div className="mt-2">{children}</div>
      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 text-[13px] text-contradicted" role="alert">
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

const input =
  "w-full rounded-xl border border-rule-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/10 aria-[invalid=true]:border-contradicted";

function Section({ n, title, children, aside }: { n: number; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="grid gap-6 border-t border-rule py-8 md:grid-cols-[220px_1fr] md:gap-10">
      <div>
        <p className="font-mono text-[12px] text-ink-3">{String(n).padStart(2, "0")}</p>
        <h2 className="mt-1 font-serif text-[22px] leading-tight">{title}</h2>
        {aside && <div className="mt-2 text-[13px] leading-relaxed text-ink-3">{aside}</div>}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function ReportForm() {
  const router = useRouter();
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [jobCode, setJobCode] = useState("");
  const [category, setCategory] = useState<Category>("pothole");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [locSource, setLocSource] = useState<LocationSource>("map_pin");
  const [address, setAddress] = useState("");
  const [observedOn, setObservedOn] = useState(TODAY());
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ label: string; full: string; lat: number; lng: number }>>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  /** The device's own estimate of how precise its fix was, in metres. Only set for a device fix. */
  const [accuracyM, setAccuracyM] = useState<number | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const exifPhoto = photos.find((p) => p.exif.lat !== undefined);
  const exifDate = photos.find((p) => p.exif.takenAt)?.exif.takenAt;

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reverse-geocode the pin to a readable address (debounced).
  useEffect(() => {
    if (!pin || locSource === "geocoded") return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/geocode?lat=${pin.lat}&lng=${pin.lng}`);
        if (r.ok) {
          const d = await r.json();
          if (d.label) setAddress(d.label);
        }
      } catch {
        /* address stays editable */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [pin, locSource]);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setPhotoBusy(true);
    setErrors((e) => ({ ...e, photos: "" }));
    try {
      const next: PreparedPhoto[] = [];
      for (const f of Array.from(list).slice(0, 4 - photos.length)) {
        if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) {
          setErrors((e) => ({ ...e, photos: `"${f.name}" isn't a photo. Use JPEG, PNG or WebP.` }));
          continue;
        }
        if (f.size > 25 * 1024 * 1024) {
          setErrors((e) => ({ ...e, photos: `"${f.name}" is over 25 MB.` }));
          continue;
        }
        try {
          next.push(await preparePhoto(f));
        } catch {
          setErrors((e) => ({ ...e, photos: `"${f.name}" couldn't be read. HEIC photos may need converting to JPEG first.` }));
        }
      }
      setPhotos((p) => [...p, ...next]);
      const withGps = next.find((p) => p.exif.lat !== undefined);
      if (withGps && !pin) {
        setPin({ lat: withGps.exif.lat!, lng: withGps.exif.lng! });
        setLocSource("photo_exif");
      }
      const taken = next.find((p) => p.exif.takenAt)?.exif.takenAt;
      if (taken) setObservedOn(new Date(new Date(taken).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10));
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function useDevice() {
    // navigator.geolocation exists on an insecure origin but always fails there, which otherwise
    // surfaces as a misleading "permission declined".
    if (!navigator.geolocation || !window.isSecureContext) {
      setErrors((e) => ({
        ...e,
        location: window.isSecureContext
          ? "Your browser doesn't share location. Place the pin on the map instead."
          : "Your browser only shares location over a secure (https) connection. Place the pin on the map instead.",
      }));
      return;
    }
    setLocating(true);
    setErrors((e) => ({ ...e, location: "" }));
    try {
      const fix = await getDeviceLocation(navigator.geolocation);
      setPin({ lat: fix.lat, lng: fix.lng });
      setAccuracyM(fix.accuracyM);
      setLocSource("device");
      setErrors((e) => ({ ...e, location: "" }));
    } catch (err) {
      setErrors((e) => ({ ...e, location: err instanceof GeolocationFailure ? err.message : geolocationErrorMessage(undefined) }));
    } finally {
      setLocating(false);
    }
  }

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (query.trim().length < 3) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim() + (/(bengaluru|bangalore)/i.test(query) ? "" : ", Bengaluru"))}`);
      const d = await r.json();
      setResults(r.ok ? d.results : []);
      if (!r.ok) setErrors((x) => ({ ...x, location: d.error }));
    } finally {
      setSearching(false);
    }
  }

  const validate = () => {
    const e: Record<string, string> = {};
    if (title.trim().length < 8) e.title = "Give the report a short, specific title (at least 8 characters).";
    if (description.trim().length < 20) e.description = "Describe what you saw in at least 20 characters.";
    if (!pin) e.location = "Choose the location: tap the map, use your device location, or search an address.";
    if (!observedOn) e.observedOn = "Choose the date you saw it.";
    else if (observedOn > TODAY()) e.observedOn = "The date can't be in the future.";
    return e;
  };

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      document.querySelector("[aria-invalid=true], [role=alert]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("title", title.trim());
      fd.set("description", description.trim());
      fd.set("category", category);
      fd.set("lat", String(pin!.lat));
      fd.set("lng", String(pin!.lng));
      fd.set("locationSource", locSource);
      if (address.trim()) fd.set("address", address.trim());
      fd.set("observedOn", observedOn);
      if (name.trim()) fd.set("reporterName", name.trim());
      if (contact.trim()) fd.set("reporterContact", contact.trim());
      if (jobCode.trim()) fd.set("jobCode", jobCode.trim());
      if (locSource === "device" && accuracyM) fd.set("locationAccuracyM", String(Math.round(accuracyM)));
      photos.forEach((p) => fd.append("photos", p.blob, p.name.replace(/\.\w+$/, "") + ".jpg"));
      fd.set("photoMeta", JSON.stringify(photos.map((p) => ({ originalSha256: p.originalSha256, width: p.width, height: p.height, exif: p.exif }))));
      const r = await fetch("/api/cases", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (d.fields) setErrors(d.fields);
        setFormError(d.error ?? "The report couldn't be saved. Please try again.");
        setSubmitting(false);
        return;
      }
      saveOwnerKey(d.id, d.ownerKey);
      router.push(`/cases/${d.id}?new=1#k=${encodeURIComponent(d.ownerKey)}`);
    } catch {
      setFormError("Network error. Your report wasn't sent; please try again.");
      setSubmitting(false);
    }
  }

  const pinLabel = useMemo(() => {
    if (!pin) return null;
    const src = { photo_exif: "from photo GPS", device: "from your device", map_pin: "placed on map", geocoded: "from address search" }[locSource];
    // Five decimals is about a metre; saying so without the device's own margin would imply a
    // precision the fix may not have.
    const precision = locSource === "device" ? describeAccuracy(accuracyM) : undefined;
    return `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)} · ${src}${precision ? ` · ${precision}` : ""}`;
  }, [pin, locSource, accuracyM]);

  const coarseFix = locSource === "device" && accuracyM !== undefined && accuracyM > COARSE_FIX_M;

  return (
    <form onSubmit={submit} noValidate className="pb-10">
      <Section n={1} title="Photo" aside="Photos are resized in your browser. We record a SHA-256 fingerprint of your original file so it can be matched later.">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "rounded-2xl border border-dashed border-rule-strong bg-card p-5 transition-colors",
            photoBusy && "border-accent/60",
          )}
        >
          {photos.length > 0 && (
            <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {photos.map((p) => (
                <motion.li key={p.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="group relative overflow-hidden rounded-xl border border-rule">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt={`Selected photo ${p.name}`} className="aspect-square w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 font-mono text-[10px] text-white/90">
                    {p.exif.lat !== undefined ? "GPS ✓ " : ""}
                    {p.exif.takenAt ? new Date(p.exif.takenAt).toLocaleDateString("en-IN") : "no date"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-90 hover:bg-black"
                    aria-label={`Remove ${p.name}`}
                  >
                    ×
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={photoBusy || photos.length >= 4}>
              {photoBusy ? "Reading photo…" : photos.length ? "Add another photo" : "Choose photos"}
            </Button>
            <p className="text-[13px] text-ink-3">JPEG, PNG or WebP · up to 4 · or drop them here</p>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple className="sr-only" onChange={(e) => void addFiles(e.target.files)} aria-label="Choose photos" />
          {errors.photos && <p className="mt-2 text-[13px] text-contradicted" role="alert">{errors.photos}</p>}
          {exifPhoto && (
            <p className="mt-3 text-[13px] text-verified">Location read from the photo&apos;s GPS metadata. You can adjust the pin below.</p>
          )}
        </div>
      </Section>

      <Section n={2} title="What did you see?">
        <Field label="Category" htmlFor="category">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category" id="category">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={category === c}
                onClick={() => setCategory(c)}
                className={cn(
                  "h-9 rounded-full border px-3.5 text-[14px] transition-colors",
                  category === c ? "border-ink bg-ink text-paper" : "border-rule-strong bg-card text-ink-2 hover:border-ink/40",
                )}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Title" htmlFor="title" error={errors.title} hint="Where and what, e.g. “Deep potholes near the Hosur Road junction”">
          <input id="title" className={input} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-invalid={Boolean(errors.title)} />
        </Field>
        <Field label="Description" htmlFor="description" error={errors.description} hint="What is damaged, how large, and any hazard. Stick to what you observed.">
          <textarea id="description" rows={4} className={cn(input, "resize-y")} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} aria-invalid={Boolean(errors.description)} />
          <p className="mt-1 text-right font-mono text-[11px] text-ink-3">{description.length}/2000</p>
        </Field>
        <Field
          label="Work or package number"
          htmlFor="jobCode"
          optional
          hint="If a project board is up, the work or package number on it identifies the contract exactly, e.g. KN03-70. Without it CivicProof works from the location instead and will say so."
        >
          <input
            id="jobCode"
            className={cn(input, "font-mono")}
            value={jobCode}
            maxLength={60}
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="KN03-70"
            onChange={(e) => setJobCode(e.target.value)}
          />
        </Field>
      </Section>

      <Section n={3} title="Where is it?" aside="CivicProof matches this point against the locations of public works projects. Place it on the damaged stretch itself.">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={useDevice} disabled={locating}>
            {locating ? "Locating…" : "Use my current location"}
          </Button>
          {exifPhoto && (
            <Button type="button" variant="secondary" size="sm" onClick={() => { setPin({ lat: exifPhoto.exif.lat!, lng: exifPhoto.exif.lng! }); setAccuracyM(undefined); setLocSource("photo_exif"); }}>
              Use photo GPS
            </Button>
          )}
        </div>
        <div className="relative">
          <div className="flex gap-2">
            <input
              className={input}
              placeholder="Search an address or landmark in Bengaluru"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void search();
                }
              }}
              aria-label="Search an address"
            />
            <Button type="button" variant="secondary" onClick={() => void search()} disabled={searching}>
              {searching ? "…" : "Search"}
            </Button>
          </div>
          {results.length > 0 && (
            <ul className="absolute z-10 mt-2 w-full overflow-hidden rounded-xl border border-rule bg-card shadow-lift">
              {results.map((r) => (
                <li key={`${r.lat},${r.lng}`}>
                  <button
                    type="button"
                    className="block w-full px-4 py-2.5 text-left text-[14px] hover:bg-paper-2"
                    onClick={() => {
                      setPin({ lat: r.lat, lng: r.lng });
                      setAccuracyM(undefined);
                      setLocSource("geocoded");
                      setAddress(r.label);
                      setResults([]);
                    }}
                  >
                    <span className="text-ink">{r.label}</span>
                    <span className="block truncate text-[12px] text-ink-3">{r.full}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <MapView
          className="h-[340px] rounded-2xl border border-rule"
          pick={pin}
          center={pin ?? undefined}
          zoom={pin ? 16 : 11}
          fitToData={false}
          onPick={(p) => {
            setPin({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });
            setAccuracyM(undefined);
            setLocSource("map_pin");
            setErrors((e) => ({ ...e, location: "" }));
          }}
          label="Choose the location of the issue"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <span className={cn("font-mono", pin ? "text-ink-2" : "text-ink-3")}>{pinLabel ?? "Tap the map to place a pin"}</span>
        </div>
        {errors.location && <p className="text-[13px] text-contradicted" role="alert">{errors.location}</p>}
        {coarseFix && (
          <p className="text-[13px] text-partial" role="status">
            Your device placed this to within {describeAccuracy(accuracyM)}, which may not be precise enough to tell one road from
            the next. Drag the pin onto the damaged stretch if you can — CivicProof records how precise the fix was either way.
          </p>
        )}
        <Field label="Address or landmark" htmlFor="address" optional hint="Filled from the map; edit it if it's wrong.">
          <input id="address" className={input} value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
        </Field>
      </Section>

      <Section n={4} title="When?">
        <Field label="Date observed" htmlFor="observedOn" error={errors.observedOn} hint={exifDate ? "Set from the photo's capture date." : undefined}>
          <input id="observedOn" type="date" className={cn(input, "max-w-[220px]")} value={observedOn} max={TODAY()} onChange={(e) => setObservedOn(e.target.value)} aria-invalid={Boolean(errors.observedOn)} />
        </Field>
      </Section>

      <Section n={5} title="About you" aside="Not required. Stored privately with the case and never shown on public pages. Add it only if you want it in your complaint.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" optional>
            <input id="name" className={input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="Email or phone" htmlFor="contact" optional>
            <input id="contact" className={input} value={contact} maxLength={120} onChange={(e) => setContact(e.target.value)} autoComplete="email" />
          </Field>
        </div>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-rule bg-paper/90 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-5">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="max-w-md text-[13px] text-ink-3">
            Submitting creates a public case page (without your contact details). Nothing is sent to any authority until you choose to.
          </p>
          <Button type="submit" size="lg" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? "Creating case…" : "Create case"}
          </Button>
        </div>
        {formError && <p className="mt-2 text-[13px] text-contradicted" role="alert">{formError}</p>}
      </div>
    </form>
  );
}

export function ReportIntro() {
  return (
    <Card className="p-5">
      <Eyebrow>What happens next</Eyebrow>
      <ol className="mt-3 space-y-2 text-[14px] text-ink-2">
        <li><span className="font-mono text-ink-3">1</span> Your case page opens and the investigation starts.</li>
        <li><span className="font-mono text-ink-3">2</span> It finds works projects at this location and checks the official records.</li>
        <li><span className="font-mono text-ink-3">3</span> You get a cited complaint draft, and an RTI draft for anything missing.</li>
      </ol>
    </Card>
  );
}
