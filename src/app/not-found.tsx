import type { Metadata } from "next";
import { ButtonLink, Container } from "@/components/ui";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <Container className="py-24 sm:py-32">
      <p className="font-mono text-[13px] text-ink-3">404</p>
      <h1 className="mt-3 max-w-xl font-serif text-[40px] leading-[1.08] sm:text-[52px]">There is no record at this address.</h1>
      <p className="mt-4 max-w-md text-[16px] text-ink-2">The case, project or document may have been mistyped. Case IDs look like CP-7K3M-Q9TD.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/cases">Browse cases</ButtonLink>
        <ButtonLink href="/sources" variant="secondary">Official records</ButtonLink>
      </div>
    </Container>
  );
}
