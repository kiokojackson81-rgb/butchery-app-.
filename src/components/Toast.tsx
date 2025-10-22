"use client";
import React from "react";

export default function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div style={{ position: 'fixed', right: 16, bottom: 20, zIndex: 60 }}>
      <div className="rounded-md bg-black text-white px-4 py-2 shadow-lg" role="status">
        {message}
      </div>
    </div>
  );
}
