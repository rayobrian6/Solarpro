import GeneratorBillParser from "@/components/GeneratorBillParser";

export const metadata = {
  title: "Electric Bill Parser | Generator Estimator",
  description:
    "Paste your electric bill to size a standby generator from your real monthly kWh and peak kW demand.",
};

export default function BillPage() {
  return (
    <main className="min-h-screen bg-[#07070e] text-white">
      <GeneratorBillParser />
    </main>
  );
}
