import type { Metadata } from "next";
import { ButtonLink, Container } from "@/components/ui";

export const metadata: Metadata = { title: "Offline" };

/** Shown by the service worker when a page is requested with no connection and no cached copy. */
export default function Offline() {
  return (
    <Container className="py-24 sm:py-32">
      <p className="font-mono text-[13px] text-ink-3">No connection</p>
      <h1 className="mt-3 max-w-xl font-serif text-[40px] leading-[1.08] sm:text-[52px]">You&apos;re offline.</h1>
      <p className="mt-4 max-w-md text-[16px] text-ink-2">
        Cases you opened before are still readable. Filing a report, running an investigation and downloading a PDF need a connection.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/cases">Cases</ButtonLink>
        <ButtonLink href="/" variant="secondary">Home</ButtonLink>
      </div>
    </Container>
  );
}
