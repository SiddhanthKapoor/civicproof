import { Container } from "@/components/ui";

export default function Loading() {
  return (
    <Container className="pt-10" aria-busy="true" aria-label="Loading case">
      <div className="h-4 w-40 animate-pulse rounded bg-paper-3" />
      <div className="mt-6 h-12 w-3/4 max-w-2xl animate-pulse rounded-lg bg-paper-3" />
      <div className="mt-4 h-4 w-1/2 max-w-md animate-pulse rounded bg-paper-3" />
      <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_340px]">
        <div className="h-72 animate-pulse rounded-2xl bg-paper-2" />
        <div className="h-72 animate-pulse rounded-2xl bg-paper-2" />
      </div>
    </Container>
  );
}
