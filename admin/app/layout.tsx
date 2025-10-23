import "@/styles/globals.css"
import { Inter } from "next/font/google"
import type React from "react"
import { AuthProvider } from "@/src/context/AuthContext"
import { SidebarLayout } from "@/components/sidebar-layout"

const inter = Inter({ subsets: ["latin"] })

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}

export const metadata = {
      generator: 'importer'
    };
