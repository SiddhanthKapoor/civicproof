"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Wordmark } from "./brand";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/cases", label: "Cases" },
  { href: "/sources", label: "Records" },
  { href: "/how-it-works", label: "How it works" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    // Close the mobile menu on navigation (state adjusted during render, per React docs).
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "no-print sticky top-0 z-40 border-b transition-[background-color,border-color] duration-300",
        scrolled ? "border-rule bg-paper/85 backdrop-blur-md" : "border-transparent bg-paper",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-4 sm:px-6">
        <Wordmark />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "relative rounded-full px-3.5 py-2 text-[14px] transition-colors",
                  active ? "text-ink" : "text-ink-2 hover:text-ink",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 -z-10 rounded-full bg-paper-3"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.45 }}
                  />
                )}
                {l.label}
              </Link>
            );
          })}
          <Link
            href="/report"
            className="ml-3 inline-flex h-9 items-center rounded-full bg-ink px-4 text-[14px] font-medium text-paper transition-colors hover:bg-accent-ink"
          >
            Report an issue
          </Link>
        </nav>
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded-full md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="relative block h-3 w-5">
            <span className={cn("absolute left-0 top-0 h-[1.5px] w-5 bg-ink transition-transform duration-300", open && "translate-y-[5px] rotate-45")} />
            <span className={cn("absolute bottom-0 left-0 h-[1.5px] w-5 bg-ink transition-transform duration-300", open && "-translate-y-[5.5px] -rotate-45")} />
          </span>
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            id="mobile-nav"
            aria-label="Main"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.7, 0.2, 1] }}
            className="overflow-hidden border-t border-rule bg-paper md:hidden"
          >
            <div className="flex flex-col px-4 py-3">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="border-b border-rule py-3 text-[17px] text-ink">
                  {l.label}
                </Link>
              ))}
              <Link href="/report" className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-ink text-[15px] font-medium text-paper">
                Report an issue
              </Link>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
