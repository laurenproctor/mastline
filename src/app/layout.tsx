import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mastline — Paparazzi Business OS",
  description:
    "From assignment to payment, keep every shoot, image, submission, and dollar in one place.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
