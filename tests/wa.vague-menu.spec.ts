import { test, expect } from "@playwright/test";
import { linkSession, simulateInbound, drainOutbox } from "./utils/waTestHarness";

const TEST_PHONE = process.env.TEST_PHONE_E164 || "+254700000000";
const TEST_CODE_ATTENDANT = process.env.TEST_CODE_ATTENDANT || "ATT001";

test("vague message yields menu, not silence", async () => {
  const j = await linkSession(TEST_PHONE, TEST_CODE_ATTENDANT);
  expect(j?.ok).toBeTruthy();
  await simulateInbound(TEST_PHONE, "hi");
  const out = await drainOutbox({ to: TEST_PHONE, limit: 20 });
  expect(out[0]).toBeTruthy();
  const lastText = out[0]?.text || ""; // logs are desc order
  expect(/enter closing|submit deposit|view summary/i.test(lastText)).toBeTruthy();
});
