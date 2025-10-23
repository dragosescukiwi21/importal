"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

interface AddColumnDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddColumn: (column: {
    name: string
    format: string
    example: string
    required: boolean
    description: string
  }) => void
}

export function AddColumnDialog({ open, onOpenChange, onAddColumn }: AddColumnDialogProps) {
  const [formData, setFormData] = useState({
    name: "",
    format: "Text",
    formatOption: "Any",
    example: "",
    required: false,
    description: "",
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onAddColumn(formData)
    setFormData({
      name: "",
      format: "Text",
      formatOption: "Any",
      example: "",
      required: false,
      description: "",
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Column</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Column Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Enter column name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="format">Format</Label>
            <div className="flex gap-2 items-center">
              <Select
                value={formData.format}
                onValueChange={(value) => {
                  setFormData((prev) => ({
                    ...prev,
                    format: value,
                    // Reset formatOption when format changes
                    formatOption: "Any"
                  }))
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Text">Text</SelectItem>
                  <SelectItem value="Number">Number</SelectItem>
                  <SelectItem value="Email">Email</SelectItem>
                  <SelectItem value="Date">Date</SelectItem>
                  <SelectItem value="Boolean">Boolean</SelectItem>
                  <SelectItem value="Custom Regex">Custom Regex</SelectItem>
                </SelectContent>
              </Select>
              {/* Right-side dropdown for special formats */}
              {formData.format === "Number" && (
                <Select
                  value={formData.formatOption}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, formatOption: value }))}
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
              {formData.format === "Date" && (
                <Select
                  value={formData.formatOption}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, formatOption: value }))}
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
              {formData.format === "Boolean" && (
                <Select
                  value={formData.formatOption}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, formatOption: value }))}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Any">Any</SelectItem>
                    <SelectItem value="True/False">True/False</SelectItem>
                    <SelectItem value="Yes/No">Yes/No</SelectItem>
                    <SelectItem value="1/0">1/0</SelectItem>
                    <SelectItem value="on/off">on/off</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="example">Example</Label>
            <Input
              id="example"
              value={formData.example}
              onChange={(e) => setFormData((prev) => ({ ...prev, example: e.target.value }))}
              placeholder="Example value"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="required">Required</Label>
            <Switch
              id="required"
              checked={formData.required}
              onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, required: checked }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Column description"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Column</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
