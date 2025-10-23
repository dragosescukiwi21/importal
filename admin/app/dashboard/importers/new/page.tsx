// importers/new/page.tsx

"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Trash2, Plus, ArrowLeft, Save, Edit } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { importersApi } from "@/src/utils/apiClient"
import { 
  FORMAT_OPTIONS_CONFIG, 
  prepareFieldForApi, // Use the correct name
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
interface ImporterData {
  name: string
  description?: string
  fields: ImporterField[]
  webhook_url?: string
  webhook_enabled: boolean
  include_data_in_webhook?: boolean
  truncate_data?: boolean
  webhook_data_sample_size?: number
  include_unmatched_columns: boolean
  filter_invalid_rows: boolean
  disable_on_invalid_rows: boolean
}

export default function CreateImporterPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  formatOption: 'Any'
  })
  
  // Form state
  const [importerData, setImporterData] = useState<ImporterData>({
    name: "",
    description: "",
    fields: [],  // Start with empty fields - no default ID field
    webhook_url: "",
    webhook_enabled: false,
    include_data_in_webhook: true,
    truncate_data: false,
    webhook_data_sample_size: 100,
    include_unmatched_columns: false,
    filter_invalid_rows: false,
    disable_on_invalid_rows: false,
  })

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
    });
    setEditingFieldIndex(null);
  };


  // Open field dialog for new field
  const openNewFieldDialog = () => {
    resetFieldForm()
    setShowFieldDialog(true)
  }

  // Open field dialog for editing
  const openEditFieldDialog = (index: number) => {
    const field = importerData.fields[index];
    const formatOption = mapExtraRulesToFormatOption(field);
  setFieldForm({ ...field, formatOption });
  // DEBUG: Log when opening the edit dialog and what formatOption was derived
  console.log(`🔍 [openEditFieldDialog] index=${index} derived formatOption=`, formatOption, 'field.extra_rules=', field.extra_rules);
    setEditingFieldIndex(index);
    setShowFieldDialog(true);
  };


  // Save field (add or update) - store both formatOption and extra_rules
  const saveField = () => {
    if (!fieldForm.name.trim()) return;
    // ✅ DEBUG STEP 1: Log the raw form state from the dialog.
    console.log("1️⃣ [saveField] Raw form state from dialog:", fieldForm);

    // Prepare the field with extra_rules for storage
    const fieldWithExtraRules = prepareFieldForApi(fieldForm);
    // But keep formatOption for UI purposes
    const fieldToStore = { ...fieldWithExtraRules, formatOption: fieldForm.formatOption };
    
    console.log("1.5️⃣ [saveField] Field to store with extra_rules:", fieldToStore);

    // Save the field with both formatOption and extra_rules
    if (editingFieldIndex !== null) {
      setImporterData(prev => {
        const updatedFields = prev.fields.map((f, i) => (i === editingFieldIndex ? fieldToStore : f));

        // ✅ DEBUG STEP 2: Log the main fields array after an update.
        console.log("2️⃣ [saveField] Fields array in state after UPDATE:", updatedFields);
        return { ...prev, fields: updatedFields };
      });
    } else {
      setImporterData(prev => {
        const updatedFields = [...prev.fields, fieldToStore];

        // ✅ DEBUG STEP 2: Log the main fields array after an add.
        console.log("2️⃣ [saveField] Fields array in state after ADD:", updatedFields);
        return { ...prev, fields: updatedFields };
      });
    }

    setShowFieldDialog(false);
    resetFieldForm();
  };

  // Add a new field
  const addField = () => {
    openNewFieldDialog()
  }

  // Remove a field
  const removeField = (index: number) => {
    setImporterData(prev => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== index)
    }))
  }

  // Update a field
  const updateField = (index: number, field: Partial<ImporterField>) => {
    setImporterData(prev => ({
      ...prev,
      fields: prev.fields.map((f, i) => i === index ? { ...f, ...field } : f)
    }))
  }

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      // Validate required fields
      if (!importerData.name.trim()) {
        throw new Error("Importer name is required")
      }

      if (importerData.fields.length === 0) {
        throw new Error("At least one field is required")
      }

      // Validate fields
      for (let i = 0; i < importerData.fields.length; i++) {
        const field = importerData.fields[i]
        if (!field.name.trim()) {
          throw new Error(`Field ${i + 1} name is required`)
        }
        if (!field.type) {
          throw new Error(`Field ${i + 1} type is required`)
        }
      }

      // Validate webhook URL if webhook is enabled
      if (importerData.webhook_enabled && !importerData.webhook_url?.trim()) {
        throw new Error("Webhook URL is required when webhook is enabled")
      }

      // ✅ DEBUG STEP 3: Log the state of the fields right before the final mapping.
      console.log("3️⃣ [handleSubmit] Fields array BEFORE final mapping:", importerData.fields)
      console.log("3.5️⃣ [handleSubmit] importerData state:", importerData)
      console.log("3.6️⃣ [handleSubmit] truncate_data value:", importerData.truncate_data)

      // Clean up the data before sending - explicitly include all webhook-related fields
      const cleanedData = {
        ...importerData,
        description: importerData.description?.trim() || undefined,
        webhook_url: importerData.webhook_enabled ? importerData.webhook_url?.trim() : undefined,
        // Explicitly include webhook settings to ensure they're sent
        webhook_enabled: importerData.webhook_enabled,
        include_data_in_webhook: importerData.include_data_in_webhook,
        truncate_data: importerData.truncate_data || false,
        webhook_data_sample_size: importerData.webhook_data_sample_size || 100,
        fields: importerData.fields.map(field => {
            const preparedField = prepareFieldForApi(field);

            // ✅ DEBUG STEP 4: Log each field as it's being mapped.
            console.log(`4️⃣ [handleSubmit] Mapping field "${field.name}" | formatOption: "${field.formatOption}" ➡️ extra_rules:`, preparedField.extra_rules);

            return preparedField;
        })
      };


      // ✅ DEBUG STEP 5: Log the final, cleaned data object that will be sent to the API.
      console.log("5️⃣ [handleSubmit] FINAL cleanedData payload for API:", cleanedData)

      // Create the importer
      const createdImporter = await importersApi.createImporter(cleanedData)
      
      // Redirect to the importer details page or back to dashboard
      router.push(`/dashboard/importers/${createdImporter.id}`)
    } catch (err: any) {
      console.error('Error creating importer:', err)
      setError(err.message || 'An error occurred while creating the importer')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      {/* Navigation Breadcrumb */}
      <NavigationBreadcrumb items={[
        { label: "Importers", href: "/dashboard" },
        { label: "New Importer", current: true }
      ]} />

      {/* Content */}
      <div className="p-8 max-w-4xl mx-auto">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-md">
              {error}
            </div>
          )}

          {/* Basic Information */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Basic Information</h2>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Importer Name *</Label>
                <Input
                  id="name"
                  value={importerData.name}
                  onChange={(e) => setImporterData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter importer name"
                  required
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={importerData.description}
                  onChange={(e) => setImporterData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe what this importer does"
                  rows={3}
                />
              </div>
            </div>
          </Card>

          {/* Fields Configuration */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">Fields Configuration</h2>
              <Button type="button" onClick={openNewFieldDialog} size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Field
              </Button>
            </div>
            
            {importerData.fields.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No fields configured yet.</p>
                <p className="text-sm">Click "Add Field" to create your first field.</p>
              </div>
            ) : (
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Order</TableHead>
                      <TableHead>Column Name</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Example Value</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-20">Required</TableHead>
                      <TableHead className="w-24">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importerData.fields.map((field, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{index + 1}</TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{field.name}</div>
                            {field.display_name && (
                              <div className="text-sm text-muted-foreground">{field.display_name}</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-secondary">
                            {FIELD_TYPES.find(t => t.value === field.type)?.label || field.type}
                          </span>
                        </TableCell>
                        <TableCell>
                          {field.example && (
                            <code className="px-2 py-1 bg-muted rounded text-xs">{field.example}</code>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[200px] truncate text-sm text-muted-foreground">
                            {field.description}
                          </div>
                        </TableCell>
                        <TableCell>
                          {field.required && (
                            <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-red-500/10 text-red-400">
                              Required
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditFieldDialog(index)}
                              className="h-8 w-8 p-0"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeField(index)}
                              className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          {/* Field Configuration Dialog */}
          <Dialog open={showFieldDialog} onOpenChange={setShowFieldDialog}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingFieldIndex !== null ? 'Edit Field' : 'Add New Field'}
                </DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4">
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
                    <Select value={fieldForm.type} onValueChange={(value) => {
                        // DEBUG: Log when the user changes the field type and the reset of formatOption
                        console.log('🔁 [type Select] Changing type ->', value, 'resetting formatOption to Any. previous formatOption=', fieldForm.formatOption);
                        setFieldForm(prev => ({ ...prev, type: value, formatOption: "Any" }));
                      }}>
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
                    {fieldForm.type === "number" && (
                      <Select
                        value={fieldForm.formatOption || "Any"}
                        onValueChange={(value) => {
                          // DEBUG: Log number-format selection changes
                          console.log('🔢 [number format Select] selected ->', value, 'previous formatOption=', fieldForm.formatOption);
                          setFieldForm(prev => ({ ...prev, formatOption: value }));
                        }}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Any">Any</SelectItem>
                          <SelectItem value="Positive">Positive</SelectItem>
                          <SelectItem value="Negative">Negative</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {fieldForm.type === "date" && (
                      <Select
                        value={fieldForm.formatOption || "Any"}
                        onValueChange={(value) => {
                          // DEBUG: Log date-format selection changes
                          console.log('📅 [date format Select] selected ->', value, 'previous formatOption=', fieldForm.formatOption);
                          setFieldForm(prev => ({ ...prev, formatOption: value }));
                        }}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Any">Any</SelectItem>
                          <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                          <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                          <SelectItem value="YYYY/MM/DD">YYYY/MM/DD</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {fieldForm.type === "boolean" && (
                      <Select
                        value={fieldForm.formatOption || "Any"}
                        onValueChange={(value) => {
                          // DEBUG: Log boolean-format selection changes
                          console.log('🔘 [boolean format Select] selected ->', value, 'previous formatOption=', fieldForm.formatOption);
                          setFieldForm(prev => ({ ...prev, formatOption: value }));
                        }}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
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

                <div className="flex items-center space-x-2">
                  <Switch
                    checked={fieldForm.required}
                    onCheckedChange={(checked) => setFieldForm(prev => ({ ...prev, required: checked }))}
                  />
                  <Label>Required</Label>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowFieldDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={saveField}
                    disabled={!fieldForm.name.trim()}
                  >
                    {editingFieldIndex !== null ? 'Update Field' : 'Add Field'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Webhook Configuration */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Webhook Configuration</h2>
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  checked={importerData.webhook_enabled}
                  onCheckedChange={(checked) => setImporterData(prev => ({ ...prev, webhook_enabled: checked }))}
                />
                <Label>Enable Webhook</Label>
              </div>
              
              {importerData.webhook_enabled && (
                <>
                  <div>
                    <Label htmlFor="webhook_url">Webhook URL *</Label>
                    <Input
                      id="webhook_url"
                      value={importerData.webhook_url}
                      onChange={(e) => setImporterData(prev => ({ ...prev, webhook_url: e.target.value }))}
                      placeholder="https://your-api.com/webhook"
                      type="url"
                      required={importerData.webhook_enabled}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={importerData.include_data_in_webhook}
                      onCheckedChange={(checked) => setImporterData(prev => ({ ...prev, include_data_in_webhook: checked }))}
                    />
                    <Label>Include Data in Webhook</Label>
                  </div>
                  {importerData.include_data_in_webhook && (
                    <>
                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={importerData.truncate_data || false}
                          onCheckedChange={(checked) => setImporterData(prev => ({ ...prev, truncate_data: checked }))}
                        />
                        <Label>Truncate Data</Label>
                      </div>
                      {importerData.truncate_data && (
                        <div>
                          <Label htmlFor="webhook_data_sample_size">Sample Size</Label>
                          <Input
                            id="webhook_data_sample_size"
                            type="number"
                            value={importerData.webhook_data_sample_size}
                            onChange={(e) => setImporterData(prev => ({ ...prev, webhook_data_sample_size: parseInt(e.target.value) || 100 }))}
                            placeholder="100"
                            min="1"
                            max="1000"
                          />
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* Import Options */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Import Options</h2>
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  checked={importerData.include_unmatched_columns}
                  onCheckedChange={(checked) => setImporterData(prev => ({ ...prev, include_unmatched_columns: checked }))}
                />
                <Label>Include Unmatched Columns</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={importerData.filter_invalid_rows}
                  onCheckedChange={(checked) => setImporterData(prev => ({ ...prev, filter_invalid_rows: checked }))}
                />
                <Label>Filter Invalid Rows</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={importerData.disable_on_invalid_rows}
                  onCheckedChange={(checked) => setImporterData(prev => ({ ...prev, disable_on_invalid_rows: checked }))}
                />
                <Label>Disable on Invalid Rows</Label>
              </div>
            </div>
          </Card>

          {/* Submit Button */}
          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => router.push('/dashboard')}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="gap-2">
              {isLoading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Create Importer
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
