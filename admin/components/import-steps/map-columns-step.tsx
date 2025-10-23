"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { importersApi } from "@/src/utils/apiClient"

interface MapColumnsStepProps {
  data: any
  onUpdate: (data: any) => void
  selectedImporter: string
}

export function MapColumnsStep({ data, onUpdate, selectedImporter }: MapColumnsStepProps) {
  const [mapping, setMapping] = useState<{ [key: string]: string }>({})
  const [fieldInclusion, setFieldInclusion] = useState<{ [key: string]: boolean }>({})
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
        // Assuming the importer has a 'fields' property with the field definitions
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

  // Initialize field inclusion
  useEffect(() => {
    const initialInclusion: { [key: string]: boolean } = {}
    importerFields.forEach(field => {
      initialInclusion[field.name] = field.required
    })
    setFieldInclusion(initialInclusion)
  }, [])

  // Get sample data for a field
  const getSampleData = (fieldName: string) => {
    const csvHeader = mapping[fieldName]
    if (csvHeader && data.data && data.data.length > 0) {
      return data.data[0][csvHeader] || "No data"
    }
    
    return "—"
  }

  // Only call onUpdate when mapping actually changes, not on every render
  useEffect(() => {
    const timer = setTimeout(() => {
      onUpdate({ 
        mapping,
        fieldInclusion: fieldInclusion
      })
    }, 0)
    
    return () => clearTimeout(timer)
  }, [mapping, fieldInclusion])

  const handleMappingChange = useCallback((importerField: string, csvHeader: string) => {
    setMapping(prev => ({
      ...prev,
      [importerField]: csvHeader === "__NO_MAPPING__" ? "" : csvHeader
    }))
  }, [])

  const handleInclusionChange = useCallback((fieldName: string, include: boolean) => {
    setFieldInclusion(prev => ({
      ...prev,
      [fieldName]: include
    }))
  }, [])

  // Use allHeaders for dropdown options, fallback to headers for backward compatibility
  const availableHeaders = data.allHeaders || data.headers

  if (!availableHeaders || availableHeaders.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Please select headers first</p>
      </div>
    )
  }

  if (!selectedImporter) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Please select an importer first</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Loading importer fields...</p>
      </div>
    )
  }

  if (importerFields.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No fields found for this importer</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Map Your Columns</h2>
        <p className="text-muted-foreground">Map your CSV columns to the destination fields</p>
      </div>

      <Card className="p-6 bg-background/20 border-muted/20">
        <Table>
          <TableHeader>
            <TableRow className="border-muted/20">
              <TableHead className="text-xs font-medium text-muted-foreground uppercase">Destination Field</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase">Your CSV Column</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase">Sample Data</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase">Include</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {importerFields.map((field) => (
              <TableRow key={field.name} className="border-muted/20">
                <TableCell className="font-medium">
                  <div>
                    <div className="font-medium">{field.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {field.required ? '• Required' : '• Optional'}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Select 
                    value={mapping[field.name] || "__NO_MAPPING__"} 
                    onValueChange={(value) => handleMappingChange(field.name, value)}
                  >
                    <SelectTrigger className="bg-background/50 border-muted/30">
                      <SelectValue placeholder="Select CSV column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__NO_MAPPING__">-- No mapping --</SelectItem>
                      {availableHeaders?.map((header: string) => (
                        <SelectItem key={header} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[200px] truncate">
                  {mapping[field.name] ? getSampleData(field.name) : "—"}
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={fieldInclusion[field.name] || false}
                    onCheckedChange={(checked) => handleInclusionChange(field.name, checked === true)}
                    disabled={field.required}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          {Object.keys(mapping).filter(key => mapping[key] && fieldInclusion[key]).length} of {importerFields.length} fields will be imported
        </p>
      </div>
    </div>
  )
}
