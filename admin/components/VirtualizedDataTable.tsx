"use client"

import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { Type, Mail, Phone, Calendar, Hash, ToggleLeft, ChevronDown, Asterisk } from 'lucide-react'
import FramerLoadingSpinner from '@/components/FramerLoadingSpinner'

interface VirtualizedDataTableProps {
  headers: string[]
  data: string[][]
  changedCells: Map<string, string>
  editingCells: Map<string, string>
  pendingCells: Set<string>
  conflicts?: Array<{
    row: number
    col: number
    field: string
    csvColumn: string
    error: string
    value: string
  }>
  getCellValue: (rowIndex: number, cellIndex: number) => string
  handleCellChange: (rowIndex: number, cellIndex: number, newValue: string) => void
  handleEditStart: (rowIndex: number, cellIndex: number, currentValue: string) => void
  handleEditEnd: (rowIndex: number, cellIndex: number, newValue: string) => Promise<void>
  searchTerm?: string
  filterStatus?: 'all' | 'valid' | 'invalid'
}

const ROW_HEIGHT = 40 // Height of each row in pixels
const OVERSCAN = 15 // Increased overscan for smoother loading
const BATCH_SIZE = 50 // Process rows in batches for smoother rendering

// Optimized DataCell component with local state to prevent full table re-renders
interface DataCellProps {
  rowIndex: number
  cellIndex: number
  initialValue: string
  isConflicted: boolean
  isPending: boolean
  hasChange: boolean
  isEditing: boolean
  onCellChange: (rowIndex: number, cellIndex: number, value: string) => void
  onEditStart: (rowIndex: number, cellIndex: number, value: string) => void
  onEditEnd: (rowIndex: number, cellIndex: number, value: string) => Promise<void>
}

const DataCell = memo(({ 
  rowIndex, 
  cellIndex, 
  initialValue, 
  isConflicted, 
  isPending, 
  hasChange, 
  isEditing,
  onCellChange,
  onEditStart,
  onEditEnd 
}: DataCellProps) => {
  // Local state for immediate updates without triggering parent re-renders
  const [localValue, setLocalValue] = useState(initialValue)
  const [localIsEditing, setLocalIsEditing] = useState(false)
  const initialValueRef = useRef(initialValue)
  const editStartValueRef = useRef<string | null>(null)
  
  // Update local value when initial value changes (e.g., after save)
  useEffect(() => {
    if (initialValue !== initialValueRef.current && !localIsEditing) {
      setLocalValue(initialValue)
      initialValueRef.current = initialValue
    }
  }, [initialValue, localIsEditing])
  
  const changeTimeoutRef = useRef<NodeJS.Timeout>()
  
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setLocalValue(newValue) // Update local state immediately for responsive typing
    
    // Clear previous timeout
    if (changeTimeoutRef.current) {
      clearTimeout(changeTimeoutRef.current)
    }
    
    // Debounce parent update to reduce re-renders - reduced to 100ms for more responsive typing
    changeTimeoutRef.current = setTimeout(() => {
      onCellChange(rowIndex, cellIndex, newValue)
    }, 100)
  }, [rowIndex, cellIndex, onCellChange])
  
  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    setLocalIsEditing(true)
    editStartValueRef.current = e.target.value
    onEditStart(rowIndex, cellIndex, e.target.value)
  }, [rowIndex, cellIndex, onEditStart])
  
  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    setLocalIsEditing(false)
    // Only call API if value actually changed from when editing started
    if (editStartValueRef.current !== null && e.target.value !== editStartValueRef.current) {
      onEditEnd(rowIndex, cellIndex, e.target.value)
    }
    editStartValueRef.current = null
  }, [rowIndex, cellIndex, onEditEnd])
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }, [])
  
  return (
    <input
      type="text"
      value={localValue}
      disabled={isPending}
      className={`w-full h-10 px-3 bg-transparent border-none outline-none text-sm text-foreground focus:bg-blue-500/5 focus:ring-2 focus:ring-blue-500/20 focus:ring-inset transition-colors duration-150 ${
        isPending ? 'opacity-60 cursor-wait' : ''
      } ${
        localIsEditing || isEditing ? 'bg-blue-500/5' : ''
      }`}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  )
}, (prevProps, nextProps) => {
  // Custom comparison function for memo - only re-render if specific props change
  return (
    prevProps.rowIndex === nextProps.rowIndex &&
    prevProps.cellIndex === nextProps.cellIndex &&
    prevProps.initialValue === nextProps.initialValue &&
    prevProps.isConflicted === nextProps.isConflicted &&
    prevProps.isPending === nextProps.isPending &&
    prevProps.hasChange === nextProps.hasChange &&
    prevProps.isEditing === nextProps.isEditing
  )
})

