import { loadCorpus } from "../../src/lib/corpus";
import { verifyClaim } from "../../src/lib/agent/verifier";
const corpus = loadCorpus();
const r = verifyClaim({ field: "contractor", text: "x", value: "M/s Example Builders", origin: "official_record", citations: [{ docId: "kppp-bbmp-wt-pkg2-award", page: 1, quote: "supplierName: M/s Example Builders" }] }, corpus, "x");
console.log(JSON.stringify({ verification: r.claim.verification, rejections: r.rejections }, null, 1));
