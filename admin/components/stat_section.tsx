"use client"

import { Card } from "@/components/ui/card"
import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { statisticsApi, authApi } from '@/src/utils/apiClient'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
)

// Custom Dropdown Component
const CustomDropdown = ({ 
  value, 
  onChange, 
  options 
}: { 
  value: string; 
  onChange: (value: string) => void; 
  options: { value: string; label: string }[];
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div ref={dropdownRef} className="relative">
      {/* Dropdown trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-xs text-muted-foreground/70 bg-black/20 border border-border/30 rounded-md px-2 py-1 cursor-pointer appearance-none pr-6 hover:bg-black/30 hover:border-border/50 transition-all duration-200 focus:outline-none focus:ring-0 focus:border-border/60 min-w-[100px] text-left relative"
      >
        {selectedOption?.label}
        <svg 
          className={`absolute right-2 top-1/2 transform -translate-y-1/2 w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" 
          viewBox="0 0 20 20"
        >
          <path stroke="#888" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 8l4 4 4-4"/>
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-full bg-black/90 backdrop-blur-md border border-border/50 rounded-md shadow-lg z-50 overflow-hidden">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors duration-150 hover:bg-white/10 ${
                value === option.value 
                  ? 'bg-white/10 text-white' 
                  : 'text-muted-foreground/80 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// --- Types for our fetched data ---
interface TrendPoint {
  date: string;
  value: number;
}

interface DashboardData {
  summary: {
    total_importers: number;
    total_imports_30d: number;
    total_conflicts_30d: number;
    success_rate_30d: number;
    // New period-specific fields
    total_conflicts_period: number;
    total_imports_period: number;
    success_rate_period: number;
  };
  trends: {
    conflicts_period: TrendPoint[];
    imports_period: TrendPoint[];
  };
}

interface UsageData {
  plan_type: string;
  limits: {
    max_importers: number;
    max_imports_per_month: number;
    max_file_size_mb: number;
    max_file_size_bytes: number;
  };
  usage: {
    importers: {
      current: number;
      max: number;
      percentage: number;
    };
    imports_this_month: {
      current: number;
      max: number;
      percentage: number;
    };
  };
  can_create_importer: boolean;
  can_create_import: boolean;
}

export function StatisticsSection() {
  const [conflictsData, setConflictsData] = useState<DashboardData | null>(null);
  const [importsData, setImportsData] = useState<DashboardData | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflictsPeriod, setConflictsPeriod] = useState<"7d" | "1m" | "6m">("7d");
  const [importsPeriod, setImportsPeriod] = useState<"7d" | "1m" | "6m">("7d");

  // Dropdown options
  const periodOptions = [
    { value: "7d", label: "last 7 days" },
    { value: "1m", label: "last 1 month" },
    { value: "6m", label: "last 6 months" }
  ];

  // Fetch conflicts data
  useEffect(() => {
    const fetchConflictsData = async () => {
      try {
        setLoading(true);
        const stats = await statisticsApi.getDashboardStatistics(conflictsPeriod);
        setConflictsData(stats);
      } catch (err) {
        setError("Failed to load conflicts statistics.");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchConflictsData();
  }, [conflictsPeriod]);

  // Fetch imports data
  useEffect(() => {
    const fetchImportsData = async () => {
      try {
        const stats = await statisticsApi.getDashboardStatistics(importsPeriod);
        setImportsData(stats);
      } catch (err) {
        setError("Failed to load imports statistics.");
        console.error(err);
      }
    };
    fetchImportsData();
  }, [importsPeriod]);

  // Fetch usage data
  useEffect(() => {
    const fetchUsageData = async () => {
      try {
        const usage = await authApi.getUsageInfo();
        setUsageData(usage);
      } catch (err) {
        console.error("Failed to load usage data:", err);
        // Don't set error for usage data since it's not critical
      }
    };
    fetchUsageData();
  }, []);

  // Helper function to ensure all dates in period are represented with zero values if missing
  const fillMissingDates = (data: TrendPoint[], period: string) => {
    const endDate = new Date();
    const startDate = new Date();
    
    // Calculate start date based on period
    if (period === '7d') {
      startDate.setDate(endDate.getDate() - 6); // Last 7 days including today
    } else if (period === '1m') {
      startDate.setDate(endDate.getDate() - 29); // Last 30 days including today
    } else if (period === '6m') {
      startDate.setDate(endDate.getDate() - 179); // Last 180 days including today
    }
    
    const filledData: TrendPoint[] = [];
    const sortedData = [...(data || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const existingPoint = sortedData.find(d => d.date === dateStr);
      
      filledData.push({
        date: dateStr,
        value: existingPoint ? existingPoint.value : 0
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return filledData;
  };

  // Chart data for conflicts
  // Build chart data with a simple transform that makes small values visible.
  // We use a log transform (log10) for positive values so that small counts are more visible
  // when compared to very large peaks. Zero values are floored to a visible minimum of 0.5
  // as requested.
  const conflictsChartData = useMemo(() => {
    const rawData = conflictsData?.trends.conflicts_period || [];
    const filledData = fillMissingDates(rawData, conflictsPeriod);

    const originals = filledData.map(d => d.value ?? 0);
    
    // Find the maximum value for scaling
    const maxValue = Math.max(...originals);
    
    if (maxValue === 0) {
      // If all values are zero, show them all at a minimal height
      const display = originals.map(() => 0.1);
      return {
        labels: filledData.map(d => new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
        datasets: [{
          label: 'Conflicts',
          data: display,
          original: originals,
          backgroundColor: 'rgba(249, 115, 22, 0.2)',
          borderColor: 'rgba(249, 115, 22, 1)',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        }],
      };
    }
    
    // Aggressive scaling: cube root of percentage for better visual distinction
    const display = originals.map(v => {
      if (v === 0) return 0.05; // Very small for zeros
      const percentage = v / maxValue; // 0 to 1
      const scaled = Math.pow(percentage, 0.3); // Cube root for aggressive scaling
      return Math.max(scaled, 0.1); // Minimum 10% height for non-zero values
    });

    return {
      labels: filledData.map(d => new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
      datasets: [
        {
          label: 'Conflicts',
          data: display,
          original: originals,
          backgroundColor: originals.map(v => (v === 0 ? 'rgba(249, 115, 22, 0.15)' : 'rgba(249, 115, 22, 0.8)')),
          borderColor: 'rgba(249, 115, 22, 1)',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    };
  }, [conflictsData, conflictsPeriod]);

  // Chart data for imports
  const importsChartData = useMemo(() => {
    const rawData = importsData?.trends.imports_period || [];
    const filledData = fillMissingDates(rawData, importsPeriod);

    const originals = filledData.map(d => d.value ?? 0);
    
    // Find the maximum value for scaling
    const maxValue = Math.max(...originals);
    
    if (maxValue === 0) {
      // If all values are zero, show them all at a minimal height
      const display = originals.map(() => 0.1);
      return {
        labels: filledData.map(d => new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
        datasets: [{
          label: 'Imports',
          data: display,
          original: originals,
          backgroundColor: 'rgba(34, 197, 94, 0.2)',
          borderColor: 'rgba(34, 197, 94, 1)',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        }],
      };
    }
    
    // Aggressive scaling: cube root of percentage for better visual distinction
    const display = originals.map(v => {
      if (v === 0) return 0.05; // Very small for zeros
      const percentage = v / maxValue; // 0 to 1
      const scaled = Math.pow(percentage, 0.3); // Cube root for aggressive scaling
      return Math.max(scaled, 0.1); // Minimum 10% height for non-zero values
    });

    return {
      labels: filledData.map(d => new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
      datasets: [
        {
          label: 'Imports',
          data: display,
          original: originals,
          backgroundColor: originals.map(v => (v === 0 ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.8)')),
          borderColor: 'rgba(34, 197, 94, 1)',
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    };
  }, [importsData, importsPeriod]);

  // Chart options
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        left: 2,
        right: 2,
        top: 0,
        bottom: 0,
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(255, 255, 255, 0.2)',
        borderWidth: 1,
        callbacks: {
          // Show the original count in the tooltip (datasets[datasetIndex].original)
          label: function(context: any) {
            try {
              const dataset = context.dataset || {}
              const originals = dataset.original || []
              const originalValue = originals[context.dataIndex]
              return ` ${dataset.label || ''}: ${originalValue ?? 0}`
            } catch (e) {
              return ` ${context.dataset.label || ''}: ${context.formattedValue}`
            }
          }
        }
      },
    },
    scales: {
      x: {
        display: false,
        grid: {
          display: false,
        },
        categoryPercentage: 0.98, // Make bars span almost full width
        barPercentage: 0.95,      // Bars take up 95% of available category space
      },
      y: {
        display: false,
        grid: {
          display: false,
        },
        beginAtZero: true,
        min: 0, // Ensure zero values are shown
      },
    },
    elements: {
      bar: {
        borderRadius: {
          topLeft: 2,
          topRight: 2,
          bottomLeft: 0,
          bottomRight: 0,
        },
      },
    },
  };

  if (loading) {
    return (
        <div className="space-y-4 pb-6">
            <h2 className="text-lg font-medium text-muted-foreground">Statistics</h2>
            <div className="grid gap-6 max-w-6xl" style={{ gridTemplateColumns: '1fr 1fr 0.8fr' }}>
                <div className="h-48 w-full bg-gray-900/50 rounded-lg animate-pulse"></div>
                <div className="h-48 w-full bg-gray-900/50 rounded-lg animate-pulse"></div>
                <div className="h-48 w-full bg-gray-900/50 rounded-lg animate-pulse"></div>
            </div>
        </div>
    );
  }

  if (error || (!conflictsData && !importsData)) {
    return (
        <div className="space-y-4 pb-6">
            <h2 className="text-lg font-medium text-muted-foreground">Statistics</h2>
            <p className="text-red-400">{error || "No statistics data available."}</p>
        </div>
    );
  }

  return (
    <div className="space-y-4 pb-6 border-border/30">
      <h2 className="text-lg font-medium text-muted-foreground">Statistics</h2>

      <div className="grid gap-6 max-w-6xl" style={{ gridTemplateColumns: '1fr 1fr 0.8fr' }}>
        {/* Conflicts Card */}
        <Card className="pt-4 pl-4 bg-background/50 backdrop-blur border-border/50 relative overflow-hidden min-h-[200px]">
          <div className="space-y-2 pr-4 pb-24">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-semibold text-foreground">Conflicts</h3>
                <CustomDropdown
                  value={conflictsPeriod}
                  onChange={(value) => setConflictsPeriod(value as "7d" | "1m" | "6m")}
                  options={periodOptions}
                />
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{conflictsData?.summary.total_conflicts_period || 0}</div>
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-24">
              <div style={{ width: '100%', height: '100%' }}>
                <Bar data={conflictsChartData} options={chartOptions} />
              </div>
            </div>
          </div>
        </Card>

        {/* Total Imports Card */}
        <Card className="pt-4 pl-4 bg-background/50 backdrop-blur border-border/50 relative overflow-hidden min-h-[200px]">
          <div className="space-y-2 pr-4 pb-24">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-semibold text-foreground">Imports</h3>
                <CustomDropdown
                  value={importsPeriod}
                  onChange={(value) => setImportsPeriod(value as "7d" | "1m" | "6m")}
                  options={periodOptions}
                />
              </div>
              <div className="text-right">
                <div className="flex items-baseline gap-2">
                  <div className="text-xs text-green-500">
                    ({importsData?.summary.success_rate_period || 0}% successful)
                  </div>
                  <div className="text-2xl font-bold">{importsData?.summary.total_imports_period || 0}</div>
                </div>
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-24">
              <div style={{ width: '100%', height: '100%' }}>
                <Bar data={importsChartData} options={chartOptions} />
              </div>
            </div>
          </div>
        </Card>

        {/* Your Plan Card */}
        <Card className="pt-4 pl-4 bg-background/50 backdrop-blur border-border/50 relative overflow-hidden min-h-[200px]">
          <div className="space-y-4 pr-4 pb-4">
            <div>
              <h3 className="text-xl font-semibold text-foreground">Your Plan</h3>
              {usageData && (
                <div className="text-xs text-muted-foreground mt-1">
                  {usageData.plan_type.charAt(0) + usageData.plan_type.slice(1).toLowerCase()} Plan
                </div>
              )}
            </div>

            <div className="space-y-4">
              {/* Imports This Month Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Imports This Month</span>
                  <span>
                    {usageData?.usage.imports_this_month.current || 0} / {usageData?.usage.imports_this_month.max || 0}
                  </span>
                </div>
                <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500 shadow-lg shadow-blue-500/50"
                    style={{ width: `${Math.min(100, usageData?.usage.imports_this_month.percentage || 0)}%` }}
                  />
                </div>
              </div>

              {/* Importers Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Importers</span>
                  <span>
                    {usageData?.usage.importers.current || 0} / {usageData?.usage.importers.max || 0}
                  </span>
                </div>
                <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className="absolute top-0 left-0 h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-500 shadow-lg shadow-green-500/50"
                    style={{ width: `${Math.min(100, usageData?.usage.importers.percentage || 0)}%` }}
                  />
                </div>
              </div>

              {/* File Size Limit Display */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Max File Size</span>
                  <span>{usageData?.limits.max_file_size_mb || 0}MB per file</span>
                </div>
                <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div 
                    className="absolute top-0 left-0 h-full bg-gradient-to-r from-orange-500 to-yellow-500 rounded-full transition-all duration-500 shadow-lg shadow-orange-500/50"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
