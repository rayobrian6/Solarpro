import { Suspense } from "react";
import GeneratorEstimator from "@/components/GeneratorEstimator";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#07070e] text-white">
      <Suspense fallback={null}>
        <GeneratorEstimator />
      </Suspense>
    </main>
  );
}
