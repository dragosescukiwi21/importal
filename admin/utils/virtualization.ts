/**
 * Utilities for efficient data virtualization
 */

export interface VirtualizationConfig {
  itemHeight: number
  bufferSize: number
  containerHeight: number
  scrollTop: number
  totalItems: number
}

/**
 * Calculate the visible range of items for virtualization
 */
export function calculateVisibleRange(config: VirtualizationConfig) {
  const { itemHeight, bufferSize, containerHeight, scrollTop, totalItems } = config
  
  // Calculate the first and last visible indices
  const firstVisibleIndex = Math.floor(scrollTop / itemHeight)
  const lastVisibleIndex = Math.ceil((scrollTop + containerHeight) / itemHeight)
  
  // Add buffer for smooth scrolling
  const startIndex = Math.max(0, firstVisibleIndex - bufferSize)
  const endIndex = Math.min(totalItems, lastVisibleIndex + bufferSize)
  
  return {
    startIndex,
    endIndex,
    offsetY: startIndex * itemHeight,
    visibleCount: endIndex - startIndex
  }
}

/**
 * Debounce function for scroll events
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func(...args), delay)
  }
}

/**
 * Throttle function for high-frequency events
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false
  let lastResult: any
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      lastResult = func(...args)
      inThrottle = true
      setTimeout(() => {
        inThrottle = false
      }, limit)
    }
    return lastResult
  }
}

/**
 * Request animation frame based throttle
 */
export function rafThrottle<T extends (...args: any[]) => any>(
  func: T
): (...args: Parameters<T>) => void {
  let rafId: number | null = null
  let lastArgs: Parameters<T> | null = null
  
  const throttled = (...args: Parameters<T>) => {
    lastArgs = args
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        if (lastArgs) {
          func(...lastArgs)
        }
        rafId = null
      })
    }
  }
  
  ;(throttled as any).cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }
  
  return throttled
}

/**
 * Efficient array chunking for batch operations
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize))
  }
  return chunks
}

/**
 * Memory-efficient data window manager
 */
export class DataWindowManager<T> {
  private cache: Map<number, T> = new Map()
  private maxCacheSize: number
  
  constructor(maxCacheSize: number = 1000) {
    this.maxCacheSize = maxCacheSize
  }
  
  get(index: number): T | undefined {
    return this.cache.get(index)
  }
  
  set(index: number, item: T): void {
    // If cache is at max size, remove oldest items
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(index, item)
  }
  
  clear(): void {
    this.cache.clear()
  }
  
  has(index: number): boolean {
    return this.cache.has(index)
  }
}