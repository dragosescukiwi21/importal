"use client"

import { useState, useEffect, useCallback } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { importersApi } from "@/src/utils/apiClient"
import { generateSmartMappings, SmartMappingSuggestion } from "./smart-mapping"
import { Type, Mail, Phone, Calendar, Hash, ToggleLeft, ChevronDown, Asterisk, ArrowRight, AlertCircle } from 'lucide-react'

interface EnhancedMapColumnsStepProps {
  data: any
  onUpdate: (data: any) => void
  selectedImporter: string
}

// Utility function to get icon based on field type
const getFieldTypeIcon = (fieldType: string) => {
  const type = fieldType?.toLowerCase().trim() || ''
  
  // Email type
  if (type.includes('email') || type === 'email') {
    return <Mail className="h-4 w-4 text-muted-foreground" />
  }
  
  // Phone type
  if (type.includes('phone') || type === 'phone') {
    return <Phone className="h-4 w-4 text-muted-foreground" />
  }
  
  // Date type
  if (type.includes('date') || type === 'date') {
    return <Calendar className="h-4 w-4 text-muted-foreground" />
  }
  
  // Number type
  if (type.includes('number') || type === 'number' || type === 'integer' || type === 'float') {
    return <Hash className="h-4 w-4 text-muted-foreground" />
  }
  
  // Boolean type
  if (type.includes('bool') || type === 'boolean') {
    return <ToggleLeft className="h-4 w-4 text-muted-foreground" />
  }
  
  // Select type (dropdown)
  if (type.includes('select') || type === 'select') {
    return <ChevronDown className="h-4 w-4 text-muted-foreground" />
  }
  
  // Custom regex type (show special characters)
  if (type.includes('regex') || type === 'regex' || type === 'custom') {
    return <Asterisk className="h-4 w-4 text-muted-foreground" />
  }
  
  // Default to text type icon
  return <Type className="h-4 w-4 text-muted-foreground" />
}

