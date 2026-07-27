import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "F1 Pit Wall",
  description: "Real-time F1 telemetry dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
