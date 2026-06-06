import type { Metadata } from "next"
import { Bricolage_Grotesque, Inter } from "next/font/google"
import "./globals.css"

const bricolage = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "PTTR CRM",
  description: "CRM & analytics for PETTR trade services",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${bricolage.variable} ${inter.variable} antialiased`}>
        {children}
      </body>
    </html>
  )
}
