"use server";
import React from 'react';
import { prisma } from '@/lib/prisma';

export default async function Page() {
  const tills = await (prisma as any).till.findMany({ orderBy: { outletCode: 'asc' } });
  const hasKeys = {
    DARAJA_CONSUMER_KEY: !!process.env.DARAJA_CONSUMER_KEY,
    DARAJA_CONSUMER_SECRET: !!process.env.DARAJA_CONSUMER_SECRET,
    DARAJA_PASSKEY_HO: !!process.env.DARAJA_PASSKEY_HO,
    PUBLIC_BASE_URL: !!process.env.PUBLIC_BASE_URL,
  };
  return (
    <div className="p-6 grid grid-cols-3 gap-6">
      <div className="col-span-2">
        <h1 className="text-2xl font-bold">Tills</h1>
        <p className="mt-2">Manage till mappings for Daraja/STK.</p>

        <form action="/api/admin/tills/create" method="post" className="mt-4 space-y-2">
          <div><input name="label" placeholder="Label" /></div>
          <div><input name="outletCode" placeholder="Outlet (BRIGHT|BARAKA_A|... )" /></div>
          <div><input name="tillNumber" placeholder="Till Number" /></div>
          <div><input name="storeNumber" placeholder="Store Number" /></div>
          <div><input name="headOfficeNumber" placeholder="Head Office Number" /></div>
          <div><button type="submit" className="bg-green-600 text-white px-3 py-1 rounded">Create Till</button></div>
        </form>

        <form action="/admin/settings/tills/route" method="post">
          <button type="submit" className="mt-4 inline-block bg-blue-600 text-white px-3 py-2 rounded">Seed default tills</button>
        </form>

        <table className="mt-6 w-full border-collapse">
          <thead>
            <tr><th>Label</th><th>Outlet</th><th>Till</th><th>Store</th><th>HO</th><th>Active</th></tr>
          </thead>
          <tbody>
            {tills.map((t:any) => (
              <tr key={t.id} className="border-t"><td>{t.label}</td><td>{t.outletCode}</td><td>{t.tillNumber}</td><td>{t.storeNumber}</td><td>{t.headOfficeNumber}</td><td>{t.isActive ? '✅' : '❌'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="col-span-1 p-4 border rounded">
        <h2 className="font-semibold">Daraja Settings</h2>
        <ul className="mt-2">
          {Object.entries(hasKeys).map(([k,v]) => (<li key={k}>{k}: {v ? '✅' : '❌'}</li>))}
        </ul>
        <a href="https://developer.safaricom.co.ke" target="_blank" rel="noreferrer" className="mt-4 inline-block text-blue-600">Go Live Setup Guide</a>
      </aside>
    </div>
  );
}
