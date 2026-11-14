import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Personal Planner OS",
  description: "Your personal task notebook and productivity planner.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
