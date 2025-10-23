"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { FileText } from "lucide-react"

interface HeadersStepProps {
  data: any
  onUpdate: (data: any) => void
}

export function HeadersStep({ data, onUpdate }: HeadersStepProps) {
  const [selectedHeaders, setSelectedHeaders] = useState<string[]>([])

  useEffect(() => {
    if (data.allHeaders && data.allHeaders.length > 0) {
      // Default to selecting all headers for better UX
      setSelectedHeaders(data.selectedHeaders || data.allHeaders)
      onUpdate({ selectedHeaders: data.selectedHeaders || data.allHeaders })
    } else if (data.headers && data.headers.length > 0) {
      // Fallback for backward compatibility
      setSelectedHeaders(data.headers)
      onUpdate({ selectedHeaders: data.headers })
    }
  }, [data.allHeaders, data.selectedHeaders, data.headers, onUpdate])

  const handleHeaderToggle = (header: string, checked: boolean) => {
    const newHeaders = checked 
      ? [...selectedHeaders, header] 
      : selectedHeaders.filter((h) => h !== header)
    setSelectedHeaders(newHeaders)
    onUpdate({ selectedHeaders: newHeaders })
  }

  // Debug logging for development
  console.log('HeadersStep - data.allHeaders:', data.allHeaders)
  console.log('HeadersStep - data.selectedHeaders:', data.selectedHeaders)
  console.log('HeadersStep - selectedHeaders:', selectedHeaders)

  // Use allHeaders for display, fallback to headers for backward compatibility
  const availableHeaders = data.allHeaders || data.headers
  
  if (!availableHeaders || availableHeaders.length === 0) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="max-w-md mx-auto text-center">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No Headers Found</h3>
          <p className="text-muted-foreground">Please upload a valid CSV file with headers in the first row.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 min-h-[400px]">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Select Column Headers</h2>
        <p className="text-muted-foreground">Choose which columns from your CSV file to include in the import.</p>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">Available Headers ({availableHeaders.length})</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const allSelected = selectedHeaders.length === availableHeaders.length
                const newHeaders = allSelected ? [] : [...availableHeaders]
                setSelectedHeaders(newHeaders)
                onUpdate({ selectedHeaders: newHeaders })
              }}
            >
              {selectedHeaders.length === availableHeaders.length ? "Deselect All" : "Select All"}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {availableHeaders.map((header: string, index: number) => {
              const isSelected = selectedHeaders.includes(header)
              return (
                <div 
                  key={index} 
                  className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                >
                  <Checkbox
                    id={`header-${index}`}
                    checked={isSelected}
                    onCheckedChange={(checked) => handleHeaderToggle(header, checked as boolean)}
                  />
                  <label 
                    htmlFor={`header-${index}`} 
                    className="text-sm font-medium cursor-pointer flex-1"
                  >
                    {header}
                  </label>
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p>{selectedHeaders.length} of {availableHeaders.length} columns selected</p>
        <p>All columns are always visible</p>
      </div>
    </div>
  )
}
