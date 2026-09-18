import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { ReportForm, ReportIntro } from "./report-form";

export const metadata: Metadata = {
  title: "Report an issue",
  description: "Report damaged public infrastructure and turn it into a documented case.",
};

export default function ReportPage() {
  return (
    <Container className="pt-10 sm:pt-14">
      <div className="grid gap-8 lg:grid-cols-[1fr_320px] lg:items-end">
        <div>
          <p className="font-mono text-[12px] text-ink-3">New case</p>
          <h1 className="mt-2 max-w-2xl font-serif text-[40px] leading-[1.05] tracking-[-0.01em] sm:text-[52px]">
            Report what you saw. We&apos;ll find the record behind it.
          </h1>
          <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-ink-2">
            No account needed. Road damage and potholes in Bengaluru get the deepest investigation today; other reports are
            still documented and drafted.
          </p>
        </div>
        <ReportIntro />
      </div>
      <div className="mt-10">
        <ReportForm />
      </div>
    </Container>
  );
}
