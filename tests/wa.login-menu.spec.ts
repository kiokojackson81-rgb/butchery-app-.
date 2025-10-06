import { test, expect } from "@playwright/test";
import { linkSession, drainOutbox } from "./utils/waTestHarness";

const TEST_PHONE = process.env.TEST_PHONE_E164 || "+254700000000";
const TEST_CODE_ATTENDANT = process.env.TEST_CODE_ATTENDANT || "ATT001";

test("login binds phone then sends welcome menu", async () => {
  const j = await linkSession(TEST_PHONE, TEST_CODE_ATTENDANT);
  expect(j?.ok).toBeTruthy();
  // Pull latest outbound for that phone
  const out = await drainOutbox({ to: TEST_PHONE, limit: 20 });
  expect(out.some((m) => /welcome|menu|enter closing|submit deposit|view summary/i.test(m.text || ""))).toBeTruthy();
});
