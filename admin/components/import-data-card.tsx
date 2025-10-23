"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X, Upload, Settings, CheckCircle2, FileText, Check } from "lucide-react"
import { importersApi, importsApi } from "@/src/utils/apiClient"

// Import the step components
import { UploadStep } from "./import-steps/upload-step"
import { HeadersStep } from "./import-steps/headers-step" 
import { EnhancedMapColumnsStep } from "./import-steps/enhanced-map-columns-step"
import { ValidationStep } from "./import-steps/validation-step"

interface ImportDataCardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  importers: Importer[]
  onImportComplete?: () => void
}

interface Importer {
  id: string
  name: string
  description?: string
  fields: any[]
}

const steps = [
  { id: 1, title: "Upload", description: "Upload your CSV file", icon: Upload },
  { id: 2, title: "Headers", description: "Select column headers", icon: FileText },
  { id: 3, title: "Map Columns", description: "Map your data columns", icon: Settings },
  { id: 4, title: "Validation", description: "Review and validate", icon: CheckCircle2 }
]

export function ImportDataCard({ open, onOpenChange, importers, onImportComplete }: ImportDataCardProps) {
  const [currentStep, setCurrentStep] = useState(1)
  const [importData, setImportData] = useState<any>({
    file: null,
    headers: [],
    mappings: [],
    data: []
  })
  const [selectedImporter, setSelectedImporter] = useState<string>("")
  const [isLoading, setIsLoading] = useState(false)

  // Memoize the first importer ID to prevent unnecessary re-renders
  const defaultImporterId = useMemo(() => {
    return importers && importers.length > 0 ? importers[0].id : ""
  }, [importers])

  // Initialize selected importer only when modal opens or importers change significantly
  useEffect(() => {
    if (open && defaultImporterId && !selectedImporter) {
      setSelectedImporter(defaultImporterId)
    }
  }, [open, defaultImporterId, selectedImporter])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setCurrentStep(1)
      setImportData({ file: null, headers: [], mappings: [], data: [] })
      setSelectedImporter("")
    }
  }, [open])

  // Prevent background scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    
    // Cleanup on unmount
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [open])

  const handleDataUpdate = useCallback((newData: any) => {
    setImportData((prev: any) => ({ ...prev, ...newData }))
  }, [])

  const handleImporterChange = useCallback((value: string) => {
    setSelectedImporter(value)
    // Reset step data when importer changes
    setImportData({ file: null, headers: [], mappings: [], data: [] })
    setCurrentStep(1)
  }, [])

  const handleNext = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const updateImportData = useCallback((data: Partial<typeof importData>) => {
    console.log('updateImportData called with:', {
      ...data,
      // Log only summary info for large arrays to avoid console overflow
      allHeaders: data.allHeaders ? `[${data.allHeaders.length} headers]` : data.allHeaders,
      headers: data.headers ? `[${data.headers.length} headers]` : data.headers,
      data: data.data ? `[${data.data.length} rows]` : data.data,
    })
    setImportData((prev: any) => {
      const newData = { ...prev, ...data }
      console.log('New importData state summary:', {
        hasFile: !!newData.file,
        fileName: newData.file?.name,
        allHeaders: newData.allHeaders?.length || 0,
        headers: newData.headers?.length || 0,
        selectedHeaders: newData.selectedHeaders?.length || 0,
        dataRows: newData.data?.length || 0,
        upload_id: newData.upload_id,
        file_path: newData.file_path
      })
      return newData
    })
  }, [])

  const handleFinish = async () => {
    try {
      setIsLoading(true)
      
      // Prepare data for backend import API (allow imports with conflicts)
      const conflictCount = importData.conflictCount || 0
      const importPayload = {
        upload_id: importData.upload_id,       // Include upload ID from temp upload
        file_path: importData.file_path,       // Include S3 path
        file_name: importData.file?.name,      // Include original filename
        importer_id: selectedImporter,
        headers: importData.selectedHeaders || importData.headers || [],
        mapping: importData.mapping || {},
        field_inclusion: importData.fieldInclusion || {},
        csv_data: importData.data || [],
        validation_results: importData.validationResults || [],
        conflict_count: conflictCount,
        is_valid: importData.isValid !== false && conflictCount === 0,
        total_rows: (importData.data || []).length
      }

      console.log('Starting import process with payload:', importPayload)
      
      // Execute the import via the backend API (this will CREATE the import job)
      const result = await importsApi.executeImport(importPayload)
      
      console.log('Import result:', result)
      
      // Handle different outcomes based on conflicts
      if (conflictCount > 0) {
        // Save with conflicts and redirect to solve them
        alert(`Data saved with ${conflictCount} conflicts.\nRedirecting to solve conflicts...`)
        
        // Call the callback to refresh the dashboard
        if (onImportComplete) {
          onImportComplete()
        }
        
        onOpenChange(false)
        
        // Redirect to the view page to solve conflicts
        window.location.href = `/dashboard/imports/${result.import_id}/view`
      } else {
        // Show success message for completed import
        alert(`Import completed successfully!\nJob ID: ${result.import_id}\nImported Rows: ${result.imported_rows}\nWebhook: ${result.webhook_status}`)
        
        // Call the callback to refresh the dashboard
        if (onImportComplete) {
          onImportComplete()
        }
        
        onOpenChange(false)
      }
    } catch (error: any) {
      console.error('Import failed:', error)
      
      let errorMessage = 'Import failed. Please try again.'
      if (error.response?.data?.detail) {
        if (typeof error.response.data.detail === 'string') {
          errorMessage = error.response.data.detail
        } else if (Array.isArray(error.response.data.detail)) {
          errorMessage = error.response.data.detail.map((d: any) => d.msg || d.message || String(d)).join(', ')
        }
      } else if (error.message) {
        errorMessage = error.message
      }
      
      alert(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <UploadStep data={{...importData, importer_id: selectedImporter}} onUpdate={updateImportData} />
      case 2:
        return <HeadersStep data={importData} onUpdate={updateImportData} />
      case 3:
        return <EnhancedMapColumnsStep data={importData} onUpdate={updateImportData} selectedImporter={selectedImporter} />
      case 4:
        return <ValidationStep data={importData} onUpdate={updateImportData} selectedImporter={selectedImporter} />
      default:
        return null
    }
  }

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        // Can proceed if file is uploaded, importer selected, AND headers have been parsed
        const hasHeaders = (importData.allHeaders && importData.allHeaders.length > 0) || 
                          (importData.headers && importData.headers.length > 0)
        const canProceedStep1 = importData.file && selectedImporter && hasHeaders
        console.log('canProceed step 1:', { 
          hasFile: !!importData.file, 
          fileName: importData.file?.name,
          hasHeaders,
          allHeaders: importData.allHeaders?.length || 0,
          headers: importData.headers?.length || 0,
          selectedImporter, 
          canProceed: canProceedStep1 
        })
        return canProceedStep1
      case 2:
        return (importData.selectedHeaders || importData.headers) && 
               (importData.selectedHeaders || importData.headers).length > 0
      case 3:
        // Check if there are mapped fields that are also included
        return importData.mapping && importData.fieldInclusion && 
               Object.keys(importData.mapping).some(key => 
                 importData.mapping[key] && importData.fieldInclusion[key]
               )
      case 4:
        // For final step, allow proceeding with or without conflicts
        // Just need to have some data to import
        return importData.data && importData.data.length > 0
      default:
        return false
    }
  }

  return (
    <>
      {open && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          style={{ left: '280px' }}
          onClick={(e) => {
            // Close modal when clicking on backdrop
            if (e.target === e.currentTarget) {
              onOpenChange(false)
            }
          }}
        >
          <Card className="w-full max-w-6xl max-h-[95vh] overflow-hidden bg-background border-border/40 shadow-2xl mx-auto flex flex-col">
        {/* Unified Header with Importer Selection and Minimalist Steps */}
        <div className="flex-shrink-0 border-b bg-muted/30">
          {/* Close button */}
          <div className="absolute top-4 right-4 z-10">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Importer Selection */}
          <div className="px-6 pt-4 pb-6">
            <Select 
              value={selectedImporter || undefined} 
              onValueChange={handleImporterChange} 
              disabled={isLoading}
            >
              <SelectTrigger className="w-full max-w-md">
                <SelectValue 
                  placeholder={isLoading ? "Loading templates..." : "Choose an import template"} 
                />
              </SelectTrigger>
              <SelectContent>
                {importers?.filter(importer => importer.id && importer.id.trim() !== "").map((importer) => (
                  <SelectItem key={importer.id} value={importer.id} className="cursor-pointer">
                    <div className="flex flex-col items-start">
                      <div className="font-medium">{importer.name}</div>
                      {importer.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">{importer.description}</div>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!selectedImporter && (
              <div className="text-sm text-orange-500 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-md p-3 mt-2">
                ⚠️ Please select an import template to continue
              </div>
            )}
          </div>

          {/* Minimalist Progress Steps spanning full width with proper margins */}
          <div className="px-16 pb-6">
            <div className="relative w-full h-16">
              {/* Progress line background - positioned to go through circle centers */}
              <div className="absolute left-0 right-0 h-0.5 bg-muted-foreground/20" style={{ top: '2.25rem' }} />
              
              {/* Active progress line */}
              <div 
                className="absolute left-0 h-0.5 bg-primary transition-all duration-500 ease-in-out"
                style={{ 
                  top: '2.25rem',
                  width: `${((currentStep - 1) / (steps.length - 1)) * 100}%`
                }}
              />

              {steps.map((step, index) => {
                const isCompleted = index < currentStep - 1;
                const isCurrent = index === currentStep - 1;
                
                return (
                  <div 
                    key={step.id} 
                    className="absolute"
                    style={{
                      left: `${(index / (steps.length - 1)) * 100}%`,
                      transform: 'translateX(-50%)',
                    }}
                  >
                    {/* Step name above circle */}
                    <div className="text-center mb-4">
                      <span className={`text-sm font-medium whitespace-nowrap ${
                        isCompleted || isCurrent
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      }`}>
                        {step.title}
                      </span>
                    </div>

                    {/* Circle indicator - perfectly centered on line */}
                    <div 
                      className={`w-4 h-4 rounded-full transition-all duration-300 ${
                        isCompleted
                          ? 'bg-primary'
                          : isCurrent
                            ? 'bg-primary'
                            : 'bg-muted-foreground border-2 border-border'
                      }`}
                      style={{ 
                        position: 'absolute',
                        top: '2.21rem',
                        left: '50%',
                        transform: 'translate(-50%, -50%)'
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Step Content */}
        <div className="flex-1 p-6 overflow-y-auto min-h-0">
          <div className="max-w-4xl mx-auto h-full">
            {renderStep()}
          </div>
        </div>

        {/* Footer - Fixed at bottom */}
        <div className="flex-shrink-0 flex items-center justify-between p-4 border-t border-border/40 bg-muted/20">
          <Button 
            variant="outline" 
            onClick={handlePrevious} 
            disabled={currentStep === 1}
            className="h-10 px-6"
          >
            Previous
          </Button>
          
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Step {currentStep} of {steps.length}
            </span>
            {currentStep === steps.length ? (
              <Button 
                onClick={handleFinish} 
                disabled={!canProceed() || isLoading} 
                className="h-10 px-8"
                variant={(importData.conflictCount || 0) > 0 ? "destructive" : "default"}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {isLoading ? "Processing..." : 
                 (importData.conflictCount || 0) > 0 ? 
                 "Solve Conflicts" : 
                 "Import Data"}
              </Button>
            ) : (
              <Button onClick={handleNext} disabled={!canProceed()} className="h-10 px-6">
                Next
                <FileText className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
      )}
    </>
  )
}
