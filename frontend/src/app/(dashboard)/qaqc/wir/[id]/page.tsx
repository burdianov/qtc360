"use client";

import { use } from "react";
import { NewWIRPageContent } from "../new/page";

export default function WIREditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return <NewWIRPageContent key={id} editId={id} />;
}
