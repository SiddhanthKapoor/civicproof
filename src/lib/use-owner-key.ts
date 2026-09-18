"use client";

import { useSyncExternalStore } from "react";

const EVENT = "civicproof:owner-key";
const storageKey = (caseId: string) => `civicproof:owner:${caseId}`;

function read(caseId: string): string | null {
  try {
    return localStorage.getItem(storageKey(caseId));
  } catch {
    return null; // private mode or blocked storage
  }
}

export function saveOwnerKey(caseId: string, key: string) {
  try {
    localStorage.setItem(storageKey(caseId), key);
  } catch {
    /* the key is still shown to the user to copy */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The owner key stored in this browser for a case (null on the server and when absent). */
export function useStoredOwnerKey(caseId: string): string | null {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener(EVENT, notify);
      window.addEventListener("storage", notify);
      return () => {
        window.removeEventListener(EVENT, notify);
        window.removeEventListener("storage", notify);
      };
    },
    () => read(caseId),
    () => null,
  );
}
