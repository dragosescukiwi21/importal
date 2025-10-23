"use client"

import type React from "react"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Upload, FileText } from "lucide-react"
import { parseFile, type FileParserResult } from "@/src/utils/fileParser"
import { importsApi } from "@/src/utils/apiClient"
import { SheetSelector } from "./sheet-selector"
import FramerLoadingSpinner from "@/components/FramerLoadingSpinner"

interface UploadStepProps {
  data: any
  onUpdate: (data: any) => void
}

export function UploadStep({ data, onUpdate }: UploadStepProps) {
  const [isParsing, setIsParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSheetSelector, setShowSheetSelector] = useState(false)
  const [parsedResult, setParsedResult] = useState<FileParserResult | null>(null)
  const [parsingStatus, setParsingStatus] = useState<string>('')

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      // Get the importerId from the data prop - this should be available from parent component
      const importerId = data.importer_id

      if (file && importerId) {
        // Immediately update with file to show it in UI
        onUpdate({ file })
        setIsParsing(true)
        setError(null)
        setParsingStatus('Uploading file to server...')

        try {
          // Step 1: Upload the file to the backend (temporary storage)
          console.log('Step 1: Uploading file to backend temporary storage...')
          const uploadResponse = await importsApi.uploadFile(importerId, file)
          const uploadId = uploadResponse.upload_id // Get temporary upload ID
          const filePath = uploadResponse.file_path // Get S3 path
          console.log('Upload successful, got upload_id:', uploadId, 'file_path:', filePath)

          // Step 2: Parse the file locally for the UI mapping steps
          console.log('Step 2: Starting local file parsing...')
          setParsingStatus('Parsing file content...')
          
          // Add timeout for parsing
          const parsePromise = parseFile(file)
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('File parsing timeout - file may be too large or complex')), 30000) // 30 second timeout
          })
          
          const result: FileParserResult = await Promise.race([parsePromise, timeoutPromise])
          console.log('Step 2 complete: File parsed successfully')
          
          // Check for any non-critical errors
          if (result.errors.length > 0) {
            console.warn("File parsing warnings:", result.errors)
          }
          
          console.log('Parsed headers:', result.headers)
          console.log('Sample data:', result.data.slice(0, 3))
          console.log('File type:', result.fileType)
          if (result.sheetNames) {
            console.log('Available sheets:', result.sheetNames)
          }
          
          // If this is an Excel file with multiple sheets, show sheet selector
          if (result.sheetNames && result.sheetNames.length > 1) {
            setParsedResult(result)
            setShowSheetSelector(true)
            setIsParsing(false)
            return
          }
          
          // Step 3: Update parent state with parsed data and upload info
          console.log('Step 3: Updating parent state with parsed data...')
          setParsingStatus('Saving parsed data...')
          onUpdate({ 
            upload_id: uploadId,       // Store temporary upload ID
            file_path: filePath,       // Store S3 path for execute step
            file: file,
            allHeaders: result.allHeaders,
            selectedHeaders: result.selectedHeaders,
            headers: result.headers,
            data: result.data,
            fileType: result.fileType,
            sheetNames: result.sheetNames,
            selectedSheet: result.selectedSheet
          })
          console.log('Step 3 complete: Parent state updated')
          
          // Step 4: Set parsing to false after everything is done
          setIsParsing(false)
          setParsingStatus('')
          console.log('All steps complete - parsing finished')
          
          // Reset the file input so the same file can be selected again if needed
          event.target.value = ''
        } catch (error: any) {
          console.error('Error during file upload or parsing:', error)
          const errorMessage = error.response?.data?.detail || error.message || "Error uploading file. Please check the file format and try again."
          setError(errorMessage)
          alert(errorMessage)
          setIsParsing(false) // Set to false on error
          // Reset the file input on error too
          event.target.value = ''
        }
      } else if (!importerId) {
        setError("Importer ID is missing. Cannot upload file.")
      }
    },
    [onUpdate, data.importer_id],
  )

  const processParsedResult = useCallback(
    async (result: FileParserResult, uploadId: string, filePath: string, file: File) => {
      // Update the state with parsed data and upload info
      console.log('processParsedResult called with:', { uploadId, filePath, fileName: file.name, result })
      onUpdate({ 
        upload_id: uploadId,           // Store temporary upload ID
        file_path: filePath,           // Store S3 path
        file: file,                    // Use the actual file that was uploaded
        allHeaders: result.allHeaders,        // ALL headers from file - never changes
        selectedHeaders: result.selectedHeaders,   // Start with all headers selected
        headers: result.headers,           // For backward compatibility
        data: result.data,                 // Renamed from csvData to data
        fileType: result.fileType,         // Add file type
        sheetNames: result.sheetNames,     // Add sheet names for Excel files
        selectedSheet: result.selectedSheet // Add selected sheet
      })
      console.log('State updated with file:', file.name)
    },
    [onUpdate],
  )

  const handleSheetChange = useCallback(
    async (sheetName: string) => {
      if (!parsedResult || !data.file) return
      
      try {
        setIsParsing(true)
        // Re-parse the file with the selected sheet
        const result = await parseFile(data.file, { sheetName })
        await processParsedResult(result, data.upload_id, data.file_path, data.file)
        setShowSheetSelector(false)
        setParsedResult(null)
      } catch (error: any) {
        console.error('Error parsing selected sheet:', error)
        setError(error.message || "Error parsing selected sheet")
      } finally {
        setIsParsing(false)
      }
    },
    [parsedResult, data.file, data.upload_id, data.file_path, processParsedResult],
  )

  const handleSheetContinue = useCallback(
    async () => {
      if (!parsedResult) return
      await processParsedResult(parsedResult, data.upload_id, data.file_path, data.file)
      setShowSheetSelector(false)
      setParsedResult(null)
    },
    [parsedResult, data.upload_id, data.file_path, data.file, processParsedResult],
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const file = event.dataTransfer.files[0]
      if (file && /\.(csv|xlsx|xls|ods)$/i.test(file.name)) {
        // Create a synthetic event to trigger the file upload
        const input = document.getElementById('file-upload') as HTMLInputElement
        if (input) {
          const dataTransfer = new DataTransfer()
          dataTransfer.items.add(file)
          input.files = dataTransfer.files
          const event = new Event('change', { bubbles: true })
          input.dispatchEvent(event)
        }
      }
    },
    [],
  )

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
  }, [])

  return (
    <div className="space-y-6 min-h-[400px] flex flex-col justify-center">
      {showSheetSelector && parsedResult ? (
        <SheetSelector
          sheetNames={parsedResult.sheetNames || []}
          selectedSheet={parsedResult.selectedSheet || ''}
          onSheetChange={handleSheetChange}
          onContinue={handleSheetContinue}
        />
      ) : (
        <>
          <div className="text-center">
            <h2 className="text-xl font-semibold mb-2">Upload Your File</h2>
            <p className="text-muted-foreground">Select or drag and drop your CSV, Excel, or ODS file to begin the import process</p>
          </div>

          <Card
            className="border-2 border-dashed border-muted/50 bg-background/20 hover:border-muted/70 transition-colors cursor-pointer"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <div className="p-16 text-center min-h-[280px] flex items-center justify-center">
              {isParsing ? (
                <div className="space-y-4">
                  <FramerLoadingSpinner size="lg" showText={true} text={parsingStatus || 'Processing file...'} />
                </div>
              ) : data.file ? (
                <div className="space-y-4">
                  <FileText className="h-12 w-12 mx-auto text-green-500" />
                  <div>
                    <p className="font-medium">{data.file.name}</p>
                    <p className="text-sm text-muted-foreground">{(data.file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <Button variant="outline" className="bg-transparent border-muted/30">
                    <label htmlFor="file-upload" className="cursor-pointer">
                      Choose Different File
                    </label>
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                  <div>
                    <p className="font-medium mb-2">Drop your file here</p>
                    <p className="text-sm text-muted-foreground mb-4">or</p>
                    <Button variant="outline" className="bg-transparent border-muted/30">
                      <label htmlFor="file-upload" className="cursor-pointer">
                        Browse Files
                      </label>
                    </Button>
                  </div>
                </div>
              )}
              <input id="file-upload" type="file" accept=".csv,.xlsx,.xls,.ods" onChange={handleFileUpload} className="hidden" />
            </div>
          </Card>

          {error && (
            <div className="text-center">
              <p className="text-sm text-red-500">Error: {error}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
