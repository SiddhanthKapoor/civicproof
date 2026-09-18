import type { Metadata } from "next";
import { PrivateDocumentViewer } from "./viewer";

export const metadata: Metadata = { title: "Reporter document", robots: { index: false } };

export default async function Page(props: PageProps<"/cases/[id]/documents/[docId]">) {
  const { id, docId } = await props.params;
  return <PrivateDocumentViewer caseId={id} docId={docId} />;
}
