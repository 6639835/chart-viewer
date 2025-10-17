import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import UpdateNotification from "@/components/UpdateNotification";

export const metadata: Metadata = {
  title: "Chart Viewer - EFB",
  description: "Electronic Flight Bag Chart Viewer",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <UpdateNotification />
        </ThemeProvider>
      </body>
    </html>
  );
}
