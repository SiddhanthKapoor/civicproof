import { describe, expect, it, vi } from "vitest";
import {
  COARSE_FIX_M,
  GeolocationFailure,
  describeAccuracy,
  geolocationErrorMessage,
  getDeviceLocation,
} from "@/lib/geo";

/**
 * The "use my current location" button. Two things matter beyond simply getting coordinates: a
 * failure has to say what actually went wrong, and the fix has to carry its own margin of error —
 * a 2 km fix and a 5 m fix are not the same evidence, and the location is only ever corroboration.
 */

type Opts = PositionOptions | undefined;
const position = (lat: number, lng: number, accuracy: number): GeolocationPosition =>
  ({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: Date.now() }) as GeolocationPosition;
const failure = (code: number) => ({ code, message: "" }) as GeolocationPositionError;

/** A stand-in for the browser's geolocation, scripted one call at a time. */
function fakeGeo(...steps: Array<{ ok?: GeolocationPosition; err?: GeolocationPositionError }>) {
  const calls: Opts[] = [];
  const geo = {
    getCurrentPosition: vi.fn(
      (onOk: PositionCallback, onErr?: PositionErrorCallback | null, opts?: Opts) => {
        calls.push(opts);
        const step = steps[calls.length - 1];
        if (step?.ok) onOk(step.ok);
        else if (step?.err) onErr?.(step.err);
      },
    ),
  };
  return { geo, calls };
}

describe("asking the device for a location", () => {
  it("takes a precise fix and keeps the accuracy the device reported", async () => {
    const { geo, calls } = fakeGeo({ ok: position(12.8945731234, 77.7129712345, 8.5) });
    await expect(getDeviceLocation(geo)).resolves.toEqual({ lat: 12.894573, lng: 77.712971, accuracyM: 8.5 });
    // Asks for the precise fix first, and never reuses a cached one for it.
    expect(calls[0]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("falls back to the quicker network fix when the precise one times out", async () => {
    // A cold satellite fix routinely needs longer than ten seconds, and indoors may never arrive.
    const { geo, calls } = fakeGeo({ err: failure(3) }, { ok: position(12.9, 77.6, 1200) });
    await expect(getDeviceLocation(geo)).resolves.toEqual({ lat: 12.9, lng: 77.6, accuracyM: 1200 });
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(calls[1]).toMatchObject({ enableHighAccuracy: false });
  });

  it("also falls back when the device has no fix at all", async () => {
    const { geo } = fakeGeo({ err: failure(2) }, { ok: position(12.9, 77.6, 60) });
    await expect(getDeviceLocation(geo)).resolves.toMatchObject({ accuracyM: 60 });
  });

  it("does not retry a refusal, because retrying only re-prompts someone who said no", async () => {
    const { geo } = fakeGeo({ err: failure(1) });
    await expect(getDeviceLocation(geo)).rejects.toBeInstanceOf(GeolocationFailure);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("reports the reason the second attempt gave, not the first", async () => {
    const { geo } = fakeGeo({ err: failure(3) }, { err: failure(2) });
    await expect(getDeviceLocation(geo)).rejects.toMatchObject({ code: 2 });
  });

  it("omits the accuracy when the device does not give a usable one", async () => {
    for (const bad of [0, Number.NaN, -1]) {
      const { geo } = fakeGeo({ ok: position(12.9, 77.6, bad) });
      await expect(getDeviceLocation(geo)).resolves.toEqual({ lat: 12.9, lng: 77.6 });
    }
  });
});

describe("what the reporter is told when it fails", () => {
  it("distinguishes a refusal from a device that has no fix and from one that ran out of time", () => {
    expect(geolocationErrorMessage(1)).toMatch(/permission was declined/i);
    expect(geolocationErrorMessage(2)).toMatch(/could not get a location fix/i);
    expect(geolocationErrorMessage(3)).toMatch(/took too long/i);
    expect(geolocationErrorMessage(undefined)).toMatch(/did not return a location/i);
  });

  it("never tells someone they declined permission when they did not", () => {
    // The old handler reported every failure as a refusal, which sent people looking for a
    // permission prompt that was not the problem.
    for (const code of [2, 3, undefined]) {
      expect(geolocationErrorMessage(code), String(code)).not.toMatch(/declined/i);
    }
  });

  it("always offers a way forward", () => {
    for (const code of [1, 2, 3, undefined]) {
      expect(geolocationErrorMessage(code), String(code)).toMatch(/place the pin on the map/i);
    }
  });
});

describe("stating how precise the fix was", () => {
  it("reads in metres, and in kilometres once that would be silly", () => {
    expect(describeAccuracy(8.4)).toBe("±8 m");
    expect(describeAccuracy(150)).toBe("±150 m");
    expect(describeAccuracy(2400)).toBe("±2.4 km");
  });

  it("says nothing rather than implying a precision that was never reported", () => {
    for (const bad of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(describeAccuracy(bad)).toBeUndefined();
    }
  });

  it("treats a fix that cannot tell one road from the next as coarse", () => {
    // The default search radius for nearby projects is 750 m, so a fix worse than 100 m is already
    // a large share of it.
    expect(COARSE_FIX_M).toBe(100);
    expect(1200 > COARSE_FIX_M).toBe(true);
    expect(8.5 > COARSE_FIX_M).toBe(false);
  });
});
