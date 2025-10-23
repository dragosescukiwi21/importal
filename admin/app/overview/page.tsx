"use client"

import { useAuth } from "@/src/context/AuthContext"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { SidebarLayout } from "@/components/sidebar-layout"
import { NavigationBreadcrumb } from "@/components/navigation-breadcrumb"
import { authApi } from "@/src/utils/apiClient"
import dynamic from "next/dynamic"

const StatisticsSection = dynamic(
  () => import('@/components/stat_section').then(mod => mod.StatisticsSection),
  { 
    ssr: false,
    loading: () => <div className="h-48 w-full bg-gray-900/50 rounded-lg animate-pulse"></div> 
  }
)

export default function OverviewPage() {
  const { isAuthenticated, isLoading: authLoading, user } = useAuth()
  const router = useRouter()
  const [testingLoading, setTestingLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handlePlanChange = async (planType: string) => {
    setTestingLoading(true)
    setMessage(null)
    try {
      const result = await authApi.changePlan(planType)
      setMessage(result.message)
      // Refresh the page to update the plan display
      setTimeout(() => window.location.reload(), 1000)
    } catch (error: any) {
      setMessage(`Error changing plan: ${error.response?.data?.detail || error.message}`)
    } finally {
      setTestingLoading(false)
    }
  }

  const handleResetUsage = async () => {
    setTestingLoading(true)
    setMessage(null)
    try {
      const result = await authApi.resetMonthlyUsage()
      setMessage(result.message)
      // Refresh the page to update the usage display
      setTimeout(() => window.location.reload(), 1000)
    } catch (error: any) {
      setMessage(`Error resetting usage: ${error.response?.data?.detail || error.message}`)
    } finally {
      setTestingLoading(false)
    }
  }

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
        { label: "Overview", current: true }
      ]} />

      <div className="p-8 max-w-7xl mx-auto">
        <div className="space-y-8">
          {/* Personalized Greeting */}
          <h1 className="text-3xl font-bold text-white">
            Hi, {user?.full_name || 'User'}!
          </h1>
          
          <StatisticsSection />

          {/* Testing Section - Development Only - Minimal */}
          <Card className="p-3 bg-yellow-900/10 border-yellow-600/20">
            <div className="flex flex-wrap gap-2">
              <Button 
                onClick={() => handlePlanChange('FREE')}
                disabled={testingLoading}
                size="sm"
                variant="outline"
                className="border-gray-600 text-gray-300 hover:bg-gray-800 text-xs h-7"
              >
                Free
              </Button>
              <Button 
                onClick={() => handlePlanChange('STARTER')}
                disabled={testingLoading}
                size="sm"
                variant="outline"
                className="border-green-600 text-green-400 hover:bg-green-900/20 text-xs h-7"
              >
                Starter
              </Button>
              <Button 
                onClick={() => handlePlanChange('PRO')}
                disabled={testingLoading}
                size="sm"
                variant="outline"
                className="border-blue-600 text-blue-400 hover:bg-blue-900/20 text-xs h-7"
              >
                Pro
              </Button>
              <Button 
                onClick={() => handlePlanChange('SCALE')}
                disabled={testingLoading}
                size="sm"
                variant="outline"
                className="border-purple-600 text-purple-400 hover:bg-purple-900/20 text-xs h-7"
              >
                Scale
              </Button>
              <Button 
                onClick={handleResetUsage}
                disabled={testingLoading}
                size="sm"
                variant="outline"
                className="border-red-600 text-red-400 hover:bg-red-900/20 text-xs h-7"
              >
                Reset Usage
              </Button>
            </div>
            {message && (
              <p className="text-xs text-yellow-300/80 mt-2">{message}</p>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="p-6 bg-gray-900/50 border-gray-800">
              <h3 className="text-lg font-semibold text-white">Recent Imports</h3>
              <p className="text-sm text-gray-400 mt-2">A list of recent import jobs will be displayed here.</p>
            </Card>
          </div>
        </div>
      </div>
    </SidebarLayout>
  )
}