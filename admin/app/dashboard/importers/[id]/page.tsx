//importers/[id]/page.tsx

"use client"

import { useState, useEffect, FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Edit, Trash2, Copy, ExternalLink, PlusCircle, Plus, Save } from "lucide-react"
import Link from "next/link"
import { useRouter, useParams } from "next/navigation"
import { importersApi } from "@/src/utils/apiClient"
import { 
  FORMAT_OPTIONS_CONFIG, 
  prepareFieldForApi, 
  mapExtraRulesToFormatOption 
} from "@/src/utils/importerUtils"
import { NavigationBreadcrumb } from "@/components/navigation-breadcrumb"

// Field types available for selection
const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "boolean", label: "Boolean" },
  { value: "select", label: "Select" },
  { value: "custom_regex", label: "Custom Regex" },
]

// Field interface matching backend schema
interface ImporterField {
  name: string
  display_name?: string
  type: string
  required: boolean
  description?: string
  must_match: boolean
  not_blank: boolean
  example?: string
  validation_error_message?: string
  extra_rules?: Record<string, any>
  // UI-only field for format options
  formatOption?: string
}

// Importer interface matching backend schema
interface Importer {
  id: string
  key: string
  name: string
  description?: string
  fields: ImporterField[]
  webhook_url?: string
  webhook_enabled: boolean
  include_data_in_webhook?: boolean
  webhook_data_sample_size?: number
  include_unmatched_columns: boolean
  filter_invalid_rows: boolean
  disable_on_invalid_rows: boolean
  user_id: string
  created_at: string
  updated_at?: string
}

