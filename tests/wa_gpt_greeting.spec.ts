import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gpt_router", () => ({
  runGptForIncoming: vi.fn(),
}));

vi.mock("@/lib/wa", () => ({
  sendTextSafe: vi.fn(),
}));

vi.mock("@/lib/wa_gpt_interact", () => ({
  trySendGptInteractive: vi.fn(),
}));

describe("sendGptGreeting", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("reports failure when every send attempt is rejected", async () => {
    const { runGptForIncoming } = await import("@/lib/gpt_router");
    const { sendTextSafe } = await import("@/lib/wa");
    const { trySendGptInteractive } = await import("@/lib/wa_gpt_interact");

    vi.mocked(runGptForIncoming).mockResolvedValue('{"text":"Hello"}');
    vi.mocked(trySendGptInteractive).mockResolvedValue(false);
    vi.mocked(sendTextSafe)
      .mockResolvedValueOnce({ ok: false, error: "text failed" })
      .mockResolvedValueOnce({ ok: false, error: "fallback text failed" })
      .mockResolvedValueOnce({ ok: false, error: "default fallback failed" });

    const { sendGptGreeting } = await import("@/lib/wa_gpt_helpers");
    const result = await sendGptGreeting("+1234567890", "attendant");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("text failed");
    expect(result.errors).toContain("fallback text failed");
    expect(result.errors).toContain("default fallback failed");
  });

  it("returns interactive success when buttons deliver", async () => {
    const { runGptForIncoming } = await import("@/lib/gpt_router");
    const { sendTextSafe } = await import("@/lib/wa");
    const { trySendGptInteractive } = await import("@/lib/wa_gpt_interact");

    vi.mocked(runGptForIncoming).mockResolvedValue(
      JSON.stringify({
        text: "Welcome back!",
        interactive: { type: "buttons", buttons: [{ id: "ATT_CLOSING", title: "Closing" }] },
      })
    );
    vi.mocked(trySendGptInteractive).mockResolvedValue(true);
    vi.mocked(sendTextSafe).mockResolvedValue({ ok: true });

    const { sendGptGreeting } = await import("@/lib/wa_gpt_helpers");
    const result = await sendGptGreeting("+19876543210", "attendant");

    expect(result.ok).toBe(true);
    expect(result.via).toBe("interactive");
    expect(result.errors).toEqual([]);
  });
});
