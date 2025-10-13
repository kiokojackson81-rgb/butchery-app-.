"use client";
import dynamic from "next/dynamic";
const PerformanceView = dynamic(() => import("@/components/performance/PerformanceView"), { ssr: false });

export default function PerformancePage() {
  return (
    <main className="mobile-container sticky-safe p-6 max-w-7xl mx-auto">
      <PerformanceView />
    </main>
  );
}
