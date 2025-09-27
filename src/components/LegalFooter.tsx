"use client";

export default function LegalFooter() {
  const Wrap: React.CSSProperties = {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: 10,
    zIndex: 10,
    background: "rgba(0,0,0,0.55)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 12,
    color: "#cfcfcf",
    display: "flex",
    gap: 10,
    alignItems: "center",
    backdropFilter: "blur(6px)",
  };

  const A: React.CSSProperties = {
    color: "#a6d3ff",
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  const Dot: React.CSSProperties = { opacity: 0.5 };

  return (
    <div style={Wrap}>
      <a href="/privacy" style={A}>Privacy</a>
      <span style={Dot}>•</span>
      <a href="/terms" style={A}>Terms</a>
      <span style={Dot}>•</span>
      <a href="/cookies" style={A}>Cookies</a>
      <span style={Dot}>•</span>
      <a href="mailto:support@barakafresh.com" style={A}>
        support@barakafresh.com
      </a>
    </div>
  );
}
