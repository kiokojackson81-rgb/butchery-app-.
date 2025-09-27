import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy | Baraka Fresh",
  description:
    "Cookie and local storage usage on barakafresh.com and the BarakaOps app.",
};

export default function CookiesPage() {
  const Base: React.CSSProperties = {
    fontFamily:
      'system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif',
    lineHeight: 1.6,
    color: "#eaeaea",
    background: "#0b0b0b",
    minHeight: "100vh",
  };
  const Card: React.CSSProperties = {
    background: "#141414",
    border: "1px solid #2a2a2a",
    borderRadius: 12,
    padding: 24,
  };
  const Muted: React.CSSProperties = { color: "#bdbdbd" };
  const LinkS: React.CSSProperties = { color: "#77c1ff", textDecoration: "none" };

  return (
    <main style={Base}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: 32 }}>
        <h1 style={{ color: "#fff" }}>Cookie Policy</h1>
        <p style={Muted}>
          <strong>Last updated:</strong> 26 September 2025
        </p>

        <section style={Card}>
          <p>
            We use cookies and similar technologies (like localStorage and analytics)
            on <strong>barakafresh.com</strong> and within the <strong>BarakaOps</strong> app to
            keep you signed in, remember preferences, and measure performance.
          </p>

          <h2 style={{ color: "#fff" }}>What We Use</h2>
          <ul>
            <li>
              <strong>Strictly necessary:</strong> login/session, security, role-based access.
            </li>
            <li>
              <strong>Preferences:</strong> UI language, outlet/attendant selections, filters.
            </li>
            <li>
              <strong>Analytics:</strong> anonymous usage and crash diagnostics to improve reliability.
            </li>
            <li>
              <strong>Messaging:</strong> tokens for optional notifications where supported.
            </li>
          </ul>

          <h2 style={{ color: "#fff" }}>Managing Cookies</h2>
          <p>
            Most browsers let you block or delete cookies. If you block strictly necessary
            cookies, some features may stop working. You can also clear localStorage anytime.
          </p>

          <h2 style={{ color: "#fff" }}>Retention</h2>
          <p>
            Cookies/local data may persist until expiry or manual deletion. Operational records
            are kept per our{" "}
            <a href="/privacy" style={LinkS}>
              Privacy Policy
            </a>
            .
          </p>

          <h2 style={{ color: "#fff" }}>Questions</h2>
          <p>
            Email{" "}
            <a href="mailto:support@barakafresh.com" style={LinkS}>
              support@barakafresh.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
