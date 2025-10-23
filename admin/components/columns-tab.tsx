"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Edit, Plus, Trash2 } from "lucide-react"
import { AddColumnDialog } from "./add-column-dialog"

interface Column {
  id: string
  order: number
  name: string
  format: string
  example: string
  required: boolean
  description: string
}

const initialColumns: Column[] = [
  {
    id: "1",
    order: 1,
    name: "pula",
    format: "Number",
    example: "2043",
    required: true,
    description: "desc",
  },
  {
    id: "2",
    order: 2,
    name: "coi",
    format: "Custom Regex",
    example: "-",
    required: true,
    description: "-",
  },
]

export function ColumnsTab() {
  const [columns, setColumns] = useState<Column[]>(initialColumns)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

  const removeColumn = (id: string) => {
    setColumns((prev) => prev.filter((col) => col.id !== id))
  }

  const addColumn = (newColumn: Omit<Column, "id" | "order">) => {
    const column: Column = {
      ...newColumn,
      id: Date.now().toString(),
      order: columns.length + 1,
    }
    setColumns((prev) => [...prev, column])
  }

  return (
    <Card className="p-8 bg-background/30 border-muted/20">
      <div className="mb-8">
        <p className="text-sm text-muted-foreground mb-8 leading-relaxed">Define the columns for your CSV imports.</p>

        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-medium">Columns</h3>
          <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2 bg-white text-black hover:bg-gray-100">
            <Plus className="h-4 w-4" />
            Add Column
          </Button>
        </div>
      </div>

      <div className="border border-muted/20 rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-muted/20 bg-muted/10">
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wider py-4">
                ORDER
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                COLUMN NAME
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                FORMAT
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                EXAMPLE
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                REQUIRED
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                DESCRIPTION
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                ACTIONS
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {columns.map((column) => (
              <TableRow key={column.id} className="border-muted/20">
                <TableCell className="py-4">{column.order}</TableCell>
                <TableCell className="font-medium">{column.name}</TableCell>
                <TableCell className="text-muted-foreground">{column.format}</TableCell>
                <TableCell className="text-muted-foreground">{column.example}</TableCell>
                <TableCell className="text-muted-foreground">{column.required ? "Yes" : "No"}</TableCell>
                <TableCell className="text-muted-foreground">{column.description}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeColumn(column.id)}
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

      <div className="mt-8 flex justify-end">
        <Button className="bg-green-600 hover:bg-green-700 px-6">Save Changes</Button>
      </div>

      <AddColumnDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} onAddColumn={addColumn} />
    </Card>
  )
}
