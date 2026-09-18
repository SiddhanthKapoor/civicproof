import Link from "next/link";
import { Mark } from "./brand";

export function SiteFooter() {
  return (
    <footer className="no-print mt-24 border-t border-rule">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm">
          <div className="flex items-center gap-2">
            <Mark className="h-6 w-6" />
            <span className="text-[15px]">
              <span className="font-semibold">Civic</span>
              <span className="font-serif italic">Proof</span>
            </span>
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            Built for the First Commit hackathon (WeMakeDevs × AWS). Records are public documents, cited to the page. Demo
            reports are labelled; nothing here has been sent to any authority on your behalf.
          </p>
        </div>
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-3">Product</p>
          <ul className="mt-3 space-y-2 text-[14px] text-ink-2">
            <li><Link className="hover:text-ink" href="/report">Report an issue</Link></li>
            <li><Link className="hover:text-ink" href="/cases">Explore cases</Link></li>
            <li><Link className="hover:text-ink" href="/sources">Official records</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-3">Trust</p>
          <ul className="mt-3 space-y-2 text-[14px] text-ink-2">
            <li><Link className="hover:text-ink" href="/how-it-works">How facts are verified</Link></li>
            <li><Link className="hover:text-ink" href="/how-it-works#policies">Agent permissions (Cedar)</Link></li>
            <li><Link className="hover:text-ink" href="/how-it-works#limits">Known limitations</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
