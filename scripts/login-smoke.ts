import fetch from "node-fetch";

function parseArg(name: string, def?: string) {
  const idx = process.argv.findIndex((a) => a === name || a.startsWith(name + "="));
  if (idx === -1) return def;
  const val = process.argv[idx].includes("=") ? process.argv[idx].split("=")[1] : process.argv[idx + 1];
  return val ?? def;
}

async function main() {
  const base = String(process.env.TEST_BASE || parseArg("--base", "http://localhost:3022") || "http://localhost:3022");
  const code = parseArg("--code", "001a");
  if (!code) throw new Error("Missing --code");
  const body = { loginCode: code };
  const url = base.replace(/\/$/, "") + "/api/auth/login";
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  console.log("POST", url, "status", r.status);
  console.log(JSON.stringify(json, null, 2));
  if (!r.ok || !json?.ok) process.exit(1);
}

main().catch((e) => { console.error("SMOKE FAIL:", e?.message || e); process.exit(1); });
