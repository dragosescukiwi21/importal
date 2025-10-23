import React from "react"
import Link from "next/link"
import { ChevronRight, Home } from "lucide-react"
import { 
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator 
} from "@/components/ui/breadcrumb"

export interface BreadcrumbItem {
  label: string
  href?: string
  current?: boolean
}

interface NavigationBreadcrumbProps {
  items: BreadcrumbItem[]
  actions?: React.ReactNode
}

export function NavigationBreadcrumb({ items, actions }: NavigationBreadcrumbProps) {
  return (
    <div className="sticky top-0 z-20 border-b bg-background/50 backdrop-blur px-8 py-3 h-[52px] flex items-center justify-between">
      <Breadcrumb>
        <BreadcrumbList>
          {/* Render breadcrumb items */}
          {items.map((item, index) => (
            <React.Fragment key={index}>
              {index > 0 && (
                <BreadcrumbSeparator>
                  <ChevronRight className="w-3 h-3 text-gray-600" />
                </BreadcrumbSeparator>
              )}
              <BreadcrumbItem>
                {item.current || !item.href ? (
                  <BreadcrumbPage className="text-sm font-medium text-gray-300">
                    {item.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link 
                      href={item.href}
                      className="text-sm font-medium text-gray-400 hover:text-white transition-colors"
                    >
                      {item.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      
      {/* Optional actions on the right side */}
      {actions && (
        <div className="flex items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}
