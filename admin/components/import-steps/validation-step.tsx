"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Eye, AlertTriangle } from "lucide-react"
import { importersApi } from "@/src/utils/apiClient"
import { validateField } from "@/lib/validator"

interface ValidationStepProps {
  data: any
  onUpdate: (data: any) => void
  selectedImporter?: string
}

export function ValidationStep({ data, onUpdate, selectedImporter }: ValidationStepProps) {
  const [conflicts, setConflicts] = useState(0)
  const [validationResults, setValidationResults] = useState<any[]>([])
  const [importerFields, setImporterFields] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  // Fetch importer fields from backend when selectedImporter changes
  useEffect(() => {
    const fetchImporterFields = async () => {
      if (!selectedImporter) {
        setImporterFields([])
        return
      }

      setLoading(true)
      try {
        const importer = await importersApi.getImporter(selectedImporter)
        setImporterFields(importer.fields || [])
      } catch (error) {
        console.error('Failed to fetch importer fields:', error)
        setImporterFields([])
      } finally {
        setLoading(false)
      }
    }

    fetchImporterFields()
  }, [selectedImporter])
  
  // Get mapped fields that are included
  const mappedFields = Object.entries(data.mapping || {})
    .filter(([field, csvColumn]) => csvColumn && data.fieldInclusion?.[field])
    .map(([field, csvColumn]) => ({ field, csvColumn: csvColumn as string }))

  // Enhanced validation logic using centralized validator with chunked processing
  useEffect(() => {
    if (!data.data || !data.mapping || importerFields.length === 0) {
      setConflicts(0)
      setValidationResults([])
      return
    }

    // Process validation in chunks to avoid UI freezing
    const CHUNK_SIZE = 100 // Process 100 rows at a time
    let conflictCount = 0
    const results: any[] = []
    let currentChunk = 0

    // Create a map of field names to field configurations from importer configuration
    const fieldTypeMap = new Map<string, any>()
    importerFields.forEach(field => {
      fieldTypeMap.set(field.name, field)
    })

    const processChunk = () => {
      const startIdx = currentChunk * CHUNK_SIZE
      const endIdx = Math.min(startIdx + CHUNK_SIZE, data.data.length)
      
      // Process current chunk of rows
      for (let rowIndex = startIdx; rowIndex < endIdx; rowIndex++) {
        const row = data.data[rowIndex]
        Object.entries(data.mapping).forEach(([fieldName, csvColumn]) => {
          if (csvColumn && data.fieldInclusion?.[fieldName]) {
            const value = row[csvColumn as string]
            const fieldConfig = fieldTypeMap.get(fieldName)

            if (fieldConfig) {
              // ✅ CORRECTED: Simply pass the fieldConfig directly.
              // It already contains the `extra_rules` from the API.
              const errorMessage = validateField(value, fieldConfig);

              if (errorMessage) {
                conflictCount++
                results.push({
                  row: rowIndex + 1,
                  field: fieldName,
                  value: value || 'Empty',
                  csvColumn: csvColumn as string,
                  error: errorMessage
                })
              }
            }
          }
        })
      }

      currentChunk++
      
      // Check if there are more chunks to process
      if (startIdx + CHUNK_SIZE < data.data.length) {
        // Schedule next chunk processing
        setTimeout(processChunk, 0)
      } else {
        // All chunks processed, update state
        setConflicts(conflictCount)
        setValidationResults(results)
        
        // Update parent component with validation results
        onUpdate({
          validationResults: results,
          conflictCount: conflictCount,
          isValid: conflictCount === 0
        })
      }
    }

    // Start processing first chunk
    processChunk()

  }, [data.data, data.mapping, data.fieldInclusion, importerFields, onUpdate])

  
  const handleViewData = async () => {
    try {
      // Prepare data export structure for backend API
      const exportData = {
        totalRows: data.data?.length || 0,
        mappedFields: mappedFields,
        conflicts: validationResults,
        conflictCount: conflicts,
        csvData: data.data,
        mapping: data.mapping,
        fieldInclusion: data.fieldInclusion,
        headers: data.selectedHeaders || data.headers,  // Use selected headers for processing
        allHeaders: data.allHeaders || data.headers,    // Keep reference to all headers
        importerId: data.selectedImporter
      }
      
      console.log('Viewing data with validation results:', exportData)
      
      // Navigate to the CSV view page with the data
      // Open the view in a new window/tab
      const viewUrl = `/dashboard/imports/view?data=${encodeURIComponent(JSON.stringify(exportData))}`
      window.open(viewUrl, '_blank')
      
    } catch (error) {
      console.error('Failed to prepare data view:', error)
      alert('Failed to prepare data view. Please try again.')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header with compact summary */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-2">Review & Validate</h2>
          <p className="text-muted-foreground">
            Review your data mapping and validate before import
            {loading && " (Loading field definitions...)"}
          </p>
        </div>
        
        {/* Compact Summary */}
        <div className="flex items-center gap-6 text-sm">
          <div className="text-center">
            <div className="text-lg font-bold text-primary">{data.data?.length || 0}</div>
            <div className="text-xs text-muted-foreground">Total Rows</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-green-500">{mappedFields.length}</div>
            <div className="text-xs text-muted-foreground">Mapped Fields</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-bold ${conflicts > 0 ? 'text-red-500' : 'text-green-500'}`}>
              {conflicts}
            </div>
            <div className="text-xs text-muted-foreground">Conflicts</div>
          </div>
          {/* Small validation conflicts chip */}
          {conflicts > 0 && (
            <Badge variant="destructive" className="ml-4">
              {conflicts} validation conflict{conflicts !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </div>

      {/* Field Mappings */}
      <Card className="p-6 bg-background/20 border-muted/20">
        <h3 className="font-medium mb-4">Field Mappings</h3>
        <div className="space-y-2">
          {mappedFields.map((mapping, index) => (
            <div key={index} className="flex items-center justify-between p-3 rounded-lg border border-muted/20">
              <span className="font-medium">{mapping.csvColumn}</span>
              <span className="text-muted-foreground">→</span>
              <Badge variant="secondary">{mapping.field}</Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* View Data Button */}
      <Card className="p-6 bg-background/20 border-muted/20">
        <div className="text-center space-y-4">
          <h3 className="font-medium">Data Preview</h3>
          <p className="text-sm text-muted-foreground">
            View your mapped data with validation results before final import
          </p>
          <Button 
            onClick={handleViewData}
            variant="outline" 
            className="h-12 px-8 text-base"
          >
            <Eye className="h-5 w-5 mr-2" />
            View Data & Conflicts
          </Button>
        </div>
      </Card>
    </div>
  )
}
