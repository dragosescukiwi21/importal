"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Avatar } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Trash2, Plus, MoreHorizontal, Copy, TestTube, Download, Send } from "lucide-react"
import Link from "next/link"
import { useAuth } from "@/src/context/AuthContext"
import { useRouter } from "next/navigation"
import { importersApi, importsApi } from "@/src/utils/apiClient"
import { ImportDataCard } from "@/components/import-data-card"
import { NavigationBreadcrumb } from "@/components/navigation-breadcrumb"
import FramerLoadingSpinner from "@/components/FramerLoadingSpinner"

// Interface for importer data
interface Importer {
  id: string;
  name: string;
  description?: string;
  fields: any[];
}

// Interface for import job data
interface ImportJob {
  id: string;
  importer_id: string;
  file_name: string;
  import_source?: 'api' | 'portal';  // NEW: Source of the import
  status: 'PENDING_VALIDATION' | 'PENDING' | 'PROCESSING' | 'VALIDATING' | 'VALIDATED' | 'IMPORTING' | 'COMPLETED' | 'UNCOMPLETED' | 'FAILED';
  row_count: number;
  processed_rows: number;
  error_count: number;
  created_at: string;
  completed_at?: string
  importer?: {
    id: string;
    name: string;
    description?: string;
  };
}

