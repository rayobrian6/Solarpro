import { requireDeskPage } from "@/lib/leadDeskAuth";
import LeadDeskBoard from "./LeadDeskBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead Desk — SolarPro" };

export default async function DeskPage() {
  const user = await requireDeskPage();
  return <LeadDeskBoard name={user.name} />;
}