export function EnhancedMapColumnsStep({ data, onUpdate, selectedImporter }: EnhancedMapColumnsStepProps) {
  const [mapping, setMapping] = useState<{ [key: string]: string }>({})
  const [fieldInclusion, setFieldInclusion] = useState<{ [key: string]: boolean }>({})
  const [importerFields, setImporterFields] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  // Fetch importer fields from backend when selectedImporter changes
  useEffect(() => {
    const fetchImporterFields = async () => {
      if (!selectedImporter) {
        console.log('EnhancedMapColumnsStep: No importer selected, clearing fields')
        setImporterFields([])
        return
      }

      console.log(`EnhancedMapColumnsStep: Fetching fields for importer ID: ${selectedImporter}`)
      setLoading(true)
      try {
        const importer = await importersApi.getImporter(selectedImporter)
        console.log('EnhancedMapColumnsStep: Received importer data:', importer)
        console.log('EnhancedMapColumnsStep: Importer fields:', importer.fields)
        console.log('EnhancedMapColumnsStep: Field names:', importer.fields?.map((f: any) => f.name))
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

  // Auto-apply smart mapping when CSV data and importer fields are available
  useEffect(() => {
    if (data.data && data.headers && importerFields.length > 0) {
      // Generate smart mappings in the background
      const smartMappings = generateSmartMappings(data.headers, data.data, importerFields)
      
      const newMapping: { [key: string]: string } = {}
      const newInclusion: { [key: string]: boolean } = {}

      // Initialize inclusion based on requirements
      importerFields.forEach(field => {
        newInclusion[field.name] = field.required || false
      })

      // Apply smart mappings automatically
      smartMappings.forEach(suggestion => {
        newMapping[suggestion.importerField] = suggestion.csvColumn
        // Auto-include high-confidence matches or required fields
        if (importerFields.find(f => f.name === suggestion.importerField)?.required || suggestion.confidence >= 70) {
          newInclusion[suggestion.importerField] = true
        }
      })

      setMapping(newMapping)
      setFieldInclusion(newInclusion)
    }
      }, [data.data, data.headers, importerFields])

  // Get sample data for a field (first 3 values)
  const getSampleData = (fieldName: string) => {
    const csvHeader = mapping[fieldName]
    if (csvHeader && data.data && data.data.length > 0) {
      const samples = data.data.slice(0, 3).map((row: any) => row[csvHeader]).filter((val: any) => val !== undefined && val !== null && val !== "")
      return samples.length > 0 ? samples.join(", ") : "No data"
    }
    return "—"
  }

  // Update parent component when mapping changes
  useEffect(() => {
    const timer = setTimeout(() => {
      onUpdate({ 
        mapping,
        fieldInclusion
      })
    }, 0)
    
    return () => clearTimeout(timer)
  }, [mapping, fieldInclusion])

  const handleMappingChange = useCallback((importerField: string, csvHeader: string) => {
    const newMapping = csvHeader === "__NO_MAPPING__" ? "" : csvHeader
    
    setMapping(prev => ({
      ...prev,
      [importerField]: newMapping
    }))

    // Auto-update inclusion based on mapping
    setFieldInclusion(prev => ({
      ...prev,
      [importerField]: newMapping !== "" || importerFields.find(f => f.name === importerField)?.required || false
    }))
  }, [importerFields])

  const handleInclusionChange = useCallback((fieldName: string, include: boolean) => {
    // Only allow turning off inclusion if there's no mapping
    if (!include && mapping[fieldName]) {
      return // Prevent turning off when there's a mapping
    }

    setFieldInclusion(prev => ({
      ...prev,
      [fieldName]: include
    }))
  }, [mapping])

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

  // Calculate mapping statistics
  const totalColumns = availableHeaders?.length || 0
  const mappedColumns = Object.values(mapping).filter(csvCol => csvCol).length
  const requiredFields = importerFields.filter(f => f.required)
  const unmappedRequired = requiredFields.filter(f => !mapping[f.name])

  return (
    <div className="space-y-6">
      {/* Status bar at the top */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          {mappedColumns}/{totalColumns} columns mapped
        </div>
        <div className="text-sm">
          {unmappedRequired.length > 0 ? (
            <span className="text-orange-500">
              Not mapped: {unmappedRequired.map(f => f.label || f.name).join(", ")}
            </span>
          ) : (
            <span className="text-green-500">
              All fields mapped
            </span>
          )}
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CSV HEADERS</TableHead>
              <TableHead></TableHead>
              <TableHead>IMPORTER FIELDS</TableHead>
              <TableHead>TYPE</TableHead>
              <TableHead>SAMPLE DATA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {availableHeaders?.map((csvHeader: string) => {
              // Find which importer field this CSV header is mapped to
              const mappedFieldName = Object.entries(mapping).find(
                ([fieldName, csvCol]) => csvCol === csvHeader
              )?.[0]
              
              const mappedField = mappedFieldName 
                ? importerFields.find(f => f.name === mappedFieldName)
                : null

              return (
                <TableRow key={csvHeader}>
                  {/* CSV Header Column - Static display only */}
                  <TableCell className="font-medium">
                    <div className="font-medium">{csvHeader}</div>
                  </TableCell>
                  
                  {/* Arrow Column */}
                  <TableCell className="w-12 text-center">
                    {mappedField && (
                      <ArrowRight className="h-4 w-4 text-muted-foreground inline" />
                    )}
                  </TableCell>
                  
                  {/* Importer Field Column - Dropdown to select which importer field to map to */}
                  <TableCell>
                    <Select 
                      value={mappedFieldName || "__NO_MAPPING__"} 
                      onValueChange={(value) => {
                        // First clear any existing mapping for this CSV header
                        const newMapping = { ...mapping }
                        Object.keys(newMapping).forEach(fieldName => {
                          if (newMapping[fieldName] === csvHeader) {
                            newMapping[fieldName] = ""
                          }
                        })
                        
                        // Then set the new mapping
                        if (value !== "__NO_MAPPING__") {
                          newMapping[value] = csvHeader
                        }
                        
                        setMapping(newMapping)
                        
                        // Update field inclusion
                        const newInclusion = { ...fieldInclusion }
                        if (value !== "__NO_MAPPING__") {
                          const field = importerFields.find(f => f.name === value)
                          newInclusion[value] = field?.required || true
                        }
                        setFieldInclusion(newInclusion)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select importer field" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__NO_MAPPING__">-</SelectItem>
                        {importerFields.map((field) => (
                          <SelectItem key={field.name} value={field.name}>
                            <div className="flex items-center gap-2">
                              <span>{field.label || field.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  
                  {/* Field Type Column - Shows type of the selected importer field */}
                  <TableCell className="text-muted-foreground text-sm">
                    {mappedField ? (
                      <div className="flex items-center gap-2">
                        {getFieldTypeIcon(mappedField.type)}
                        <span>{mappedField.type}</span>
                        {mappedField.required && (
                          <span className="inline-flex items-center justify-center rounded-full h-5 w-5 text-xs font-semibold border border-rose-400/50 bg-rose-950/50 text-rose-300">
                            !
                          </span>
                        )}
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  
                  {/* Sample Data Column - Shows sample data from CSV */}
                  <TableCell className="text-muted-foreground max-w-[200px] truncate text-sm">
                    {data.data && data.data.length > 0 ? (
                      data.data.slice(0, 3)
                        .map((row: any) => row[csvHeader])
                        .filter((val: any) => val !== undefined && val !== null && val !== "")
                        .join(", ") || "No data"
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
