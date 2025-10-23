'use client'

import React from 'react'

interface FramerLoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
  text?: string
  className?: string
}

const FramerLoadingSpinner: React.FC<FramerLoadingSpinnerProps> = ({
  size = 'md',
  showText = true,
  text = 'Loading...',
  className = ''
}) => {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6', 
    lg: 'h-8 w-8'
  }

  const containerSizeClasses = {
    sm: 'gap-1.5 px-2 py-1',
    md: 'gap-2 px-3 py-1.5',
    lg: 'gap-3 px-4 py-2'
  }

  const textSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  }

  return (
    <div className={`inline-flex items-center ${containerSizeClasses[size]} ${className}`}>
      {/* Container for the spinner */}
      <div className={`relative ${sizeClasses[size]}`}>
        {/* Base circle - static background */}
        <svg 
          className="absolute inset-0 w-full h-full" 
          viewBox="0 0 24 24" 
          fill="none"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="rgba(241, 242, 244, 0.16)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>

        {/* Animated stroke */}
        <svg 
          className="absolute inset-0 w-full h-full animate-spin" 
          viewBox="0 0 24 24" 
          fill="none"
          style={{
            animation: 'spin 0.5s linear infinite'
          }}
        >
          <path
            d="M22 12C22 13.07 21.768 14.086 21.352 15C20.913 15.965 20.268 16.817 19.474 17.5"
            stroke="rgb(241, 242, 244)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Blurred glow effect - main stroke */}
        <svg 
          className="absolute inset-0 w-full h-full animate-spin" 
          viewBox="0 0 24 24" 
          fill="none"
          style={{
            filter: 'blur(4px)',
            animation: 'spin 0.5s linear infinite'
          }}
        >
          <path
            d="M22 12C22 13.07 21.768 14.086 21.352 15C20.913 15.965 20.268 16.817 19.474 17.5"
            stroke="rgb(241, 242, 244)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Additional glow effect with reduced opacity */}
        <svg 
          className="absolute inset-0 w-full h-full animate-spin" 
          viewBox="0 0 24 24" 
          fill="none"
          style={{
            filter: 'blur(4px)',
            opacity: 0.25,
            animation: 'spin 0.5s linear infinite'
          }}
        >
          <path
            d="M22 12C22 13.07 21.768 14.086 21.352 15C20.913 15.965 20.268 16.817 19.474 17.5"
            stroke="rgb(241, 242, 244)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Inner glow effect */}
        <div 
          className="absolute inset-0 w-full h-full animate-spin"
          style={{
            mask: "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M22 12C22 13.07 21.768 14.086 21.352 15C20.913 15.965 20.268 16.817 19.474 17.5\" stroke=\"white\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>') center / contain",
            WebkitMask: "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M22 12C22 13.07 21.768 14.086 21.352 15C20.913 15.965 20.268 16.817 19.474 17.5\" stroke=\"white\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>') center / contain",
            animation: 'spin 0.5s linear infinite'
          }}
        >
          {/* Blur layers for inner glow */}
          <div 
            className="absolute inset-0 w-full h-full"
            style={{
              filter: 'blur(2px)',
              background: 'rgb(241, 242, 244)'
            }}
          />
          <div 
            className="absolute inset-0 w-full h-full"
            style={{
              filter: 'blur(3px)',
              background: 'rgb(241, 242, 244)'
            }}
          />
        </div>
      </div>

      {/* Text */}
      {showText && (
        <span className={`font-medium text-gray-300 ${textSizeClasses[size]}`}>
          {text}
        </span>
      )}

      {/* Background shadow effect */}
      <div 
        className="absolute -bottom-2 -left-2 w-4 h-4 rounded-full blur-lg opacity-30"
        style={{
          background: 'rgb(15, 15, 15)',
          transform: 'rotate(30deg)',
          animation: 'float 2s ease-in-out infinite'
        }}
      />

      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateX(0px) rotate(30deg); }
          50% { transform: translateX(108px) rotate(30deg); }
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default FramerLoadingSpinner