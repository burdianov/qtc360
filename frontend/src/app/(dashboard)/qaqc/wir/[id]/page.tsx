import { redirect } from "next/navigation";

export default async function WIREditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/qaqc/wir/new?id=${id}`);
}
