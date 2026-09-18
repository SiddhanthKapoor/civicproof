"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ElementType } from "react";

/** Headline reveal: each word fades in from a slight blur, in reading order. */
export function WordReveal({ text, as = "h1", className, delay = 0.05 }: { text: string; as?: ElementType; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  const Tag = as;
  const words = text.split(" ");
  return (
    <Tag className={className} aria-label={text}>
      {words.map((w, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="inline-block whitespace-pre"
          initial={reduce ? false : { opacity: 0, y: 10, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.55, delay: delay + i * 0.07, ease: [0.2, 0.7, 0.2, 1] }}
        >
          {w}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </Tag>
  );
}
