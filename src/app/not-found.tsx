export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#070a12", color: "#f8fafc" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "3rem", margin: 0, color: "#f59e0b" }}>404</h1>
        <p style={{ color: "#94a3b8", marginTop: "8px" }}>Page not found</p>
        <a href="/" style={{ display: "inline-block", marginTop: "16px", color: "#f59e0b", textDecoration: "none", fontWeight: 600 }}>Return Home →</a>
      </div>
    </div>
  );
}
