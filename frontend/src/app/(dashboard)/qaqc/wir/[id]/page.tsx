"use client";

import { use } from "react";
import { redirect } from "next/navigation";

export default function WIREditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  redirect(`/qaqc/wir/new?id=${id}`);
}