export default function DashboardPage() {
  const [importerList, setImporterList] = useState<Importer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const { isAuthenticated, isLoading: authLoading, logout, user } = useAuth()
  const router = useRouter()

  // Import jobs state
  const [importJobs, setImportJobs] = useState<ImportJob[]>([])
  const [isLoadingJobs, setIsLoadingJobs] = useState(true) // Keep for importers
  const [jobsError, setJobsError] = useState<string | null>(null) // Keep for importers
  
  // Sorting state
  const [sortBy, setSortBy] = useState<'status' | 'importer' | 'created_at'>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  
  // Filter state
  const [filterValidated, setFilterValidated] = useState<'all' | 'validated' | 'not_validated' | 'importers'>('all')
  const [filterImporter, setFilterImporter] = useState<'all' | string>('all')
  
  // Download state
  const [downloadingJobs, setDownloadingJobs] = useState<Set<string>>(new Set())
  
  // Pagination state for imports (keeping original pagination)
  const [currentPage, setCurrentPage] = useState(1)
  const [importsPerPage] = useState(5) // Back to original page size
  const [totalImports, setTotalImports] = useState(0)
  const [isLoadingImports, setIsLoadingImports] = useState(false)
  
  // Deleting state
  const [deletingJobs, setDeletingJobs] = useState<Set<string>>(new Set())

  // Dialog states
  const [showDeleteImporterDialog, setShowDeleteImporterDialog] = useState(false)
  const [importerToDelete, setImporterToDelete] = useState<Importer | null>(null)
  const [showDeleteImportDialog, setShowDeleteImportDialog] = useState(false)
  const [importToDelete, setImportToDelete] = useState<ImportJob | null>(null)
  const [showWebhookSuccessDialog, setShowWebhookSuccessDialog] = useState(false)


  useEffect(() => {
    fetchImporters();
    fetchImportJobs();
  }, []);

  // useEffect(() => {
  //   if (!authLoading && !isAuthenticated) {
  //     router.push('/login')
  //     return
  //   }

  //   if (isAuthenticated) {
  //     fetchImporters()
  //     fetchImportJobs()
  //   }
  // }, [isAuthenticated, authLoading, router])

  const fetchImporters = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const data = await importersApi.getImporters()
      setImporterList(data || [])
    } catch (err: any) {
      console.error('Error fetching importers:', err)
      setImporterList([])
      setError('Failed to load importers. Please check your connection and try again.')
      
      if (err.response && err.response.status === 401) {
        router.push('/login')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const fetchImportJobs = async () => {
    setIsLoadingImports(true)
    setJobsError(null)

    try {
      // Fetch all data but with performance optimization
      const data = await importsApi.getImports(0, 1000) // Get up to 1000 records
      setImportJobs(data || [])
    } catch (err: any) {
      console.error('Error fetching import jobs:', err)
      setImportJobs([])
      setJobsError(`Failed to load import data: ${err.response?.data?.detail || err.message}`)
    } finally {
      setIsLoadingImports(false)
    }
  }

  // Memoize the importers list to prevent unnecessary re-renders
  const stableImporters = useMemo(() => importerList, [importerList])

  // Calculate total relevant imports (excluding PENDING_VALIDATION and PENDING)
  const totalRelevantImports = useMemo(() => {
    const visibleStatuses = ['PROCESSING', 'VALIDATED', 'COMPLETED', 'UNCOMPLETED', 'FAILED']
    return importJobs.filter(job => visibleStatuses.includes(job.status)).length
  }, [importJobs])

  // Sort and filter import jobs based on current criteria
  // Optimized sorting and filtering with better performance but keeping full functionality
  const sortedImportJobs = useMemo(() => {
    // Early return for empty data
    if (importJobs.length === 0) return []
    
    // Include all visible statuses
    // PENDING_VALIDATION is excluded - these are incomplete wizard uploads
    // PENDING is excluded - transient state before worker picks up job
    const visibleStatuses = ['PROCESSING', 'VALIDATED', 'COMPLETED', 'UNCOMPLETED', 'FAILED']
    
    // Use efficient single-pass filtering
    const filtered = importJobs.filter(job => {
      // Status check first (most filtering) - show processing and completed jobs
      if (!visibleStatuses.includes(job.status)) return false
      
      // Validation filter
      if (filterValidated === 'validated') {
        return job.status === 'VALIDATED' || job.status === 'COMPLETED'
      } else if (filterValidated === 'not_validated') {
        return job.status !== 'VALIDATED' && job.status !== 'COMPLETED'
      } else if (filterValidated === 'importers' && filterImporter !== 'all') {
        return job.importer_id === filterImporter
      }
      
      return true
    })

    // Optimized sorting with pre-calculated sort keys
    return filtered.sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case 'status':
          comparison = a.status.localeCompare(b.status)
          break
        case 'importer':
          const aName = a.importer?.name || 'Unknown'
          const bName = b.importer?.name || 'Unknown'
          comparison = aName.localeCompare(bName)
          break
        case 'created_at':
        default:
          // Use direct time comparison for better performance
          const aTime = new Date(a.created_at).getTime()
          const bTime = new Date(b.created_at).getTime()
          comparison = aTime - bTime
          break
      }

      return sortOrder === 'asc' ? comparison : -comparison
    })
  }, [importJobs, sortBy, sortOrder, filterValidated, filterImporter])

  const handleSort = (column: 'status' | 'importer' | 'created_at') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('asc')
    }
  }

  const handleDeleteImporter = (importer: Importer) => {
    setImporterToDelete(importer)
    setShowDeleteImporterDialog(true)
  }

  const removeImporter = async (id: string) => {
    try {
      await importersApi.deleteImporter(id)
      setImporterList((prev) => prev.filter((importer) => importer.id !== id))
      setShowDeleteImporterDialog(false)
      setImporterToDelete(null)
    } catch (err: any) {
      console.error('Error deleting importer:', err)
      setError(err.message || 'An error occurred while deleting the importer')
    }
  }

  const handleSendToWebhook = async (importJob: ImportJob) => {
    try {
      // Allow webhooks for COMPLETED and UNCOMPLETED (portal-managed) imports
      if (!['COMPLETED', 'UNCOMPLETED'].includes(importJob.status)) {
        alert('Webhooks can only be sent for completed or portal-managed (uncompleted) imports.');
        return;
      }
      
      // Now we call the real API endpoint
      await importsApi.resendWebhook(importJob.id);
      setShowWebhookSuccessDialog(true);

    } catch (err: any) {
      console.error('Error resending webhook:', err);
      alert(`Failed to resend webhook: ${err.message}`);
    }
  };

  const handleDownloadCSV = async (importJob: ImportJob) => {
    try {
  // Allow downloads for both COMPLETED and UNCOMPLETED imports when data is available
  // (backend enforces processed_data existence)
      
      // Add loading state
      setDownloadingJobs(prev => new Set(prev).add(importJob.id));

      // Download the file in original format
      const { blob, filename } = await importsApi.downloadFile(importJob.id);
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
    } catch (err: any) {
      console.error('Error downloading file:', err);
      alert(`Failed to download file: ${err.message}`);
    } finally {
      // Remove loading state
      setDownloadingJobs(prev => {
        const newSet = new Set(prev);
        newSet.delete(importJob.id);
        return newSet;
      });
    }
  }

  const handleDeleteImportClick = (importJob: ImportJob) => {
    setImportToDelete(importJob)
    setShowDeleteImportDialog(true)
  }

  const handleDeleteImport = async () => {
    if (!importToDelete) return

    try {
      setDeletingJobs(prev => new Set(prev).add(importToDelete.id))
      await importsApi.deleteImport(importToDelete.id)
      
      // Remove from local state
      setImportJobs(prev => prev.filter(job => job.id !== importToDelete.id))
      
      // Adjust pagination if needed
      const totalPages = Math.ceil((importJobs.length - 1) / importsPerPage)
      if (currentPage > totalPages && totalPages > 0) {
        setCurrentPage(totalPages)
      }
      
      // Close dialog and clear state
      setShowDeleteImportDialog(false)
      setImportToDelete(null)
      
    } catch (err: any) {
      console.error('Error deleting import:', err)
      alert(`Failed to delete import: ${err.message}`)
    } finally {
      setDeletingJobs(prev => {
        const newSet = new Set(prev)
        newSet.delete(importToDelete.id)
        return newSet
      })
    }
  }

  const getStatusBadge = (status: string) => {
    const baseClasses = "inline-flex items-center gap-x-1 rounded-full py-1 px-2.5 text-xs font-semibold"
    
    switch (status.toLowerCase()) {
      case 'completed':
        return (
          <span className={`${baseClasses} border border-teal-500/50 bg-teal-950/60 text-teal-400`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span>Completed</span>
          </span>
        )
      case 'uncompleted':
        return (
          <span className={`${baseClasses} border border-rose-400/50 bg-rose-950/50 text-rose-300`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

  // Client-side pagination with optimized data
  const totalPages = Math.ceil(sortedImportJobs.length / importsPerPage)
  const startIndex = (currentPage - 1) * importsPerPage
  const endIndex = startIndex + importsPerPage
  const paginatedImportJobs = sortedImportJobs.slice(startIndex, endIndex)

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
  }

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  // if (authLoading) {
  //   return (
  //     <div className="min-h-screen bg-black text-white flex items-center justify-center">
  //       <p>Loading...</p>
  //     </div>
  //   )
  // }

  // if (!isAuthenticated) {
  //   return null
  // }

  return (
    <>
      {/* Navigation Breadcrumb */}
      <NavigationBreadcrumb items={[
        { label: "Dashboard", current: true }
      ]} />

      <div className="p-8 max-w-[1400px] mx-auto">
          {/* Two Column Layout */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {/* Left Column - Importers */}
            <div>
              <Card className="p-6">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Importers</h2>
                  <Button className="gap-2" onClick={() => router.push('/dashboard/importers/new')}>
                    <Plus className="h-4 w-4" />
                    Create Importer
                  </Button>
                </div>
                
                {error && (
                  <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-md text-sm">
                    {error}
                  </div>
                )}
                
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading importers...
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Importer</TableHead>
                        <TableHead>Fields</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importerList.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                            No importers found. Create your first importer to get started.
                          </TableCell>
                        </TableRow>
                      ) : (
                        importerList.map((importer, index) => (
                          <TableRow key={importer.id}>
                            <TableCell className="font-bold">
                              <div className="flex items-center gap-6">
                                <div className="text-white font-normal text-xl border-r border-white/20 pr-6">
                                  {index + 1}
                                </div>
                                <div className="flex-1">
                                  <Link
                                    href={`/dashboard/importers/${importer.id}`}
                                    className="text-blue-400 hover:text-blue-300 font-medium text-base block"
                                  >
                                    {importer.name}
                                  </Link>
                                  <div className="mt-1 space-y-1">
                                    <div className="text-xs">
                                      <span className="text-white/100">ID:</span> <span className="text-muted-foreground">{importer.id}</span>
                                    </div>
                                    {importer.description && (
                                      <div className="text-xs text-muted-foreground">
                                        {importer.description}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-x-1 rounded-full py-1 px-2 text-xs font-semibold border border-white/30 bg-white/10 text-white/80">
                                {importer.fields?.length || 0} fields
                              </span>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteImporter(importer)}
                                className="text-red-400 hover:text-red-300"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
              </Card>
            </div>

            {/* Right Column - Import Data */}
            <div>
              <Card className="p-6">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Import Data</h2>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={fetchImportJobs} className="gap-2">
                      <Download className="h-4 w-4" />
                      Refresh
                    </Button>
                    <Button onClick={() => setShowImportModal(true)} className="gap-2">
                      <Plus className="h-4 w-4" />
                      Import Data
                    </Button>
                  </div>
                </div>
                
                {/* Filter Controls */}
                <div className="mb-4 flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Filter:</span>
                    <Select value={filterValidated} onValueChange={(value: 'all' | 'validated' | 'not_validated' | 'importers') => setFilterValidated(value)}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="validated">Validated</SelectItem>
                        <SelectItem value="not_validated">Not Validated</SelectItem>
                        <SelectItem value="importers">Importers</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {filterValidated === 'importers' && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Importer:</span>
                      <Select value={filterImporter} onValueChange={setFilterImporter}>
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Importers</SelectItem>
                          {stableImporters.map((importer) => (
                            <SelectItem key={importer.id} value={importer.id}>
                              {importer.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  
                  <div className="text-sm text-muted-foreground">
                    Showing {sortedImportJobs.length} of {totalRelevantImports} imports
                  </div>
                </div>
                
                {jobsError && (
                  <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-md text-sm">
                    {jobsError}
                  </div>
                )}
                
                {isLoadingImports ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FramerLoadingSpinner size="md" text="Loading import data..." />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Database</TableHead>
                        <TableHead>
                          Status
                        </TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedImportJobs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                            No database imports found. Import some data to get started.
                          </TableCell>
                        </TableRow>
                      ) : (
                        paginatedImportJobs.map((job, index) => (
                          <TableRow key={job.id}>
                            <TableCell className="font-bold">
                              <div className="flex items-center gap-6">
                                <div className="text-white font-normal text-xl">
                                  {startIndex + index + 1}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <Link 
                                      href={`/dashboard/imports/${job.id}/view`}
                                      className="text-blue-400 hover:text-blue-300 font-medium cursor-pointer text-base"
                                    >
                                      {job.file_name}
                                    </Link>
                                    {job.import_source === 'api' && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-white border border-white/20">
                                        API
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1 space-y-1">
                                    <div className="text-xs">
                                      <span className="text-white/100">Created:</span> <span className="text-muted-foreground">{new Date(job.created_at).toLocaleDateString()} <span className="font-bold">@</span> {new Date(job.created_at).toLocaleTimeString()}</span>
                                    </div>
                                    <div className="text-xs">
                                      <span className="text-white/100">Importer:</span> <span className="text-muted-foreground">{job.importer?.name || 'Unknown Importer'}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {getStatusBadge(job.status)}
                                {job.import_source === 'api' && (
                                  <span className="inline-flex items-center gap-x-1 rounded-full py-1 px-2.5 text-xs font-semibold border border-white/50 bg-white/10 text-white">
                                    A
                                  </span>
                                )}
                                {job.import_source === 'portal' && (
                                  <span className="inline-flex items-center gap-x-1 rounded-full py-1 px-2.5 text-xs font-semibold border border-orange-500/50 bg-orange-950/60 text-orange-400">
                                    P
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSendToWebhook(job)}
                                  disabled={!['COMPLETED', 'UNCOMPLETED'].includes(job.status)}
                                  className={!['COMPLETED', 'UNCOMPLETED'].includes(job.status) ? "text-gray-400" : "text-blue-400 hover:text-blue-300"}
                                  title={!['COMPLETED', 'UNCOMPLETED'].includes(job.status) ? "Webhooks can only be sent for completed or uncompleted imports" : "Send to importer webhook"}
                                >
                                  <Send className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDownloadCSV(job)}
                                  disabled={downloadingJobs.has(job.id) || !['COMPLETED', 'UNCOMPLETED'].includes(job.status)}
                                  className={!['COMPLETED', 'UNCOMPLETED'].includes(job.status) ? "text-gray-400" : "text-green-400 hover:text-green-300"}
                                  title={!['COMPLETED', 'UNCOMPLETED'].includes(job.status) ? "Download not available for this status" : "Download as CSV"}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteImportClick(job)}
                                  disabled={deletingJobs.has(job.id)}
                                  className="text-red-400 hover:text-red-300"
                                  title="Delete import"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
                
                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t border-muted/20">
                    <div className="text-sm text-muted-foreground">
                      Showing {startIndex + 1} to {Math.min(endIndex, sortedImportJobs.length)} of {sortedImportJobs.length} imports
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="h-8 px-3"
                      >
                        &lt;
                      </Button>
                      <span className="text-sm text-muted-foreground px-2">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="h-8 px-3"
                      >
                        &gt;
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </div>

        </div>
      
      {/* Import Data Modal */}
      <ImportDataCard
        open={showImportModal}
        onOpenChange={setShowImportModal}
        importers={stableImporters}
        onImportComplete={fetchImportJobs}
      />

      {/* Delete Importer Confirmation Dialog */}
      <AlertDialog open={showDeleteImporterDialog} onOpenChange={setShowDeleteImporterDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Importer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the importer "{importerToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowDeleteImporterDialog(false)
              setImporterToDelete(null)
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => importerToDelete && removeImporter(importerToDelete.id)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Import Confirmation Dialog */}
      <AlertDialog open={showDeleteImportDialog} onOpenChange={setShowDeleteImportDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Import</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the import "{importToDelete?.file_name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowDeleteImportDialog(false)
              setImportToDelete(null)
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteImport}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Webhook Success Dialog */}
      <AlertDialog open={showWebhookSuccessDialog} onOpenChange={setShowWebhookSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Webhook Sent</AlertDialogTitle>
            <AlertDialogDescription>
              The webhook has been successfully queued and will be sent shortly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowWebhookSuccessDialog(false)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
