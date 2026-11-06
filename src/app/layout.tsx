import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BakeryOps AI",
  description: "A human and AI collaboration workspace for bakery production.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
