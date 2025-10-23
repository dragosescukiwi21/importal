import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface PricingSectionProps {
  onSelectPlan: (planId: string) => void;
}

export function PricingSection({ onSelectPlan }: PricingSectionProps) {
  return (
    <div className="mt-8 relative flex flex-col items-center">
      <h2 className="text-2xl font-semibold mb-6 text-center">Pricing Plans</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10 max-w-7xl">

        {/* Starter Plan */}
        <div className="p-1 border border-white/20 rounded-2xl">
          <Card className="p-6 bg-black/90 backdrop-blur-md border border-white/10 rounded-xl">
            <h3 className="text-lg font-semibold mb-2 text-gray-100">Starter</h3>
            <p className="text-sm text-muted-foreground mb-4">Everything you need to get started.</p>
            <div className="mb-6">
              <span className="text-4xl font-bold text-white">€19</span>
              <span className="text-sm text-muted-foreground ml-2">EUR<br />per month</span>
            </div>
            <Button 
              onClick={() => onSelectPlan('STARTER')} 
              className="w-full bg-gray-700 hover:bg-gray-600 text-white mb-6"
            >
              Subscribe Now
            </Button>
            <div>
              <p className="text-sm font-medium mb-4">Everything in Free, plus:</p>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>5 importers</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>15 imports per month</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>1MB max file size</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>Excel/ODS file support</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>Advanced validation</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>Email support</span>
                </li>
              </ul>
            </div>
          </Card>
        </div>

        {/* Pro Plan */}
        <div className="p-1 border border-white/20 rounded-2xl">
          <Card className="p-6 bg-black/90 backdrop-blur-md border border-white/10 rounded-xl">
            <h3 className="text-lg font-semibold mb-2 text-gray-100">Pro</h3>
            <p className="text-sm text-muted-foreground mb-4">All the extras for your growing team.</p>
            <div className="mb-6">
              <span className="text-4xl font-bold text-white">€59</span>
              <span className="text-sm text-muted-foreground ml-2">EUR<br />per month</span>
            </div>
            <Button 
              onClick={() => onSelectPlan('PRO')} 
              className="w-full bg-gray-700 hover:bg-gray-600 text-white mb-6"
            >
              Subscribe Now
            </Button>
            <div>
              <p className="text-sm font-medium mb-4">Everything in Starter, plus:</p>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>15 importers</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>35 imports per month</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>20MB max file size</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>Advanced analytics</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>Priority webhooks</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>Priority support</span>
                </li>
              </ul>
            </div>
          </Card>
        </div>

        {/* Scale Plan */}
        <div className="p-1 border border-white/20 rounded-2xl">
          <Card className="p-6 bg-black/90 backdrop-blur-md border border-white/10 rounded-xl">
            <h3 className="text-lg font-semibold mb-2 text-gray-100">Scale</h3>
            <p className="text-sm text-muted-foreground mb-4">Added flexibility at scale.</p>
            <div className="mb-6">
              <span className="text-4xl font-bold text-white">€199</span>
              <span className="text-sm text-muted-foreground ml-2">EUR<br />per month</span>
            </div>
            <Button 
              onClick={() => onSelectPlan('SCALE')} 
              className="w-full bg-gray-700 hover:bg-gray-600 text-white mb-6"
            >
              Subscribe Now
            </Button>
            <div>
              <p className="text-sm font-medium mb-4">Everything in Pro, plus:</p>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>100 importers</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>175 imports per month</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>100MB max file size</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>Custom integrations</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>Dedicated support</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span>SLA guarantee</span>
                </li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
      
      {/* Background gradient that gets blurred by cards above */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -bottom-32 -left-20 w-96 h-96 bg-gradient-to-r from-blue-500/30 to-purple-600/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 right-10 w-80 h-80 bg-gradient-to-r from-purple-500/25 to-pink-500/25 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 left-1/2 transform -translate-x-1/2 w-72 h-72 bg-gradient-to-r from-indigo-500/20 to-blue-600/20 rounded-full blur-3xl" />
      </div>
    </div>
  );
}
