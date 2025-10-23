"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useRouter, useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Filter, ArrowLeft, Download, RefreshCcw, Wallet, Home, BarChart3, LifeBuoy, Settings, Save, Send, ChevronRight, Brain, MessageCircle, X } from "lucide-react"
import Link from "next/link"
import { useAuth } from "@/src/context/AuthContext"
import { importsApi } from "@/src/utils/apiClient"
import { NavigationBreadcrumb } from "@/components/navigation-breadcrumb"
import { VirtualizedDataTable } from "@/components/VirtualizedDataTable"
import ChatWindow from "@/components/chat/ChatWindow"
import FloatingChatButton from "@/components/chat/FloatingChatButton"
import FramerLoadingSpinner from "@/components/FramerLoadingSpinner"

interface ImportData {
  headers: string[]
  data: string[][]
  total_rows: number
  conflicts?: ConflictInfo[]  // Add conflicts to the interface
  import_info: {
    file_name: string
    status: string
    created_at: string
    updated_at?: string
    row_count: number
    importer_id?: string
  }
}

interface ConflictInfo {
  row: number
  col: number
  field: string
  csvColumn: string
  error: string
  value: string
}

export default function ImportDataViewerPage() {
  const router = useRouter()
  const params = useParams()
  const { isAuthenticated, isLoading: authLoading, logout, user } = useAuth()
  
  // Optimized state management - only store original data once
  const [importData, setImportData] = useState<ImportData | null>(null)
  const [originalData, setOriginalData] = useState<string[][]>([])
  const [changedCells, setChangedCells] = useState<Map<string, string>>(new Map())
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set()) // Track cells being updated
  const [editingCells, setEditingCells] = useState<Map<string, string>>(new Map()) // Track initial values when editing starts
  const [hasChanges, setHasChanges] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [filterStatus, setFilterStatus] = useState<"all" | "valid" | "invalid">("all")
  const [isDownloading, setIsDownloading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSendingWebhook, setIsSendingWebhook] = useState(false)
  
  // AI Prompt state management
  const [aiPrompt, setAiPrompt] = useState("")
  const [isProcessingAI, setIsProcessingAI] = useState(false)
  const [aiResult, setAiResult] = useState<any | null>(null)
  
  // NEW: Professional polling state for asynchronous promotion with queue support
  const [pendingEdit, setPendingEdit] = useState<{row: number, column_key: string, new_value: string, cell_key?: string} | null>(null)
  const [pendingEditsQueue, setPendingEditsQueue] = useState<Array<{row: number, column_key: string, new_value: string, cell_key: string}>>([])
  const [isPolling, setIsPolling] = useState(false)
  
  // Pagination state - simple and fast
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 100 // Show 100 rows per page
  
  // Toast notification state
  const [toast, setToast] = useState<{
    message: string
    type: 'loading' | 'success' | 'error'
    visible: boolean
  }>({ message: '', type: 'loading', visible: false })

  // Floating AI Chat state
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatPrompt, setChatPrompt] = useState("")
  const [chatHistory, setChatHistory] = useState<Array<{
    type: 'user' | 'ai'
    message: string
    timestamp: Date
  }>>([])
  const [isProcessingChat, setIsProcessingChat] = useState(false)

  const importId = params.id as string
  
  // Toast utility functions
  const showToast = useCallback((message: string, type: 'loading' | 'success' | 'error') => {
    setToast({ message, type, visible: true })
    if (type !== 'loading') {
      setTimeout(() => {
        setToast(prev => ({ ...prev, visible: false }))
      }, 3000)
    }
  }, [])

  const hideToast = useCallback(() => {
    setToast(prev => ({ ...prev, visible: false }))
  }, [])

  // Optimized cell value getter - O(1) lookup instead of O(n*m) comparison
  const getCellValue = useCallback((rowIndex: number, cellIndex: number) => {
    const key = `${rowIndex}-${cellIndex}`
    return changedCells.get(key) ?? originalData[rowIndex]?.[cellIndex] ?? ''
  }, [changedCells, originalData])

  // Function to check if a cell has a conflict
  const hasConflict = useCallback((rowIndex: number, cellIndex: number) => {
    if (!importData?.conflicts) return false
    
    return importData.conflicts.some(conflict => 
      conflict.row === rowIndex && conflict.col === cellIndex
    )
  }, [importData?.conflicts])


  const fetchImportData = async () => {
    setIsLoading(true)
    setError(null)

    try {
      console.log('Fetching import data for ID:', importId)
      const data = await importsApi.getImportData(importId)
      console.log('Received import data:', JSON.stringify(data, null, 2))
      
      // Handle processing status - don't show as error, keep loading state
      if (data.status === 'processing') {
        console.log('Import still processing, will retry in 2 seconds...')
        // Keep loading state active during processing
        setTimeout(() => {
          fetchImportData()
        }, 2000)
        return
      }
      
      const receivedData = data.data || []
      
      setImportData(data)
      setOriginalData(receivedData) // Single source of truth - no deep copying needed
      setChangedCells(new Map()) // Clear any existing changes
      setEditingCells(new Map()) // Clear any editing state
      setHasChanges(false)
      setIsLoading(false) // Always stop loading when data is successfully fetched

    } catch (err: any) {
      console.error('Error fetching import data:', err)
      console.error('Error details:', {
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data,
        message: err.message
      })
      setError(err.response?.data?.detail || err.message || 'Failed to load import data')
      setIsLoading(false) // Stop loading on error
      
      if (err.response && err.response.status === 401) {
        router.push('/login')
      }
    }
  }

  // Professional useEffect polling for asynchronous promotion
  useEffect(() => {
    // Only run the effect if we are actively polling
    if (!isPolling || !importId) return

    let pollAttempts = 0
    const maxPollAttempts = 15 // 30 seconds max
    const pollInterval = 2000 // 2 seconds

    const poll = async () => {
      if (pollAttempts >= maxPollAttempts) {
        showToast('Preparation is taking longer than expected.', 'error')
        setIsPolling(false)
        return
      }
      pollAttempts++

      try {
        const statusResponse = await importsApi.getImportStatus(importId)
        console.log(`🔄 Polling status (attempt ${pollAttempts}/${maxPollAttempts}):`, statusResponse.status)
        
        if (statusResponse.status === 'UNCOMPLETED') {
          // Promotion is complete!
          setIsPolling(false)
          showToast('File is ready for editing!', 'success')
          
          // Re-fetch the full data now that it's in the database
          await fetchImportData()

          // IMPROVED FIX FOR THE LOST EDIT: If there was a pending edit, re-apply it now
          if (pendingEdit) {
            console.log("🔄 Re-applying pending edit:", pendingEdit)
            // Re-apply the edit by calling the API directly to avoid circular dependency
            try {
              const result = await importsApi.updateCell(importId, pendingEdit.row, pendingEdit.column_key, pendingEdit.new_value)
              console.log("✅ Pending edit re-applied successfully:", result)
              
              // IMPROVED: Update local state immediately after re-applying to prevent value loss
              if (pendingEdit.cell_key) {
                setChangedCells(prev => {
                  const newMap = new Map(prev)
                  newMap.set(pendingEdit.cell_key!, pendingEdit.new_value)
                  setHasChanges(newMap.size > 0)
                  return newMap
                })
              }
              
              // FIXED: After re-applying the edit, only refresh validation data without overwriting local state
              if (result.success) {
                console.log("🔄 Pending edit re-applied, updating validation state only")
                
                // IMPROVED: Instead of full refresh, update only validation/conflict state
                // This preserves any other local changes that haven't been sent to server yet
                if (result.cell_validation) {
                  setImportData(prev => {
                    if (!prev) return prev
                    
                    // Remove old conflicts for this cell
                    const filteredConflicts = (prev.conflicts || []).filter(
                      (c: any) => !(c.row === pendingEdit.row && 
                                   c.field === pendingEdit.column_key)
                    )
                    
                    // Add new conflict if validation failed
                    if (result.cell_validation.error) {
                      filteredConflicts.push({
                        row: pendingEdit.row,
                        col: prev.headers.indexOf(pendingEdit.column_key),
                        field: result.cell_validation.field,
                        csvColumn: pendingEdit.column_key,
                        error: result.cell_validation.error,
                        value: pendingEdit.new_value
                      })
                    }
                    
                    return {
                      ...prev,
                      conflicts: filteredConflicts
                    }
                  })
                }
                
                // Show validation feedback without full data refresh
                if (result.cell_validation?.error) {
                  showToast('Edit applied with validation errors', 'error')
                } else {
                  showToast('Edit applied successfully!', 'success')
                }
              }
              
            } catch (error) {
              console.error("❌ Failed to re-apply pending edit:", error)
              showToast('Failed to re-apply your edit. Please try again.', 'error')
            }
            setPendingEdit(null) // Clear the pending edit
            
            // IMPROVED: Process queued edits if any exist
            if (pendingEditsQueue.length > 0) {
              console.log(`🔄 Processing ${pendingEditsQueue.length} queued edits`)
              const nextEdit = pendingEditsQueue[0]
              setPendingEditsQueue(prev => prev.slice(1)) // Remove first item
              setPendingEdit(nextEdit) // Set as new pending edit
              
              // Continue processing the next edit
              setTimeout(async () => {
                try {
                  await importsApi.updateCell(importId, nextEdit.row, nextEdit.column_key, nextEdit.new_value)
                  showToast(`Processing queued edit (${pendingEditsQueue.length} remaining)`, 'loading')
                } catch (error) {
                  console.error("Failed to process queued edit:", error)
                  showToast('Failed to process queued edit', 'error')
                }
              }, 100) // Small delay
            }
          }

        } else if (statusResponse.status === 'FAILED') {
          setIsPolling(false)
          showToast('Failed to prepare file for editing.', 'error')
          setPendingEdit(null) // Clear pending edit on failure
        }
        // For PROMOTING, PROCESSING, etc., continue polling
      } catch (error) {
        console.error("Polling error:", error)
        // Continue polling on error - don't stop
      }
    }

    // Use a timeout-based interval that can be cleaned up
    const intervalId = setInterval(poll, pollInterval)

    // This is the cleanup function. It runs when the component unmounts.
    return () => {
      clearInterval(intervalId)
    }

  }, [isPolling, importId, fetchImportData, showToast, pendingEdit]) // Removed handleCellEdit dependency to avoid circular reference

  // Initialize data loading when component mounts
  useEffect(() => {
    if (importId && isAuthenticated && !authLoading) {
      fetchImportData()
    }
  }, [importId, isAuthenticated, authLoading])

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, authLoading, router])



  // Ultra-fast save function with immediate feedback
  const handleSaveChanges = useCallback(async () => {
      if (!hasChanges || isSaving || pendingCells.size > 0) return;

      setIsSaving(true);
      
      // Immediately apply changes locally for instant feedback
      const changedData: Array<{row: number, col: number, value: string}> = [];
      changedCells.forEach((value, key) => {
          const [rowIndex, cellIndex] = key.split('-').map(Number);
          changedData.push({ row: rowIndex, col: cellIndex, value });
      });
      
      // Apply changes optimistically
      const updatedData = [...originalData];
      changedData.forEach(({ row, col, value }) => {
          if (!updatedData[row]) updatedData[row] = [];
          updatedData[row][col] = value;
      });
      
      // Update state immediately for instant feedback
      setOriginalData(updatedData);
      setChangedCells(new Map());
      setHasChanges(false);
      showToast(`Saving ${changedData.length} changes...`, 'loading');
      
      try {
        // Send optimized save request
        const response = await importsApi.saveData(importId, updatedData, importData?.headers);
        console.log('✅ Optimized save completed:', response);
        
        // Show user-friendly feedback
        showToast('Changes saved successfully!', 'success');
        
        // Update status from save response and refresh conflicts data
        if (response.status) {
          // Refresh the entire import data to get updated conflicts
          const refreshedData = await importsApi.getImportData(importId);
          setImportData(refreshedData);
          console.log(`🔄 Status and conflicts refreshed after save: ${response.status}`);
        }
          
          // Don't poll - just trust the save worked
          setEditingCells(new Map());

      } catch (error: any) {
          console.error('Error saving changes:', error);
          showToast(error.response?.data?.detail || 'Failed to save changes', 'error');
      } finally {
          setIsSaving(false);
      }
  }, [importId, hasChanges, isSaving, pendingCells.size, originalData, getCellValue, showToast]);

  // REMOVED: Optimized cell change handler with batching - this was causing race conditions
  // The debounced approach conflicted with immediate API calls in handleEditEnd
  // Now handleCellEdit updates state directly and synchronously to prevent overrides

  // Simple cell change handler for UI updates only (no API calls)
  const handleCellChange = useCallback((rowIndex: number, cellIndex: number, newValue: string) => {
    const key = `${rowIndex}-${cellIndex}`
    const originalValue = originalData[rowIndex]?.[cellIndex]
    
    // Update local state immediately for UI responsiveness
    setChangedCells(prev => {
      const newMap = new Map(prev)
      
      if (newValue === originalValue) {
        newMap.delete(key) // Remove if reverted to original
      } else {
        newMap.set(key, newValue) // Track only the change
      }
      
      const hasChangesNow = newMap.size > 0
      setHasChanges(hasChangesNow)
      return newMap
    })
  }, [originalData])

  // Handler for when editing starts (onFocus)
  const handleEditStart = useCallback((rowIndex: number, cellIndex: number, currentValue: string) => {
    const key = `${rowIndex}-${cellIndex}`
    console.log(`🎯 Edit started: ${key} with value "${currentValue}"`)
    
    setEditingCells(prev => {
      const newMap = new Map(prev)
      newMap.set(key, currentValue)
      return newMap
    })
  }, [])

  // Real-time cell edit handler with proper conflict refresh and S3 promotion handling
  const handleCellEdit = useCallback(async (rowIndex: number, cellIndexOrColumnKey: number | string, newValue: string) => {
    // Handle both cellIndex (number) and columnKey (string) for backwards compatibility
    let cellIndex: number
    let columnKey: string
    
    if (typeof cellIndexOrColumnKey === 'number') {
      cellIndex = cellIndexOrColumnKey
      const headerValue = importData?.headers[cellIndex]
      if (!headerValue) {
        console.error(`❌ Invalid column index: ${cellIndex}, headers:`, importData?.headers)
        showToast(`Invalid column index: ${cellIndex}`, 'error')
        return
      }
      columnKey = headerValue
    } else {
      columnKey = cellIndexOrColumnKey
      cellIndex = importData?.headers.indexOf(columnKey) ?? -1
      if (cellIndex === -1) {
        console.error(`❌ Column key not found: ${columnKey}, headers:`, importData?.headers)
        showToast(`Column not found: ${columnKey}`, 'error')
        return
      }
    }
    
    const key = `${rowIndex}-${cellIndex}`
    const originalValue = originalData[rowIndex]?.[cellIndex]
    
    // FIXED: Prevent concurrent edits to the same cell with better checking
    if (pendingCells.has(key)) {
      console.log(`🚫 Cell ${key} is already being updated, skipping duplicate request`)
      return
    }
    
    console.log(`⚡ Real-time cell edit: Row ${rowIndex}, Col ${cellIndex} (${columnKey})`)
    console.log(`📝 Original: "${originalValue}" → New: "${newValue}"`)
    
    // Mark cell as pending immediately to prevent race conditions
    setPendingCells(prev => new Set(prev).add(key))
    
    // FIXED: Update local state immediately and synchronously to prevent overrides
    setChangedCells(prev => {
      const newMap = new Map(prev)
      if (newValue === originalValue) {
        newMap.delete(key) // Remove if reverted to original
      } else {
        newMap.set(key, newValue) // Track the change
      }
      setHasChanges(newMap.size > 0)
      return newMap
    })
    
    try {
      // Send real-time update to backend with columnKey
      const result = await importsApi.updateCell(importId, rowIndex, columnKey, newValue)
      
      console.log(`✅ Cell update response:`, result)
      
      // Handle asynchronous promotion pattern (202 status)
      if (result.status === 'promoting') {
        showToast('Preparing file for editing...', 'loading')
        
        // IMPROVED: Add to queue if already promoting, otherwise set as primary pending edit
        const editToQueue = { 
          row: rowIndex, 
          column_key: columnKey,
          new_value: newValue,
          cell_key: key
        }
        
        if (isPolling || pendingEdit) {
          // Already promoting - add to queue
          setPendingEditsQueue(prev => [...prev, editToQueue])
          showToast('Edit queued for processing...', 'loading')
        } else {
          // First promotion - set as pending edit and start polling
          setPendingEdit(editToQueue)
          setIsPolling(true)
        }
        
        return // Exit early for promotion case
      }
      
      console.log(`✅ Cell update response:`, result)
      
      // Handle asynchronous promotion pattern (202 status)
      if (result.status === 'promoting') {
        showToast('Preparing file for editing...', 'loading')
        
        // Store the edit that triggered the promotion
        setPendingEdit({ 
          row: rowIndex, 
          column_key: columnKey,
          new_value: newValue 
        })
        
        // Start the polling process
        setIsPolling(true)
        return // Exit early for promotion case
      }
      
        // OPTIMIZED: Handle instant validation feedback from backend
        if (result.success) {
          console.log('✅ Cell update with instant validation feedback received')
          
          // Handle optimized cell validation result
          if (result.cell_validation) {
            setImportData(prev => {
              if (!prev) return prev
              
              // Remove old conflicts for this cell
              const filteredConflicts = (prev.conflicts || []).filter(
                (c: any) => !(c.row === rowIndex && c.col === cellIndex)
              )
              
              // Add new conflict if validation failed
              if (result.cell_validation.error) {
                filteredConflicts.push({
                  row: rowIndex,
                  col: cellIndex,
                  field: result.cell_validation.field,
                  csvColumn: columnKey,
                  error: result.cell_validation.error,
                  value: newValue
                })
              }
              
              return {
                ...prev,
                conflicts: filteredConflicts
              }
            })
            
            // Show user-friendly feedback
            if (result.cell_validation.error) {
              showToast('Cell updated with validation error', 'error')
            } else {
              showToast('Cell updated successfully', 'success')
            }
            
            // Don't update status during cell edits - only update on save operations
          } else {
            // FIXED: Remove the full data refresh that was causing overrides
            // The fallback was wiping out optimistic changes for other cells
            console.log('✅ Cell updated successfully without specific validation data')
            showToast('Cell updated successfully', 'success')
            
            // If we need validation data, we should request only this specific cell's validation
            // instead of refreshing the entire dataset which overwrites local changes
          }
      }
      
    } catch (error: any) {
      console.error('Error updating cell:', error)
      
      // Rollback optimistic update on error
      setChangedCells(prev => {
        const newMap = new Map(prev)
        if (originalValue === newValue) {
          newMap.delete(key)
        } else {
          newMap.set(key, originalValue)
        }
        setHasChanges(newMap.size > 0)
        return newMap
      })
      
      showToast(error.response?.data?.detail || 'Failed to update cell', 'error')
      
    } finally {
      // Remove cell from pending set
      setPendingCells(prev => {
        const newSet = new Set(prev)
        newSet.delete(key)
        return newSet
      })
    }
  }, [importId, originalData, showToast, pendingCells])

  // Handler for when editing ends (onBlur) - FIXED to prevent race conditions
  const handleEditEnd = useCallback(async (rowIndex: number, cellIndex: number, newValue: string) => {
    const key = `${rowIndex}-${cellIndex}`
    const initialEditValue = editingCells.get(key)
    
    console.log(`🏁 Edit ended: ${key}`)
    console.log(`📝 Initial edit value: "${initialEditValue}" → Final value: "${newValue}"`)
    
    // Clear from editing state
    setEditingCells(prev => {
      const newMap = new Map(prev)
      newMap.delete(key)
      return newMap
    })
    
    // FIXED: Only trigger API call if the value actually changed AND the cell is not already pending
    if (initialEditValue !== undefined && 
        newValue !== initialEditValue && 
        !pendingCells.has(key)) {
      console.log(`🚀 Value changed during edit and not pending, triggering API call`)
      await handleCellEdit(rowIndex, cellIndex, newValue)
    } else if (pendingCells.has(key)) {
      console.log(`⏭️ Cell is already pending validation, skipping duplicate API call`)
    } else {
      console.log(`⏭️ No change during edit, skipping API call`)
    }
  }, [editingCells, handleCellEdit, pendingCells])

  // Debug effect to track changes
  useEffect(() => {
    console.log('Change state updated:', { 
      hasChanges, 
      originalDataLength: originalData.length, 
      changedCellsCount: changedCells.size 
    })
  }, [hasChanges, originalData.length, changedCells.size])

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login')
      return
    }

    if (isAuthenticated && importId) {
      fetchImportData()
    }
  }, [isAuthenticated, authLoading, importId, router])

  const handleDownloadCSV = async () => {
    setIsDownloading(true)
    try {
      const { blob, filename } = await importsApi.downloadFile(importId)
      
      // Create download link
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      
      // Cleanup
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      console.error('Error downloading file:', err)
      alert(`Failed to download file: ${err.message}`)
    } finally {
      setIsDownloading(false)
    }
  }




  
  const handleSendWebhook = async () => {
    // Check if import data and import ID are available
    if (!importData || !importId) {
        console.error("No import job data available to send webhook.");
        return;
    }
    
  // Allow sending webhooks for both COMPLETED and UNCOMPLETED (portal-managed) imports
  if (!['COMPLETED', 'UNCOMPLETED'].includes(importData.import_info.status)) {
    alert('Webhooks can only be sent for completed or portal-managed (uncompleted) imports.');
    return;
  }

    setIsSendingWebhook(true);
    showToast('Sending to webhook...', 'loading');
    
    try {
      // Call the dedicated API endpoint for resending a webhook.
        // It only needs the ID of the existing import job.
        await importsApi.resendWebhook(importId);
        
        showToast('Successfully queued webhook for sending', 'success');

    } catch (err: any) {
        console.error('Error sending webhook:', err);
        const errorMessage = err.response?.data?.detail || 'An unknown error occurred.';
        showToast(`Failed to send to webhook: ${errorMessage}`, 'error');
    } finally {
        setIsSendingWebhook(false);
    }
  };

  // AI Prompt Processing Function
  const handleAIPrompt = async () => {
    if (!aiPrompt.trim() || !importId || !importData) {
      return;
    }

    setIsProcessingAI(true);
    setAiResult(null);
    showToast('AI is planning the changes...', 'loading');

    try {
      // 1. Get the transformation plan from the backend
      const result = await importsApi.processAIPrompt(importId, aiPrompt.trim());
      
      // 2. Check if this is a chat response (no transformations)
      if (result.success && result.chat_message) {
        showToast(result.chat_message, 'success');
        setAiPrompt("");
        return;
      }
      
      // 3. Check if the plan is valid and has transformations to execute
      if (result.success && result.transformations && result.transformations.length > 0) {
        const plan = result.transformations;
        showToast(`${result.operation?.description} Applying ${plan.length} changes...`, 'loading');

        // 3. Execute the plan: Loop and call handleCellEdit for each item.
        const updatePromises = plan.map((t: any) => {
          // Find the numeric index of the column from its name
          const cellIndex = importData.headers.indexOf(t.column);
          
          if (cellIndex !== -1) {
            // This call triggers the "pending validation" UI for each cell
            return handleCellEdit(t.row_index, cellIndex, t.new_value);
          }
          return Promise.resolve(); // Skip if the AI returned a column that doesn't exist
        });

        // 4. Wait for all the individual cell updates to finish
        await Promise.all(updatePromises);
        
        showToast('AI changes applied and validated!', 'success');
        
        // 5. Do a final data refresh to ensure the UI is in perfect sync with the DB
        await fetchImportData();

      } else if (result.success) {
        // Handle cases where the AI had nothing to change
        showToast(result.operation?.description || 'No changes were needed.', 'success');
      } else {
        // Handle cases where the AI failed to generate a plan
        throw new Error(result.error || 'AI operation failed');
      }
      
      setAiPrompt("");

    } catch (err: any) {
      console.error('Error processing AI prompt:', err);
      const errorMessage = err.message || err.response?.data?.detail || 'Failed to process AI request';
      showToast(`AI Error: ${errorMessage}`, 'error');
    } finally {
      setIsProcessingAI(false);
    }
  };

  // Handle Enter key in AI prompt
  const handleAIPromptKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAIPrompt();
    }
  };

  // Floating AI Chat Functions
  const handleChatSubmit = async () => {
    if (!chatPrompt.trim() || !importId || !importData) {
      return;
    }

    const userMessage = chatPrompt.trim();
    setIsProcessingChat(true);
    setChatPrompt("");

    // Add user message to chat history
    setChatHistory(prev => [...prev, {
      type: 'user',
      message: userMessage,
      timestamp: new Date()
    }]);

    try {
      // Use the same AI endpoint but for chat context
      const result = await importsApi.processAIPrompt(importId, userMessage);
      
      let aiResponse = "";
      if (result.success && result.transformations && result.transformations.length > 0) {
        // If there are transformations, execute them and report back
        const plan = result.transformations;
        // Use the AI's reasoning/description instead of generic message
        aiResponse = result.operation?.description || `Planning ${plan.length} data changes...`;
        
        // Add AI response
        setChatHistory(prev => [...prev, {
          type: 'ai',
          message: aiResponse,
          timestamp: new Date()
        }]);

        // Execute the plan
        const updatePromises = plan.map((t: any) => {
          const cellIndex = importData.headers.indexOf(t.column);
          if (cellIndex !== -1) {
            return handleCellEdit(t.row_index, cellIndex, t.new_value);
          }
          return Promise.resolve();
        });

        await Promise.all(updatePromises);
        await fetchImportData();

        // Add completion message
        setChatHistory(prev => [...prev, {
          type: 'ai',
          message: `✅ Applied ${plan.length} changes successfully!`,
          timestamp: new Date()
        }]);

      } else if (result.success) {
        aiResponse = result.operation?.description || 'No changes were needed for your request.';
        setChatHistory(prev => [...prev, {
          type: 'ai',
          message: aiResponse,
          timestamp: new Date()
        }]);
      } else {
        throw new Error(result.error || 'AI operation failed');
      }

    } catch (err: any) {
      console.error('Error in chat:', err);
      const errorMessage = err.message || err.response?.data?.detail || 'Failed to process your request';
      setChatHistory(prev => [...prev, {
        type: 'ai',
        message: `❌ Error: ${errorMessage}`,
        timestamp: new Date()
      }]);
    } finally {
      setIsProcessingChat(false);
    }
  };

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  };


  // Compute valid/invalid row indexes and counts
  const invalidRowIndexes = useMemo(() => {
    if (!importData?.conflicts) return new Set<number>();
    return new Set(importData.conflicts.map((c) => c.row));
  }, [importData?.conflicts]);

  const validRowCount = useMemo(() => {
    if (!originalData.length) return 0;
    return originalData.length - invalidRowIndexes.size;
  }, [originalData.length, invalidRowIndexes]);

  const invalidRowCount = useMemo(() => invalidRowIndexes.size, [invalidRowIndexes]);

  const getStatusBadge = (status: string) => {
    const baseClasses = "inline-flex items-center gap-x-1 rounded-full py-1 px-2.5 text-xs font-semibold"
    
    switch (status.toLowerCase()) {
      case 'completed':
        return (
          <span className={`${baseClasses} border border-teal-500/50 bg-teal-950/60 text-teal-400`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span>Completed</span>
          </span>
        )
      case 'uncompleted':
        return (
          <span className={`${baseClasses} border border-rose-400/50 bg-rose-950/50 text-rose-300 text-xs`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
            </svg>
            <span>Uncompleted</span>
          </span>
        )
      case 'validated':
        return (
          <span className={`${baseClasses} border border-teal-500/50 bg-teal-950/60 text-teal-400`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span>Validated</span>
          </span>
        )
      case 'failed':
        return (
          <span className={`${baseClasses} border border-red-600/50 bg-red-950/70 text-red-500`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <span>Failed</span>
          </span>
        )
      case 'processing':
      case 'importing':
        return (
          <span className={`${baseClasses} border border-purple-500/50 bg-purple-950/60 text-purple-400`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4"></path>
              <path d="m16.2 7.8 2.9-2.9"></path>
              <path d="M18 12h4"></path>
              <path d="m16.2 16.2 2.9 2.9"></path>
              <path d="M12 18v4"></path>
              <path d="m7.8 16.2-2.9 2.9"></path>
              <path d="M6 12H2"></path>
              <path d="m7.8 7.8-2.9-2.9"></path>
            </svg>
            <span>Processing</span>
          </span>
        )
      case 'pending':
        return (
          <span className={`${baseClasses} border border-yellow-500/50 bg-yellow-950/60 text-yellow-400`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"></path>
            </svg>
            <span>Pending</span>
          </span>
        )
      case 'promoting':
        return (
          <span className={`${baseClasses} border border-orange-500/50 bg-orange-950/60 text-orange-400`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 11 18-5v12L3 14v-3z"></path>
              <path d="M11.6 16.8a3 3 0 1 1-5.7-1.6"></path>
            </svg>
            <span>Promoting</span>
          </span>
        )
      case 'saving':
        return (
          <span className={`${baseClasses} border border-cyan-500/50 bg-cyan-950/60 text-cyan-400`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            <span>Saving</span>
          </span>
        )
      default:
        return (
          <span className={`${baseClasses} border border-gray-500/50 bg-gray-950/60 text-gray-400`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
            </svg>
            <span>Unknown</span>
          </span>
        )
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <FramerLoadingSpinner size="lg" text="Authenticating..." />
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <>
      {/* Navigation Breadcrumb */}
      <NavigationBreadcrumb 
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Imports", href: "/dashboard" },
          { label: importData?.import_info.file_name || 'View Data', current: true }
        ]}
        actions={
          <>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={fetchImportData}
              className="gap-2 bg-transparent border-muted/30"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadCSV}
              disabled={isDownloading || !importData}
              className="gap-2 bg-transparent border-muted/30"
            >
              <Download className="h-4 w-4" />
              {isDownloading ? 'Downloading...' : 'Download CSV'}
            </Button>
          </>
        }
      />

      <div className="h-[calc(100vh-52px)] flex flex-col">
        {isLoading ? (
          <div className="flex items-center justify-center flex-1">
            <div role="status">
              <svg aria-hidden="true" className="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
                <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
              </svg>
              <span className="sr-only">Loading...</span>
            </div>
          </div>
        ) : error ? (
          <div className="p-6 mx-8 flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-red-400 mb-4">{error}</p>
              <Button onClick={fetchImportData}>Try Again</Button>
            </div>
          </div>
        ) : importData ? (
          <div className="overflow-hidden flex flex-col flex-1">{/* Full height container */}
            {/* Header */}
            <div className="px-8 py-4 flex-shrink-0">{/* Add flex-shrink-0 */}
              <div className="p-1 border border-black-400 rounded-2xl mb-2">
                <Card className="p-6 bg-background/50 backdrop-blur-md border border-muted/20 rounded-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-6">
                    <h1 className="text-2xl font-semibold font-mono text-foreground">
                      {importData.import_info.file_name}
                    </h1>
                    {getStatusBadge(importData.import_info.status)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="default"
                      onClick={handleSaveChanges}
                      disabled={!hasChanges || isSaving || pendingCells.size > 0}
                      className={`gap-2 px-6 py-2 ${
                        hasChanges && pendingCells.size === 0
                          ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20' 
                          : pendingCells.size > 0
                          ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                          : 'bg-transparent border-muted/30 text-muted-foreground'
                      }`}
                      title={pendingCells.size > 0 ? `Wait for ${pendingCells.size} pending updates` : undefined}
                    >
                      {isSaving ? (
                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      {isSaving ? 'Saving...' : 
                       pendingCells.size > 0 ? `Wait (${pendingCells.size})` : 
                       'Save Changes'}
                    </Button>
                    <Button
                      variant="outline"
                      size="default"
                      onClick={handleDownloadCSV}
                      disabled={isDownloading || !importData}
                      className="p-2 bg-transparent border-muted/30"
                      title="Download CSV"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="default"
                      onClick={handleSendWebhook}
                      disabled={isSendingWebhook || !importData}
                      className="p-2 bg-transparent border-muted/30"
                      title="Send to Webhook"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Search Interface */}
                    <div className="relative flex items-center gap-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                          placeholder="Search in data..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10 w-64 h-8 bg-background/50 border-gray-400/30 text-sm focus:border-gray-400/50"
                        />
                      </div>
                    </div>
                    
                    {/* Filter Buttons */}
                    <div className="bg-muted/20 rounded-full p-1 flex items-center gap-1">
                      <button
                        className={`px-3 py-1 text-xs font-medium rounded-full border transition-all ${filterStatus === 'all' ? 'bg-blue-500/20 text-blue-400 border-blue-400/40' : 'bg-transparent text-white border-muted/40 hover:bg-muted/30'}`}
                        onClick={() => setFilterStatus('all')}
                      >
                        All <span className="text-blue-400">{originalData.length}</span>
                      </button>
                      <button
                        className={`px-3 py-1 text-xs font-medium rounded-full border transition-all ${filterStatus === 'valid' ? 'bg-green-500/20 text-green-500 border-green-500/40' : 'bg-transparent text-white border-muted/40 hover:bg-muted/30'}`}
                        onClick={() => setFilterStatus('valid')}
                      >
                        Valid <span className="text-green-500">{validRowCount}</span>
                      </button>
                      <button
                        className={`px-3 py-1 text-xs font-medium rounded-full border transition-all ${filterStatus === 'invalid' ? 'bg-red-500/20 text-red-500 border-red-500/40' : 'bg-transparent text-white border-muted/40 hover:bg-muted/30'}`}
                        onClick={() => setFilterStatus('invalid')}
                      >
                        Invalid <span className="text-red-500">{invalidRowCount}</span>
                      </button>
                    </div>
                  </div>
                  
                  <div className="text-sm text-muted-foreground">
                    <div className="text-right">
                      <div>Date created: {new Date(importData.import_info.created_at).toLocaleDateString()}</div>
                      <div>Last modified: {importData.import_info.updated_at ? new Date(importData.import_info.updated_at).toLocaleDateString() : 'Not modified'}</div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
            </div>

            {/* Data Table - Virtualized for performance */}
            <div className="flex-1 overflow-hidden mx-6">
              {!importData || !originalData || originalData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {searchTerm ? 'No records match your search criteria.' : 'No data available for this import.'}
                </div>
              ) : (
                <VirtualizedDataTable
                  headers={importData.headers}
                  data={originalData}
                  changedCells={changedCells}
                  editingCells={editingCells}
                  pendingCells={pendingCells}
                  conflicts={importData.conflicts}
                  getCellValue={getCellValue}
                  handleCellChange={handleCellChange}
                  handleEditStart={handleEditStart}
                  handleEditEnd={handleEditEnd}
                  searchTerm={searchTerm}
                  filterStatus={filterStatus}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Minimalist Toast Notification */}
      {toast.visible && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
          <div className={`
            flex items-center gap-2 px-4 py-2 rounded-lg border backdrop-blur-sm
            ${toast.type === 'loading' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 
              toast.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
              'bg-red-500/10 border-red-500/20 text-red-400'}
          `}>
            {toast.type === 'loading' && (
              <FramerLoadingSpinner size="sm" showText={false} />
            )}
            {toast.type === 'success' && (
              <div className="h-3 w-3 rounded-full bg-green-400 flex items-center justify-center">
                <div className="h-1.5 w-1.5 rounded-full bg-background"></div>
              </div>
            )}
            {toast.type === 'error' && (
              <div className="h-3 w-3 rounded-full bg-red-400 flex items-center justify-center">
                <div className="h-0.5 w-1.5 rounded-full bg-background"></div>
              </div>
            )}
            <span className="text-xs font-medium">{toast.message}</span>
            {toast.type !== 'loading' && (
              <button 
                onClick={hideToast}
                className="ml-1 h-3 w-3 rounded-full hover:bg-current/20 flex items-center justify-center"
              >
                <span className="text-xs leading-none">×</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modern Chat Interface */}
      <FloatingChatButton isOpen={isChatOpen} onClick={() => setIsChatOpen(!isChatOpen)} />
      
      <ChatWindow
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={chatHistory}
        onSendMessage={handleChatSubmit}
        isProcessing={isProcessingChat}
        currentMessage={chatPrompt}
        onMessageChange={setChatPrompt}
        onKeyDown={handleChatKeyDown}
      />

    </>
  )
}

// --- START: Pagination component (COMMENTED OUT - kept for potential future use) ---
/*
interface PaginationProps {
  currentPage: number
  totalPages: number
  totalResults: number
  pageSize: number
  onPageChange: (page: number) => void
}

const Pagination = ({ currentPage, totalPages, totalResults, pageSize, onPageChange }: PaginationProps) => {
  const startItem = (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalResults)

  const getPaginationItems = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }

    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, '...', totalPages]
    }

    if (currentPage > totalPages - 4) {
      return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    }

    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
  }

  const paginationItems = getPaginationItems()

  if (totalResults === 0) return null

  return (
    <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 sm:px-6 flex-shrink-0 bg-background">
      <div className="flex flex-1 justify-between sm:hidden">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="relative inline-flex items-center rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-white/10 disabled:opacity-50"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="relative ml-3 inline-flex items-center rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-white/10 disabled:opacity-50"
        >
          Next
        </button>
      </div>
      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-300">
            Showing
            <span className="font-medium"> {startItem} </span>
            to
            <span className="font-medium"> {endItem} </span>
            of
            <span className="font-medium"> {totalResults} </span>
            results
          </p>
        </div>
        <div>
          <nav aria-label="Pagination" className="isolate inline-flex -space-x-px rounded-md">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-700 hover:bg-white/5 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
            >
              <span className="sr-only">Previous</span>
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
                <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
              </svg>
            </button>

            {paginationItems.map((item, index) =>
              typeof item === 'number' ? (
                <button
                  key={index}
                  onClick={() => onPageChange(item)}
                  aria-current={currentPage === item ? 'page' : undefined}
                  className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ${
                    currentPage === item
                      ? 'z-10 bg-amber-600 text-white focus:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600'
                      : 'text-gray-200 ring-1 ring-inset ring-gray-700 hover:bg-white/5 focus:z-20 focus:outline-offset-0'
                  }`}
                >
                  {item}
                </button>
              ) : (
                <span key={index} className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-400 ring-1 ring-inset ring-gray-700 focus:outline-offset-0">
                  ...
                </span>
              )
            )}

            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-700 hover:bg-white/5 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
            >
              <span className="sr-only">Next</span>
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
                <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </button>
          </nav>
        </div>
      </div>
    </div>
  )
}
*/
// --- END: Pagination component ---
