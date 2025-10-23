"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, Copy, ExternalLink, MoreHorizontal, TestTube } from "lucide-react"
import Link from "next/link"
import { ColumnsTab } from "@/components/columns-tab"

export default function ImporterPage({ params }: { params: { id: string } }) {
  const [webhookEnabled, setWebhookEnabled] = useState(true)

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Sticky Top Taskbar */}
      <div className="sticky top-0 z-20 border-b bg-background/30 backdrop-blur px-8 py-3 flex items-center justify-between h-[52px]">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/dashboard" className="hover:text-foreground text-muted-foreground">
            Dashboard
          </Link>
          <span className="text-muted-foreground">{">"}</span>
          <span className="text-foreground font-semibold">Data</span>
          <span className="text-muted-foreground">{">"}</span>
          <span className="text-muted-foreground">Importer Configuration</span>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" className="gap-2 bg-transparent border-muted/30">
            <TestTube className="h-4 w-4" />
            Test Importer
          </Button>
          <Button variant="outline" size="sm" className="gap-2 bg-transparent border-muted/30">
            Preview
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button className="gap-2 bg-white text-black hover:bg-gray-100">
            Actions
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="mb-8">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground -ml-2">
            <Link href="/dashboard" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to list
            </Link>
          </Button>
        </div>

        <Tabs defaultValue="settings" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-muted/20 p-1 h-10 mb-8">
            <TabsTrigger value="settings" className="text-sm">
              Settings
            </TabsTrigger>
            <TabsTrigger value="columns" className="text-sm">
              Columns
            </TabsTrigger>
            <TabsTrigger value="embed" className="text-sm">
              Embed
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-8">
            <Card className="p-8 bg-background/30 border-muted/20">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-2">Key</h3>
                  <p className="text-sm text-muted-foreground mb-4">The unique key used to identify this Importer</p>
                  <div className="flex items-center gap-3">
                    <Input
                      value="78848202-563f-404c-b410-e97b858470cd"
                      readOnly
                      className="font-mono bg-background/50 border-muted/30"
                    />
                    <Button variant="outline" size="sm" className="border-muted/30 bg-transparent">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <Link
                    href="#"
                    className="text-sm text-blue-400 hover:text-blue-300 mt-3 inline-flex items-center gap-1"
                  >
                    How to embed the importer into your app
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </Card>

            <Card className="p-8 bg-background/30 border-muted/20">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-2">Name</h3>
                  <p className="text-sm text-muted-foreground mb-4">Give your importer a useful name</p>
                  <Input defaultValue="Data" className="bg-background/50 border-muted/30" />
                </div>
              </div>
            </Card>

            <Card className="p-8 bg-background/30 border-muted/20">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-2">Where to Send Uploaded Data</h3>
                  <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                    Choose how we send uploaded data to your app. Choose Webhook to have us send uploads to the Webhook
                    URL you enter below. Alternatively, choose onData callback to have data received directly in your
                    app frontend.
                  </p>

                  <div className="flex items-center justify-between py-4">
                    <div>
                      <Label htmlFor="webhook" className="text-base font-medium">
                        Webhook
                      </Label>
                    </div>
                    <Switch id="webhook" checked={webhookEnabled} onCheckedChange={setWebhookEnabled} />
                  </div>

                  {webhookEnabled && (
                    <div className="mt-6 space-y-4">
                      <div>
                        <Label htmlFor="webhook-url" className="text-sm font-medium text-muted-foreground">
                          Webhook URL
                        </Label>
                        <Input
                          id="webhook-url"
                          defaultValue="https://webhook.site/a80fe0a4-219e-46c1-be53-2be80793ed92"
                          className="mt-2 bg-background/50 border-muted/30"
                        />
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Uploaded data will be sent to our servers, and we will send you a webhook with the data.{" "}
                        <Link href="#" className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
                          Webhook docs
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="columns">
            <ColumnsTab />
          </TabsContent>

          <TabsContent value="embed">
            <Card className="p-8 bg-background/30 border-muted/20">
              <p className="text-muted-foreground">Embed configuration will be available here.</p>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
