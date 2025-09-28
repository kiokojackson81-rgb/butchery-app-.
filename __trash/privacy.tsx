import Head from "next/head";

export default function Page() {
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
    <>
      <Head>
        <title>Privacy Policy | Baraka Fresh</title>
        <meta
          name="description"
          content="How Baraka Fresh collects, uses, and protects information across barakafresh.com and the BarakaOps app."
        />
      </Head>
      <main style={Base}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: 32 }}>
          <h1 style={{ color: "#fff" }}>Privacy Policy</h1>
          <p style={Muted}>
            <strong>Last updated:</strong> 26 September 2025
          </p>

          <section style={Card}>
            <p>
              This Privacy Policy describes how <strong>Baraka Fresh</strong> (“we”, “us”,
              “our”) collects and processes information when you use{" "}
              <strong>barakafresh.com</strong> (the “Site”) and the{" "}
              <strong>BarakaOps</strong> mobile app (the “App”).
            </p>

            <h2 style={{ color: "#fff" }}>Information We Collect</h2>
            <ul>
              <li>
                <strong>Operational data:</strong> supplies, closing stock, deposits,
                expenses, waste/disputes, photos, timestamps, outlet/attendant/supplier
                codes.
              </li>
              <li>
                <strong>Device/usage data:</strong> IP, browser/app version, pages
                visited, crash logs, performance metrics.
              </li>
              <li>
                <strong>Contact info (optional):</strong> names and phone numbers for
                duty notifications.
              </li>
            </ul>

            <h2 style={{ color: "#fff" }}>How We Use Information</h2>
            <ul>
              <li>Run daily butchery operations and audit trails.</li>
              <li>Send operational notifications (e.g., WhatsApp, email, push).</li>
              <li>Security, fraud prevention, diagnostics, and improvements.</li>
              <li>Legal compliance and dispute resolution.</li>
            </ul>

            <h2 style={{ color: "#fff" }}>Sharing</h2>
            <p>
              We may share with: (i) service providers (hosting, database, messaging),
              (ii) authorized organization roles (attendants, supervisors, suppliers,
              admin), and (iii) authorities if required by law. We do not sell personal
              data.
            </p>

            <h2 style={{ color: "#fff" }}>Data Retention</h2>
            <p>
              We retain operational records as required for business and legal needs.
              You can request deletion of personal identifiers where feasible and not
              conflicting with record-keeping obligations.
            </p>

            <h2 style={{ color: "#fff" }}>Security</h2>
            <p>
              We use industry-standard safeguards. No method is 100% secure; please keep
              your codes and devices safe.
            </p>

            <h2 style={{ color: "#fff" }}>Your Choices</h2>
            <ul>
              <li>Control optional notifications where settings are provided.</li>
              <li>
                Ask questions or request access/deletion at{" "}
                <a href="mailto:support@barakafresh.com" style={LinkS}>
                  support@barakafresh.com
                </a>
                .
              </li>
            </ul>

            <h2 style={{ color: "#fff" }}>Changes</h2>
            <p>
              We may update this policy. We’ll update the “Last updated” date and may
              provide additional notice when required.
            </p>

            <h2 style={{ color: "#fff" }}>Contact</h2>
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
    </>
  );
}
