"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/src/context/AuthContext"

export default function HomePage() {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    // Don't redirect while still loading
    if (isLoading) return
    
    // Redirect based on authentication status
    if (isAuthenticated) {
      router.push('/overview')
    } else {
      router.push('/login')
    }
  }, [router, isAuthenticated, isLoading])

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <p>Redirecting...</p>
    </div>
  )
}