export default function ImporterDetailsPage() {
  const router = useRouter()
  const params = useParams()
  const importerId = params.id as string

  const [importer, setImporter] = useState<Importer | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // State for the field editor modal
  const [showFieldDialog, setShowFieldDialog] = useState(false)
  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null)
  const [fieldForm, setFieldForm] = useState<ImporterField>({
    name: '',
    display_name: '',
    type: 'text',
    required: false,
    description: '',
    must_match: false,
    not_blank: false,
    example: '',
    validation_error_message: '',
    extra_rules: {},
    formatOption: 'Any',
  })

  useEffect(() => {
    if (importerId) {
      fetchImporter()
    }
  }, [importerId])

  const fetchImporter = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await importersApi.getImporter(importerId)
      setImporter(data)
    } catch (err: any) {
      console.error('Error fetching importer:', err)
      setError(err.message || 'An error occurred while fetching the importer')
      if (err.response && err.response.status === 404) {
        setError('Importer not found')
      }
    } finally {
      setIsLoading(false)
    }
  }

  // --- Field Management Handlers (New Logic) ---

  const resetFieldForm = () => {
    setFieldForm({
      name: '',
      display_name: '',
      type: 'text',
      required: false,
      description: '',
      must_match: false,
      not_blank: false,
      example: '',
      validation_error_message: '',
      extra_rules: {},
      formatOption: 'Any',
    })
    setEditingFieldIndex(null)
  }

  const openNewFieldDialog = () => {
    resetFieldForm()
    setShowFieldDialog(true)
  }

  const openEditFieldDialog = (index: number) => {
    if (importer) {
      const field = importer.fields[index]
      const formatOption = mapExtraRulesToFormatOption(field)
      setFieldForm({ ...field, formatOption })
      console.log(`🔍 [openEditFieldDialog] index=${index} derived formatOption=`, formatOption, 'field.extra_rules=', field.extra_rules)
      setEditingFieldIndex(index)
      setShowFieldDialog(true)
    }
  }


  const handleSaveField = async () => {
    if (!importer || !fieldForm.name.trim()) {
      return // Basic validation
    }
    
    console.log("1️⃣ [handleSaveField] Raw form state from dialog:", fieldForm)

    // Prepare the field with extra_rules for storage
    const fieldWithExtraRules = prepareFieldForApi(fieldForm)
    // But keep formatOption for UI purposes
    const fieldToStore = { ...fieldWithExtraRules, formatOption: fieldForm.formatOption }
    
    console.log("1.5️⃣ [handleSaveField] Field to store with extra_rules:", fieldToStore)

    let updatedFields: ImporterField[]
    if (editingFieldIndex !== null) {
      // Update existing field
      updatedFields = importer.fields.map((f, i) => i === editingFieldIndex ? fieldToStore : f)
    } else {
      // Add new field
      updatedFields = [...importer.fields, fieldToStore]
    }
    
    // Close modal and reset form state
    setShowFieldDialog(false)
    resetFieldForm()

    try {
      // Optimistic UI update
      setImporter({ ...importer, fields: updatedFields })
      // API call to persist changes
      await importersApi.updateImporter(importer.id, { fields: updatedFields })
    } catch (err) {
      console.error('Failed to save field:', err)
      setError('Failed to save field. Reverting changes.')
      // Revert UI on failure
      fetchImporter()
    }
  }

  const handleDeleteField = async (indexToDelete: number) => {
    if (!importer || !confirm('Are you sure you want to remove this field?')) {
      return
    }

    const updatedFields = importer.fields.filter((_, index) => index !== indexToDelete)
    
    try {
      // Optimistic UI update
      setImporter({ ...importer, fields: updatedFields })
      // API call
      await importersApi.updateImporter(importer.id, { fields: updatedFields })
    } catch (err) {
      console.error('Failed to delete field:', err)
      setError('Failed to delete field. Reverting changes.')
      fetchImporter()
    }
  }

  // --- Other Handlers ---

  const handleDelete = async () => {
    if (!importer || !confirm('Are you sure you want to delete this importer? This action cannot be undone.')) {
      return
    }
    try {
      await importersApi.deleteImporter(importer.id)
      router.push('/dashboard')
    } catch (err: any) {
      console.error('Error deleting importer:', err)
      setError(err.message || 'An error occurred while deleting the importer')
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  if (isLoading) {
    return <div className="min-h-screen bg-black text-white flex items-center justify-center"><p>Loading importer...</p></div>
  }

  if (error || !importer) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="border-b bg-background/30 backdrop-blur px-8 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard" className="gap-2"><ArrowLeft className="h-4 w-4" />Back to Dashboard</Link>
            </Button>
            <h1 className="text-2xl font-semibold">Importer Not Found</h1>
          </div>
        </div>
        <div className="p-8 max-w-4xl mx-auto">
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-md">{error}</div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* New Field Editor Dialog */}
      <Dialog open={showFieldDialog} onOpenChange={setShowFieldDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingFieldIndex !== null ? 'Edit Field' : 'Add New Field'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="field-name">Field Name *</Label>
              <Input
                id="field-name"
                value={fieldForm.name}
                onChange={(e) => setFieldForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="field_name"
              />
            </div>

            <div>
              <Label htmlFor="display-name">Display Name</Label>
              <Input
                id="display-name"
                value={fieldForm.display_name || ''}
                onChange={(e) => setFieldForm(prev => ({ ...prev, display_name: e.target.value }))}
                placeholder="Field Display Name"
              />
            </div>

            <div>
              <Label htmlFor="field-type">Format *</Label>
              <div className="flex gap-2 items-center">
                <Select value={fieldForm.type} onValueChange={(value) => setFieldForm(prev => ({ ...prev, type: value, formatOption: 'Any' }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select format" />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Right-side dropdown for special formats */}
                {fieldForm.type === 'number' && (
                  <Select
                    value={fieldForm.formatOption || 'Any'}
                    onValueChange={(value) => setFieldForm(prev => ({ ...prev, formatOption: value }))}
                  >
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Any">Any</SelectItem>
                      <SelectItem value="Positive">Positive</SelectItem>
                      <SelectItem value="Negative">Negative</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {fieldForm.type === 'date' && (
                  <Select
                    value={fieldForm.formatOption || 'Any'}
                    onValueChange={(value) => setFieldForm(prev => ({ ...prev, formatOption: value }))}
                  >
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Any">Any</SelectItem>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                      <SelectItem value="YYYY/MM/DD">YYYY/MM/DD</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {fieldForm.type === 'boolean' && (
                  <Select
                    value={fieldForm.formatOption || 'Any'}
                    onValueChange={(value) => setFieldForm(prev => ({ ...prev, formatOption: value }))}
                  >
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Any">Any</SelectItem>
                      <SelectItem value="True/False">True/False</SelectItem>
                      <SelectItem value="Yes/No">Yes/No</SelectItem>
                      <SelectItem value="1/0">1/0</SelectItem>
                      <SelectItem value="on/off">On/Off</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="example-value">Example Value</Label>
              <Input
                id="example-value"
                value={fieldForm.example || ''}
                onChange={(e) => setFieldForm(prev => ({ ...prev, example: e.target.value }))}
                placeholder="Example value"
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={fieldForm.description || ''}
                onChange={(e) => setFieldForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Field description"
                rows={2}
              />
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="required-switch"
                checked={fieldForm.required}
                onCheckedChange={(checked) => setFieldForm(prev => ({ ...prev, required: checked }))}
              />
              <Label htmlFor="required-switch">Required Field</Label>
            </div>

            <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setShowFieldDialog(false)}>Cancel</Button>
                <Button type="button" onClick={handleSaveField} disabled={!fieldForm.name.trim()}>
                  {editingFieldIndex !== null ? 'Update Field' : 'Add Field'}
                </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <div className="min-h-screen bg-black text-white">
        {/* Navigation Breadcrumb */}
        <NavigationBreadcrumb items={[
          { label: "Importers", href: "/dashboard" },
          { label: importer.name, current: true }
        ]} />

        {/* Content */}
        <div className="p-8 max-w-6xl mx-auto space-y-8">
          {/* Basic Information Card ... (omitted for brevity) */}

          {/* Fields Configuration */}
          <Card className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Fields Configuration</h2>
              <Button variant="outline" size="sm" className="gap-2" onClick={openNewFieldDialog}>
                <PlusCircle className="h-4 w-4" />
                Add Field
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Validation</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importer.fields.map((field, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <div className="font-medium">{field.display_name || field.name}</div>
                        <code className="text-xs text-muted-foreground">{field.name}</code>
                      </TableCell>
                      <TableCell><Badge variant="outline">{field.type}</Badge></TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {field.required && <Badge variant="outline" className="text-xs">Required</Badge>}
                          {field.must_match && <Badge variant="outline" className="text-xs">Must Match</Badge>}
                          {field.not_blank && <Badge variant="outline" className="text-xs">Not Blank</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-sm text-muted-foreground truncate">{field.description || '-'}</p>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => openEditFieldDialog(index)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-500" onClick={() => handleDeleteField(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

        {/* Webhook Configuration */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Webhook Configuration</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge className={importer.webhook_enabled ? "bg-green-500/10 text-green-500 border-green-500/20" : "bg-gray-500/10 text-gray-500 border-gray-500/20"}>
                {importer.webhook_enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
            
            {importer.webhook_enabled && (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Webhook URL</label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="bg-muted/30 px-2 py-1 rounded text-sm flex-1">{importer.webhook_url}</code>
                    <Button variant="ghost" size="sm" asChild>
                      <a href={importer.webhook_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Include Data in Webhook</label>
                    <p className="mt-1">
                      <Badge variant="outline">
                        {importer.include_data_in_webhook ? 'Yes' : 'No'}
                      </Badge>
                    </p>
                  </div>
                  {importer.include_data_in_webhook && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Sample Size</label>
                      <p className="mt-1">{importer.webhook_data_sample_size || 100} rows</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Import Options */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Import Options</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Include Unmatched Columns</label>
              <p className="mt-1">
                <Badge variant="outline">
                  {importer.include_unmatched_columns ? 'Yes' : 'No'}
                </Badge>
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Filter Invalid Rows</label>
              <p className="mt-1">
                <Badge variant="outline">
                  {importer.filter_invalid_rows ? 'Yes' : 'No'}
                </Badge>
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Disable on Invalid Rows</label>
              <p className="mt-1">
                <Badge variant="outline">
                  {importer.disable_on_invalid_rows ? 'Yes' : 'No'}
                </Badge>
              </p>
            </div>
          </div>
        </Card>

        {/* Usage Information */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Usage Information</h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Import URL</label>
              <div className="flex items-center gap-2 mt-1">
                <code className="bg-muted/30 px-2 py-1 rounded text-sm flex-1">
                  {process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/import/{importer.key}
                </code>
                <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/import/${importer.key}`)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            <div>
              <label className="text-sm font-medium text-muted-foreground">Total Fields</label>
              <p className="mt-1">{importer.fields.length} fields configured</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  </>
  )
}
