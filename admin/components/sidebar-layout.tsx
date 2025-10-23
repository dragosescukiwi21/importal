"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Wallet, Home, BarChart3, Database, LifeBuoy, Settings, LogOut} from "lucide-react"
import Link from "next/link"
import { useAuth } from "@/src/context/AuthContext"
import { useRouter, usePathname } from "next/navigation"
import FramerLoadingSpinner from "@/components/FramerLoadingSpinner"

// 1. Define navigation items as data. This makes it easy to update!
const navItems = [
  { href: '/overview', label: 'Overview', icon: Home },
  { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { href: '/your-data', label: 'Your Data', icon: Database },
];

const helpAndSettingsItems = [
  { href: '/support', label: 'Support', icon: LifeBuoy },
  { href: '/settings', label: 'Settings', icon: Settings },
];

// The Sidebar component for better separation of concerns
function Sidebar({ user, logout }: { user: any, logout: () => void }) {
  const pathname = usePathname(); // Hook to get the current URL

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-[280px] flex-col border-r bg-background/50 backdrop-blur z-10">
      {/* Header */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b px-4">
        <Wallet className="h-5 w-5" />
        <span className="font-semibold text-sm">Importal</span>
      </div>

      {/* This new structure uses flexbox for a more robust layout */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {/* Main Navigation */}
        <div className="flex-1 px-3 py-3">
          <Input placeholder="Search" className="bg-background/50 border-0 h-8 text-sm" />
          <nav className="mt-4 space-y-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Button
                  key={item.label}
                  variant={isActive ? 'secondary' : 'ghost'} // 2. Highlight active link
                  className="w-full justify-start gap-3 h-9 px-3 text-sm font-normal"
                  asChild
                >
                  <Link href={item.href}>
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Section: Help, Settings, and User Profile */}
        <div className="shrink-0 p-3 mt-auto border-t bg-background/50">
          <nav className="space-y-1">
            {helpAndSettingsItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Button
                  key={item.label}
                  variant={isActive ? 'secondary' : 'ghost'}
                  className="w-full justify-start gap-3 h-9 px-3 text-sm font-normal"
                  asChild // ✅ 3. Fixed: asChild prop makes the link work
                >
                  <Link href={item.href}>
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </Button>
              );
            })}
          </nav>

          <div className="border-t pt-3 mt-3">
            {/* User Profile Section */}
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
                {user?.full_name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{user?.full_name || 'User'}</div>
              </div>
              <Button variant="ghost" size="icon" onClick={logout}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function SidebarLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isAuthenticated, isLoading: authLoading, logout, user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, authLoading, router])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <FramerLoadingSpinner size="lg" text="Loading dashboard..." />
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  // Don't show sidebar on login/signup pages
  if (pathname === '/login' || pathname === '/signup') {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* New Improved Sidebar */}
      <Sidebar user={user} logout={logout} />

      {/* Main Content Area with Sidebar Padding */}
      <div className="pl-[280px]">
        {children}
      </div>
    </div>
  )
} 