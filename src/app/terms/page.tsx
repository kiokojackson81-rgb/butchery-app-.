import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use | Baraka Fresh",
  description: "Terms of Use for barakafresh.com and the BarakaOps mobile app.",
};

export default function TermsPage() {
  const A = { c: "#eaeaea" };
  const LinkS: React.CSSProperties = { color: "#77c1ff", textDecoration: "none" };

  return (
    <main
      style={{
        fontFamily:
          'system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif',
        lineHeight: 1.6,
        color: A.c,
        background: "#0b0b0b",
        minHeight: "100vh",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto", padding: 32 }}>
        <h1 style={{ color: "#fff" }}>Terms of Use</h1>
        <p style={{ color: "#bdbdbd" }}>
          <strong>Last updated:</strong> 26 September 2025
        </p>

        <section
          style={{
            background: "#141414",
            border: "1px solid #2a2a2a",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <p>
            These Terms govern your access to and use of <strong>barakafresh.com</strong> (the
            “Site”) and the <strong>BarakaOps</strong> mobile app (the “App”) provided by{" "}
            <strong>Baraka Fresh</strong> (“we”, “us”, “our”). By accessing or using the
            Site/App, you agree to these Terms.
          </p>

          <h2 style={{ color: "#fff" }}>1. Eligibility & Accounts</h2>
          <ul>
            <li>For authorized business users only (attendants, supervisors, suppliers, admin).</li>
            <li>You are responsible for safeguarding codes, logins, and devices.</li>
            <li>Keep your information accurate and up to date.</li>
          </ul>

          <h2 style={{ color: "#fff" }}>2. Acceptable Use</h2>
          <ul>
            <li>Use only for legitimate butchery operations.</li>
            <li>No disruption, scraping, reverse engineering, or security bypass.</li>
            <li>No unlawful, infringing, or harmful content.</li>
          </ul>

          <h2 style={{ color: "#fff" }}>3. Operational Data</h2>
          <p>
            You (and/or your organization) own your submitted records. You grant us a
            non-exclusive license to process and display data to provide the services.
          </p>

          <h2 style={{ color: "#fff" }}>4. Notifications</h2>
          <p>
            Operational notifications may be sent via WhatsApp, SMS, push, or email.
            Third-party terms (e.g., WhatsApp) apply. You can control optional notifications
            where available.
          </p>

          <h2 style={{ color: "#fff" }}>5. Privacy</h2>
          <p>
            See our <a href="/privacy" style={LinkS}>Privacy Policy</a>.
          </p>

          <h2 style={{ color: "#fff" }}>6. Availability & Changes</h2>
          <ul>
            <li>We strive for uptime but do not guarantee uninterrupted service.</li>
            <li>We may add/modify/remove features at any time.</li>
            <li>We may suspend or terminate access for violations or security reasons.</li>
          </ul>

          <h2 style={{ color: "#fff" }}>7. Disclaimers</h2>
          <p>
            Services are provided “as is” without warranties of any kind to the extent permitted
            by law.
          </p>

          <h2 style={{ color: "#fff" }}>8. Limitation of Liability</h2>
          <p>
            To the extent permitted by law, we are not liable for indirect or consequential
            damages, or lost profits/data. Our total liability is capped at the amount you paid
            in the prior 3 months or USD 100, whichever is greater.
          </p>

          <h2 style={{ color: "#fff" }}>9. Indemnification</h2>
          <p>You agree to indemnify us for claims arising from your misuse or violations.</p>

          <h2 style={{ color: "#fff" }}>10. IP</h2>
          <p>
            The Site/App (software, logos, content) are our property or our licensors’. 
            No reverse engineering or derivative works except as allowed by law.
          </p>

          <h2 style={{ color: "#fff" }}>11. Termination</h2>
          <p>
            We may suspend/terminate your access immediately for violations, fraud, or security risk.
          </p>

          <h2 style={{ color: "#fff" }}>12. Governing Law</h2>
          <p>Governed by applicable local laws; disputes go to competent local courts.</p>

          <h2 style={{ color: "#fff" }}>13. Changes</h2>
          <p>
            We may update these Terms and will update the “Last updated” date and provide any
            legally required notices. Continued use means acceptance.
          </p>

          <h2 style={{ color: "#fff" }}>14. Contact</h2>
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
