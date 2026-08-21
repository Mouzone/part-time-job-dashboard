import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Part-Time Job Dashboard",
  description: "Part-time job leads near 1601 Benson Ave, Brooklyn",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