// Add display name for debugging
DataCell.displayName = 'DataCell'

// Utility function to get icon based on header name
const getHeaderIcon = (headerName: string) => {
  const name = headerName.toLowerCase().trim()
  
  // Email type
  if (name.includes('email') || name.includes('e-mail') || name.includes('mail')) {
    return <Mail className="h-3 w-3 text-muted-foreground" />
  }
  
  // Phone type
  if (name.includes('phone') || name.includes('tel') || name.includes('mobile') || name.includes('cell')) {
    return <Phone className="h-3 w-3 text-muted-foreground" />
  }
  
  // Date type
  if (name.includes('date') || name.includes('time') || name.includes('created') || name.includes('updated')) {
    return <Calendar className="h-3 w-3 text-muted-foreground" />
  }
  
  // Number type (remove price/amount/cost references)
  if (name.includes('number') || name.includes('count') || name.includes('qty') || name.includes('quantity') || 
      name.includes('age') || name.includes('score') || name.includes('rating') || name.includes('index')) {
    return <Hash className="h-3 w-3 text-muted-foreground" />
  }
  
  // Boolean type
  if (name.includes('active') || name.includes('enabled') || name.includes('disabled') || name.includes('bool') ||
      name.includes('flag') || name.includes('is_') || name.includes('has_') || name.includes('can_')) {
    return <ToggleLeft className="h-3 w-3 text-muted-foreground" />
  }
  
  // Select type (dropdown)
  if (name.includes('status') || name.includes('type') || name.includes('category') || name.includes('option') ||
      name.includes('choice') || name.includes('select') || name.includes('dropdown')) {
    return <ChevronDown className="h-3 w-3 text-muted-foreground" />
  }
  
  // Custom regex type (show special characters)
  if (name.includes('regex') || name.includes('pattern') || name.includes('custom') || name.includes('format')) {
    return <Asterisk className="h-3 w-3 text-muted-foreground" />
  }
  
  // Default to text type icon
  return <Type className="h-3 w-3 text-muted-foreground" />
}

