"use client";
import Link from "next/link";
import LegalFooter from "@/components/LegalFooter";

export default function Home() {
  return (
    <>
      <main className="relative h-screen w-screen bg-cover bg-center text-white"
        style={{ backgroundImage: "url('/hero.jpg')" }}
      >
        {/* Overlay */}
        <div className="absolute inset-0 bg-black bg-opacity-60 flex flex-col items-center justify-center text-center px-4">
          
          {/* Title */}
          <h1 className="text-4xl md:text-6xl font-bold mb-4">
            Welcome to Baraka Butchery Management
          </h1>
          <p className="text-lg md:text-2xl mb-8 max-w-2xl">
            Honesty, Quality, and Trust at the Heart of Every Cut
          </p>

          {/* Buttons in one row */}
          <div className="flex flex-wrap justify-center gap-6">
            <Link href="/attendant">
              <button className="px-6 py-3 bg-black bg-opacity-70 hover:bg-opacity-90 rounded-lg font-semibold">
                Attendant
              </button>
            </Link>
            <Link href="/supplier">
              <button className="px-6 py-3 bg-black bg-opacity-70 hover:bg-opacity-90 rounded-lg font-semibold">
                Supplier
              </button>
            </Link>
            <Link href="/supervisor">
              <button className="px-6 py-3 bg-black bg-opacity-70 hover:bg-opacity-90 rounded-lg font-semibold">
                Supervisor
              </button>
            </Link>
            <Link href="/admin">
              <button className="px-6 py-3 bg-black bg-opacity-70 hover:bg-opacity-90 rounded-lg font-semibold">
                Admin
              </button>
            </Link>
          </div>
        </div>
      </main>
      <LegalFooter />
    </>
  );
}
