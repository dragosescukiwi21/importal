"use client"

import { Card } from "@/components/ui/card"
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, AreaChart, Area } from "recharts"

const data = [
  { name: 'Jan', value: 400, errors: 24 },
  { name: 'Feb', value: 300, errors: 13 },
  { name: 'Mar', value: 200, errors: 18 },
  { name: 'Apr', value: 278, errors: 39 },
  { name: 'May', value: 189, errors: 48 },
  { name: 'Jun', value: 239, errors: 38 },
]

export function SimpleCharts() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Line Chart */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Line Chart</h3>
        <div style={{ width: '100%', height: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Line 
                type="monotone" 
                dataKey="value" 
                stroke="#8884d8" 
                strokeWidth={2}
                dot={{ fill: '#8884d8' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Area Chart */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Area Chart</h3>
        <div style={{ width: '100%', height: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Area 
                type="monotone" 
                dataKey="errors" 
                stroke="#82ca9d" 
                fill="#82ca9d" 
                fillOpacity={0.6}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  )
}