export const VirtualizedDataTable: React.FC<VirtualizedDataTableProps> = memo(({
  headers,
  data,
  changedCells,
  editingCells,
  pendingCells,
  conflicts = [],
  getCellValue,
  handleCellChange,
  handleEditStart,
  handleEditEnd,
  searchTerm = '',
  filterStatus = 'all'
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)
  
  // Calculate invalid rows for filtering
  const invalidRowIndexes = useMemo(() => {
    return new Set(conflicts.map(c => c.row))
  }, [conflicts])
  
  // Filter data based on search and status
  const filteredData = useMemo(() => {
    const filtered: Array<{row: string[], originalIndex: number}> = []
    
    for (let i = 0; i < data.length; i++) {
      // Apply filterStatus
      if (filterStatus === 'valid' && invalidRowIndexes.has(i)) continue
      if (filterStatus === 'invalid' && !invalidRowIndexes.has(i)) continue
      
      // Apply search if present
      if (searchTerm) {
        const q = searchTerm.toLowerCase()
        const row = data[i]
        if (!row.some(cell => cell?.toString().toLowerCase().includes(q))) continue
      }
      
      filtered.push({ row: data[i], originalIndex: i })
    }
    
    return filtered
  }, [data, searchTerm, filterStatus, invalidRowIndexes])
  
  // Update container dimensions
  useEffect(() => {
    const updateDimensions = () => {
      if (scrollContainerRef.current) {
        const rect = scrollContainerRef.current.getBoundingClientRect()
        setContainerHeight(rect.height)
      }
    }
    
    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])
  
  // Calculate visible range based on scroll position
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endIndex = Math.min(
    filteredData.length,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN
  )
  
  const visibleRows = filteredData.slice(startIndex, endIndex)
  const totalHeight = filteredData.length * ROW_HEIGHT
  const offsetY = startIndex * ROW_HEIGHT
  
  // RAF-throttled scroll handler for smoother performance
  const scrollTimeoutRef = useRef<number | null>(null)
  
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = e.currentTarget.scrollTop
    
    // Cancel previous RAF if pending
    if (scrollTimeoutRef.current) {
      cancelAnimationFrame(scrollTimeoutRef.current)
    }
    
    // Use requestAnimationFrame for smooth updates
    scrollTimeoutRef.current = requestAnimationFrame(() => {
      setScrollTop(newScrollTop)
      scrollTimeoutRef.current = null
    })
  }, [])
  
  // Cleanup effect for RAF timeout
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        cancelAnimationFrame(scrollTimeoutRef.current)
      }
    }
  }, [])
  
  // Check if a cell has a conflict
  const hasConflict = useCallback((rowIndex: number, cellIndex: number) => {
    return conflicts.some(conflict => 
      conflict.row === rowIndex && conflict.col === cellIndex
    )
  }, [conflicts])
  
  if (filteredData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        {searchTerm ? 'No records match your search criteria.' : 'No data available.'}
      </div>
    )
  }
  
  return (
    <div className="h-full flex flex-col relative">
      {/* Fixed Header - using flex layout to match body rows */}
      <div className="flex-shrink-0 border-b-2 border-muted/30 sticky top-0 z-40">
        <div className="flex overflow-x-auto" style={{ height: '48px' }}>
          {/* Header Row Number */}
          <div className="w-12 px-2 border-r-2 border-muted/30 text-sm font-semibold text-muted-foreground sticky left-0 flex items-center justify-center flex-shrink-0">
            #
          </div>
          
          {/* Header Cells */}
          {headers.map((header, index) => (
            <div
              key={index}
              className="w-[150px] min-w-[150px] px-3 text-left text-sm font-semibold text-foreground flex items-center gap-2 flex-none"
            >
              {getHeaderIcon(header)}
              <span className="truncate text-muted-foreground">{header}</span>
            </div>
          ))}
        </div>
      </div>
      
      {/* Scrollable Body */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-auto thin-black-scrollbar mb-4"
        onScroll={handleScroll}
        style={{
          position: 'relative',
          overscrollBehavior: 'contain',
        }}
        data-testid="scrollbar-container"
      >
        {/* Virtual scroll container with improved absolute positioning for smoother scrolling */}
        <div 
          style={{ 
            height: `${totalHeight}px`, 
            position: 'relative', 
            contain: 'layout style paint',
            willChange: 'scroll-position'
          }}
        >
          {/* Render visible rows with absolute positioning to eliminate waves */}
          {visibleRows.map(({ row, originalIndex }, virtualIndex) => {
            const rowTop = (startIndex + virtualIndex) * ROW_HEIGHT
            
            return (
              <div
                key={`row-${originalIndex}`}
                className="absolute left-0 right-0 flex hover:bg-muted/5 border-b-2 border-muted/20"
                style={{
                  height: `${ROW_HEIGHT}px`,
                  top: `${rowTop}px`,
                  transform: 'translateZ(0)', // Force GPU acceleration
                  willChange: 'transform',
                }}
              >
                {/* Row Number */}
                <div className="w-12 px-2 border-r-2 border-muted/30 text-xs text-muted-foreground text-center sticky left-0 flex items-center justify-center flex-shrink-0">
                  {originalIndex + 1}
                </div>

                {/* Data Cells */}
                {row.map((cell: string, cellIndex: number) => {
                  const isConflicted = hasConflict(originalIndex, cellIndex)
                  const isPending = pendingCells.has(`${originalIndex}-${cellIndex}`)
                  const hasChange = changedCells.has(`${originalIndex}-${cellIndex}`)
                  
                  return (
                    <div key={`cell-${cellIndex}`} className="w-[150px] min-w-[150px] relative flex-none">
                      <DataCell
                        rowIndex={originalIndex}
                        cellIndex={cellIndex}
                        initialValue={getCellValue(originalIndex, cellIndex)}
                        isConflicted={isConflicted}
                        isPending={isPending}
                        hasChange={hasChange}
                        isEditing={editingCells.has(`${originalIndex}-${cellIndex}`)}
                        onCellChange={handleCellChange}
                        onEditStart={handleEditStart}
                        onEditEnd={handleEditEnd}
                      />
                      
                      {/* Conflict indicator */}
                      {isConflicted && (
                        <div className="absolute inset-1 border-2 border-red-500 rounded-sm pointer-events-none" />
                      )}
                      {/* Pending indicator */}
                      {isPending && (
                        <div className="absolute inset-1 border-2 border-yellow-500 rounded-sm pointer-events-none animate-pulse" />
                      )}
                      {/* Change indicator */}
                      {hasChange && !isPending && (
                        <div className="absolute top-0 right-0 w-2 h-2 bg-blue-400 rounded-full -translate-y-1/2 translate-x-1/2" />
                      )}
                      {/* Pending spinner */}
                      {isPending && (
                        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2">
                          <FramerLoadingSpinner size="sm" showText={false} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      
      {/* Results summary */}
      <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm border border-muted/20 rounded-md px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
        Showing {startIndex + 1}-{Math.min(endIndex, filteredData.length)} of {filteredData.length} rows
      </div>
    </div>
  )
})
