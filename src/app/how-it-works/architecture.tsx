/** Architecture diagram, drawn as inline SVG so it stays sharp and themeable. */
function Box({ x, y, w, h, title, sub, tone = "card" }: { x: number; y: number; w: number; h: number; title: string; sub?: string; tone?: "card" | "ink" | "accent" | "dashed" }) {
  const fill = tone === "ink" ? "var(--ink)" : tone === "accent" ? "var(--accent-soft)" : "var(--card)";
  const stroke = tone === "ink" ? "var(--ink)" : tone === "accent" ? "var(--accent)" : "var(--rule-strong)";
  const text = tone === "ink" ? "var(--paper)" : "var(--ink)";
  const subText = tone === "ink" ? "rgba(246,244,239,.65)" : "var(--ink-3)";
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={12} fill={fill} stroke={stroke} strokeWidth={1.2} strokeDasharray={tone === "dashed" ? "5 4" : undefined} />
      <text x={x + 14} y={y + 26} fontSize={14} fontWeight={600} fill={text} fontFamily="var(--font-sans)">{title}</text>
      {sub && sub.split("\n").map((line, i) => (
        <text key={i} x={x + 14} y={y + 46 + i * 16} fontSize={11.5} fill={subText} fontFamily="var(--font-sans)">{line}</text>
      ))}
    </g>
  );
}

function Arrow({ d, label, lx, ly }: { d: string; label?: string; lx?: number; ly?: number }) {
  return (
    <g>
      <path d={d} fill="none" stroke="var(--ink-3)" strokeWidth={1.3} markerEnd="url(#arrow)" />
      {label && (
        <text x={lx} y={ly} fontSize={11} fill="var(--ink-2)" fontFamily="var(--font-mono)" textAnchor="middle">{label}</text>
      )}
    </g>
  );
}

export function ArchitectureDiagram() {
  return (
    <div tabIndex={0} role="group" aria-label="Architecture diagram (scrolls sideways on small screens)" className="overflow-x-auto rounded-2xl border border-rule bg-paper-2/40 p-4">
      <svg viewBox="0 0 1120 520" className="min-w-[860px]" role="img" aria-labelledby="arch-title arch-desc">
        <title id="arch-title">CivicProof architecture on AWS</title>
        <desc id="arch-desc">
          The browser calls a Lambda Function URL in response-streaming mode. Inside Lambda, the Next.js app runs a Strands agent whose
          tool calls are authorized by Cedar and whose claims are checked by a verifier against the bundled records corpus. Lambda reads and
          writes DynamoDB and S3, calls the language model (Gemini or Amazon Bedrock), and logs to CloudWatch.
        </desc>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="var(--ink-3)" />
          </marker>
        </defs>

        <Box x={20} y={200} w={150} h={96} title="Browser" sub={"Report form, map,\ncase page, packet"} />
        <Arrow d="M170 248 H232" label="HTTPS" lx={201} ly={238} />

        {/* Lambda */}
        <rect x={236} y={40} width={560} height={440} rx={18} fill="none" stroke="var(--ink)" strokeWidth={1.4} />
        <text x={256} y={68} fontSize={13} fontWeight={600} fill="var(--ink)" fontFamily="var(--font-sans)">AWS Lambda · Function URL (response streaming)</text>
        <text x={256} y={86} fontSize={11.5} fill="var(--ink-3)" fontFamily="var(--font-sans)">Next.js 16 standalone server via Lambda Web Adapter · deployed with AWS SAM</text>

        <Box x={256} y={108} w={200} h={78} title="API routes" sub={"Validation (Zod), rate limits,\nNDJSON event stream"} />
        <Box x={256} y={206} w={200} h={96} title="Strands agent loop" sub={"Model proposes a tool call;\nhooks trace every step"} tone="ink" />
        <Box x={256} y={322} w={200} h={78} title="Case service" sub={"Owner key, timeline,\npackets, PDF"} />

        <Box x={486} y={108} w={290} h={78} title="Cedar policies" sub={"agent-tools.cedar · case-actions.cedar\ndeny by default, per-run budgets"} tone="accent" />
        <Box x={486} y={206} w={290} h={96} title="Tools + grounding verifier" sub={"find_projects_near, read_document_page,\nrecord_claim → quote must appear verbatim\non the cited page, or the claim is unverified"} />
        <Box x={486} y={322} w={290} h={78} title="Records corpus (bundled)" sub={"9 documents · 319 pages · SHA-256 checked\nproject alignments (GeoSadak, OSM)"} />

        <Arrow d="M356 186 V206" />
        <Arrow d="M456 240 H486" />
        <Arrow d="M600 186 V206" label="authorize" lx={640} ly={199} />
        <Arrow d="M631 302 V322" />
        <Arrow d="M356 302 V322" />

        {/* AWS services */}
        <Box x={860} y={40} w={240} h={72} title="Language model" sub={"Gemini or Amazon Bedrock\ntool use + vision"} tone="accent" />
        <Box x={860} y={126} w={240} h={72} title="Amazon Textract" sub={"OCR for scanned uploads\n(RTI replies, letters)"} />
        <Box x={860} y={212} w={240} h={72} title="Amazon DynamoDB" sub={"cases (optimistic locking)\ndaily run counters (TTL)"} />
        <Box x={860} y={298} w={240} h={72} title="Amazon S3" sub={"photos, private documents, PDFs\nSSE, no public access"} />
        <Box x={860} y={384} w={240} h={72} title="Amazon CloudWatch" sub={"structured logs, alarm,\nmetric filters"} />

        <Arrow d="M796 76 H860" label="Converse" lx={828} ly={68} />
        <Arrow d="M796 162 H860" />
        <Arrow d="M796 248 H860" />
        <Arrow d="M796 334 H860" />
        <Arrow d="M796 420 H860" />

        <text x={20} y={500} fontSize={11} fill="var(--ink-3)" fontFamily="var(--font-sans)">
          Outside AWS: OpenFreeMap vector tiles and OpenStreetMap Nominatim (address search), both keyless and rate-limited server-side.
        </text>
      </svg>
    </div>
  );
}
