import { POST as loginPOST } from "../src/app/api/auth/login/route";

function parseArg(name: string, def?: string) {
  const idx = process.argv.findIndex((a) => a === name || a.startsWith(name + "="));
  if (idx === -1) return def;
  const val = process.argv[idx].includes("=") ? process.argv[idx].split("=")[1] : process.argv[idx + 1];
  return (val ?? def) as string | undefined;
}

async function call(code: string) {
  const req = new Request("http://local/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginCode: code }),
  });
  const res = await loginPOST(req);
  const status = (res as Response).status;
  let json: any;
  try {
    json = await (res as Response).json();
  } catch {
    json = { raw: await (res as Response).text() };
  }
  console.log("status", status);
  console.log(JSON.stringify(json, null, 2));
  return { status, json };
}

async function main() {
  const okCode = parseArg("--ok", "001a")!;
  const badCode = parseArg("--bad", "nonexistent")!;

  console.log("\n=== INVALID CODE TEST ===");
  await call(badCode);

  console.log("\n=== VALID CODE TEST ===");
  await call(okCode);
}

main().catch((e) => { console.error("DIRECT SMOKE FAIL:", e?.message || e); process.exit(1); });
