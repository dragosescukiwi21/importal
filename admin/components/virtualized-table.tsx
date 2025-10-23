"use client"

import React, { memo, useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import FramerLoadingSpinner from '@/components/FramerLoadingSpinner'

interface VirtualizedTableProps {
  data: Array<Array<any>>
  headers: string[]
  onCellChange?: (rowIndex: number, colIndex: number, value: any) => void
  onCellEdit?: (rowIndex: number, colIndex: number, value: any) => void
  getCellValue?: (rowIndex: number, colIndex: number) => string
  hasConflict?: (rowIndex: number, colIndex: number) => boolean
  pendingCells?: Set<string>
  changedCells?: Map<string, string>
  className?: string
}

interface EditingState {
  rowIndex: number
  colIndex: number
}

// Simple virtualized table - using a windowing approach for performance
export const VirtualizedTable: React.FC<VirtualizedTableProps> = ({
  data = [],
  headers = [],
  onCellChange,
  onCellEdit,
  getCellValue,
  hasConflict,
  pendingCells,
  changedCells,
  className
}) => {
  const [editingCell, setEditingCell] = useState<EditingState | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)
  const containerRef = useRef<HTMLDivElement>(null)
  
  const ROW_HEIGHT = 40
  const HEADER_HEIGHT = 50
  const OVERSCAN = 5 // Render extra rows for smoother scrolling
  
  // Calculate visible range
  const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleEnd = Math.min(data.length, Math.floor((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN)
  
  const totalHeight = data.length * ROW_HEIGHT
  
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    
    const resizeObserver = new ResizeObserver((entries) => {
      setContainerHeight(entries[0].contentRect.height - HEADER_HEIGHT)
    })
    
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])
  
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])
  
  const handleCellClick = useCallback((rowIndex: number, colIndex: number) => {
    const isAlreadyEditing = editingCell?.rowIndex === rowIndex && editingCell?.colIndex === colIndex
    
    if (!isAlreadyEditing) {
      setEditingCell({ rowIndex, colIndex })
      // Get current cell value for the onCellEdit callback
      const currentValue = getCellValue ? getCellValue(rowIndex, colIndex) : (data[rowIndex]?.[colIndex] ?? '')
      onCellEdit?.(rowIndex, colIndex, currentValue)
    }
  }, [onCellEdit, editingCell, getCellValue, data])
  
  const handleCellBlur = useCallback(() => {
    setEditingCell(null)
  }, [])
  
  const handleInputChange = useCallback((value: string, rowIndex: number, colIndex: number) => {
    onCellChange?.(rowIndex, colIndex, value)
  }, [onCellChange])
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent, rowIndex: number, colIndex: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      setEditingCell(null)
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const nextCol = colIndex + 1
      if (nextCol < headers.length) {
        setEditingCell({ rowIndex, colIndex: nextCol })
      } else if (rowIndex + 1 < data.length) {
        setEditingCell({ rowIndex: rowIndex + 1, colIndex: 0 })
      }
    }
  }, [headers.length, data.length])
  
  const renderCell = useCallback((rowData: any[], rowIndex: number, colIndex: number) => {
    // Use getCellValue if provided, otherwise fall back to direct data access
    const value = getCellValue ? getCellValue(rowIndex, colIndex) : (rowData[colIndex] ?? '')
    const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.colIndex === colIndex
    
    // Check if cell has conflict or is pending
    const cellKey = `${rowIndex}-${colIndex}`
    const hasCellConflict = hasConflict ? hasConflict(rowIndex, colIndex) : false
    const isPending = pendingCells ? pendingCells.has(cellKey) : false
    const isChanged = changedCells ? changedCells.has(cellKey) : false
    
    return (
      <div
        key={`${rowIndex}-${colIndex}`}
        className={cn(
          "flex-1 min-w-[120px] border-r border-gray-200 px-3 py-2 cursor-pointer relative",
          hasCellConflict && "bg-red-50 border-red-200",
          isPending && "bg-yellow-50",
          isChanged && "bg-blue-50"
        )}
        onClick={() => handleCellClick(rowIndex, colIndex)}
      >
        {isEditing ? (
          <input
            type="text"
            value={value}
            onChange={(e) => handleInputChange(e.target.value, rowIndex, colIndex)}
            onBlur={handleCellBlur}
            onKeyDown={(e) => handleKeyDown(e, rowIndex, colIndex)}
            className="w-full h-full border-none outline-none bg-transparent"
            autoFocus
          />
        ) : (
          <div className="truncate" title={String(value)}>
            {String(value)}
            {isPending && <span className="absolute top-0 right-0 w-2 h-2 bg-yellow-400 rounded-full" />}
            {hasCellConflict && <span className="absolute top-0 right-0 w-2 h-2 bg-red-400 rounded-full" />}
          </div>
        )}
      </div>
    )
  }, [editingCell, handleCellClick, handleCellBlur, handleInputChange, handleKeyDown, getCellValue, hasConflict, pendingCells, changedCells])
  
  // Early return if no data or headers to prevent errors
  if (!headers || headers.length === 0 || !data) {
    return (
      <div className={cn("flex flex-col h-full border border-gray-200 rounded-lg items-center justify-center", className)}>
        <FramerLoadingSpinner size="md" text="Loading table data..." />
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col h-full border border-gray-200 rounded-lg", className)}>
      {/* Header */}
      <div 
        className="flex bg-gray-50 border-b border-gray-200 sticky top-0 z-10"
        style={{ height: HEADER_HEIGHT }}
      >
        {headers.map((header, index) => (
          <div
            key={`header-${index}`}
            className="flex-1 min-w-[120px] border-r border-gray-200 px-3 py-3 font-semibold text-sm text-gray-700"
          >
            {header}
          </div>
        ))}
      </div>
      
      {/* Virtualized content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {/* Render only visible rows for performance */}
          {data.slice(visibleStart, visibleEnd).map((rowData, index) => {
            const actualRowIndex = visibleStart + index
            // Add safety check for rowData
            const safeRowData = Array.isArray(rowData) ? rowData : []
            return (
              <div
                key={actualRowIndex}
                className="flex border-b border-gray-100 hover:bg-gray-50"
                style={{
                  height: ROW_HEIGHT,
                  position: 'absolute',
                  top: actualRowIndex * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                }}
              >
                {headers.map((header, colIndex) => 
                  renderCell(safeRowData, actualRowIndex, colIndex)
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default VirtualizedTable