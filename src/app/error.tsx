"use client";

import { Button, Container } from "@/components/ui";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container className="py-24 sm:py-32">
      <p className="font-mono text-[13px] text-ink-3">Error</p>
      <h1 className="mt-3 max-w-xl font-serif text-[40px] leading-[1.08]">Something went wrong loading this page.</h1>
      <p className="mt-4 max-w-md text-[16px] text-ink-2">Nothing you entered was lost. The error has been logged; try again in a moment.</p>
      <Button className="mt-8" onClick={reset}>Try again</Button>
    </Container>
  );
}
