"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FileSpreadsheet } from "lucide-react"

interface SheetSelectorProps {
  sheetNames: string[]
  selectedSheet: string
  onSheetChange: (sheetName: string) => void
  onContinue: () => void
}

export function SheetSelector({ sheetNames, selectedSheet, onSheetChange, onContinue }: SheetSelectorProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Select Worksheet</h2>
        <p className="text-muted-foreground">Choose which worksheet to import from your Excel file</p>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <FileSpreadsheet className="h-6 w-6 text-blue-500" />
            <div>
              <p className="font-medium">Available Worksheets</p>
              <p className="text-sm text-muted-foreground">
                {sheetNames.length} worksheet{sheetNames.length !== 1 ? 's' : ''} found
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="sheet-select" className="text-sm font-medium">
              Select Worksheet
            </label>
            <Select value={selectedSheet} onValueChange={onSheetChange}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a worksheet" />
              </SelectTrigger>
              <SelectContent>
                {sheetNames.map((sheetName) => (
                  <SelectItem key={sheetName} value={sheetName}>
                    {sheetName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="pt-4">
            <Button onClick={onContinue} className="w-full">
              Continue with Selected Worksheet
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

