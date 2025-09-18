// src/app/page.tsx
"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-6xl mx-auto p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold">Baraka Butchery Management</h1>
        <p className="text-sm text-gray-600 mt-2">
          Welcome — choose a section to continue.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          title="Admin"
          desc="Manage outlets, codes, products, prices, tills & backups"
          href="/admin"
          emoji="🛠️"
        />

        <Tile
          title="Attendant Login"
          desc="Enter your code to access the attendant dashboard"
          href="/attendant"
          emoji="🧾"
        />

        <Tile
          title="Supplier"
          desc="Capture opening/transfer and lock supply for outlets"
          href="/supplier"
          emoji="📦"
        />

        <Tile
          title="Supervisor"
          desc="Approve waste/expenses, review deposits & disputes"
          href="/supervisor"
          emoji="🧭"
        />
      </section>

      <footer className="mt-10 text-xs text-gray-500">
        Tip: Configure outlets, codes and per–outlet prices in <b>Admin</b> first.
      </footer>
    </main>
  );
}

function Tile({
  title,
  desc,
  href,
  emoji,
}: {
  title: string;
  desc: string;
  href: string;
  emoji: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border p-5 hover:bg-gray-50 transition"
    >
      <div className="text-3xl mb-2">{emoji}</div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-gray-600 mt-1">{desc}</p>
      <span className="inline-block mt-3 text-sm underline">Open →</span>
    </Link>
  );
}
