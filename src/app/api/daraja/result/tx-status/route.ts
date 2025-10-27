// src/app/api/daraja/result/tx-status/route.ts
export async function POST(req: Request) {
  const data = await req.json().catch(() => null);
  console.log("🌍 [Safaricom → TX Status Callback]", new Date().toISOString());
  try {
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.log("[Safaricom → TX Status Callback] (unserializable payload)");
  }

  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
