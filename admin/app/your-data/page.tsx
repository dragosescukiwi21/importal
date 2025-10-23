"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { BarChart3 } from "lucide-react"
import Link from "next/link"
import { useAuth } from "@/src/context/AuthContext"
import { useRouter } from "next/navigation"
import { SidebarLayout } from "@/components/sidebar-layout"
import { NavigationBreadcrumb } from "@/components/navigation-breadcrumb"

export default function YourDataPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login')
      return
    }
  }, [isAuthenticated, authLoading, router])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p>Loading...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <SidebarLayout>
      <NavigationBreadcrumb items={[
        { label: "Your Data", current: true }
      ]} />

      <div className="p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Your Data Overview</h1>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">Total Records</h3>
              <p className="text-3xl font-bold text-primary">0</p>
              <p className="text-sm text-muted-foreground mt-2">No data imported yet</p>
            </div>
            
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">Import Jobs</h3>
              <p className="text-3xl font-bold text-primary">0</p>
              <p className="text-sm text-muted-foreground mt-2">No imports completed</p>
            </div>
            
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">Data Sources</h3>
              <p className="text-3xl font-bold text-primary">0</p>
              <p className="text-sm text-muted-foreground mt-2">No active sources</p>
            </div>
          </div>

          <div className="mt-8">
            <div className="bg-card border rounded-lg p-6 text-center">
              <h3 className="text-lg font-semibold mb-4">No Data Available</h3>
              <p className="text-muted-foreground mb-4">
                You haven't imported any data yet. Start by creating an importer and importing your first dataset.
              </p>
              <Link href="/dashboard">
                <Button className="gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Go to Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </SidebarLayout>
  )
}
