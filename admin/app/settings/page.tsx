// settings/page.tsx

"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/src/context/AuthContext"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Key, Eye, EyeOff, Copy } from "lucide-react"
import { authApi, stripeApi } from "@/src/utils/apiClient"
import { SidebarLayout } from "@/components/sidebar-layout"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { PricingSection } from "@/components/pricing-section"

export default function SettingsPage() {
  const { user, isAuthenticated, isLoading: authLoading, logout, refreshUser } = useAuth();
  const router = useRouter();

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [showNewApiKey, setShowNewApiKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyPreview, setApiKeyPreview] = useState<string | null>(null); // for storing 8 chars

  // Minimalist Toast State
  const [toast, setToast] = useState<{
    message: string;
    type: 'loading' | 'success' | 'error';
    visible: boolean;
  }>({ message: '', type: 'success', visible: false });

  const showToast = (message: string, type: 'loading' | 'success' | 'error') => {
    setToast({ message, type, visible: true });
    if (type !== 'loading') {
      setTimeout(() => {
        setToast(prev => ({ ...prev, visible: false }));
      }, 3000);
    }
  };
  const hideToast = () => setToast(prev => ({ ...prev, visible: false }));

  const handlePlanSelect = async (planId: string) => {
    showToast('Creating checkout session...', 'loading');
    
    try {
      const data = await stripeApi.createCheckoutSession(
        planId,
        `${window.location.origin}/settings?success=true`,
        `${window.location.origin}/settings?cancelled=true`
      );
      
      // Redirect to Stripe Checkout
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        throw new Error('No checkout URL received');
      }
      
    } catch (error: any) {
      console.error('Stripe checkout error:', error);
      hideToast();
      
      const errorMessage = error.response?.data?.detail || 'Failed to start checkout process';
      showToast(errorMessage, 'error');
    }
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  // Handle Stripe success/cancel redirects
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const cancelled = urlParams.get('cancelled');
    const sessionId = urlParams.get('session_id');
    
    if (success === 'true') {
      showToast('Payment successful! Updating your plan...', 'loading');
      
      const updatePlan = async () => {
        try {
          // First verify payment and force plan update if we have session ID
          if (sessionId) {
            console.log('Verifying payment with session ID:', sessionId);
            const verifyResult = await stripeApi.verifyPayment(sessionId);
            console.log('Verify result:', verifyResult);
          }
          
          // Force refresh user data
          await refreshUser();
          
          hideToast();
          showToast('Welcome to your new plan!', 'success');
        } catch (error) {
          console.error('Failed to update plan:', error);
          hideToast();
          showToast('Payment successful! Please refresh the page to see your new plan.', 'success');
        }
      };
      
      // Small delay to ensure Stripe has processed everything
      setTimeout(updatePlan, 500);
      
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (cancelled === 'true') {
      showToast('Payment was cancelled.', 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [refreshUser]);


  useEffect(() => {
    if (isAuthenticated) {
      const fetchApiKey = async () => {
        try {
          const response = await authApi.getApiKey();
          setApiKey(response.api_key);
          if (response.api_key === "exists") {
            // Try to load preview from localStorage
            const storedPreview = localStorage.getItem("apiKeyPreview");
            if (storedPreview) {
              setApiKeyPreview(storedPreview);
            } else {
              setApiKeyPreview(null);
            }
          } else {
            setApiKeyPreview(null);
          }
        } catch (err) {
          console.error("Failed to fetch API key:", err);
        }
      };
      fetchApiKey();
    }
  }, [isAuthenticated]);

  // Confirmation dialog state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingRegen, setPendingRegen] = useState(false);

  const handleRegenerateKey = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authApi.regenerateApiKey();
      setNewApiKey(response.api_key);
      const preview = response.api_key.slice(0, 8);
      setApiKeyPreview(preview);
      localStorage.setItem("apiKeyPreview", preview);
      setShowApiKeyModal(true);
      setShowNewApiKey(true);
      setApiKey(response.api_key); // update immediately so button switches
    } catch (err: any) {
      console.error("API key regeneration error:", err);
    } finally {
      setIsLoading(false);
      setShowConfirmDialog(false);
      setPendingRegen(false);
    }
  };

  const handleCopy = () => {
    if (newApiKey && showNewApiKey) {
      navigator.clipboard.writeText(newApiKey);
      setCopySuccess(true);
      showToast("API key copied to clipboard.", 'success');
      setTimeout(() => setCopySuccess(false), 2000);
      setShowNewApiKey(false); // Hide after first copy
      setShowApiKeyModal(false); // Close modal after copy
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <SidebarLayout>
      {/* Full Page Grid Background */}
      <div 
        className="fixed inset-0 opacity-15 z-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px'
        }}
      ></div>

        <div className="relative z-10 p-6 max-w-5xl mx-auto flex flex-col items-center justify-center min-h-screen">
          <div className="p-1 border border-white/20 rounded-2xl w-full">
            <Card className="p-8 bg-black/90 backdrop-blur-md border border-white/10 rounded-xl">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
                {/* Left Side - User Information (This section is now fully included) */}
                <div className="space-y-6 lg:col-span-2">
                <div className="flex items-center gap-6">
                  <div className="h-20 w-20 rounded-full bg-gray-600 flex items-center justify-center text-white text-2xl font-medium shrink-0">
                    {user?.full_name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <div>
                    <h1 className="text-2xl font-semibold text-foreground mb-2">{user?.full_name || 'User'}</h1>
                    <p className="text-base text-muted-foreground mb-3">{user?.email}</p>
                    <Badge className="bg-blue-500/20 backdrop-blur-sm text-blue-300 border-blue-400/30 text-sm px-3 py-1">
                      {user?.plan_type ? (
                        user.plan_type.charAt(0) + user.plan_type.slice(1).toLowerCase()
                      ) : 'Free'} Plan
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Right Side - API Key */}
              <div className="space-y-4 flex flex-col justify-center">
                <h2 className="text-lg font-semibold">API Key</h2>
                {/* API Key Textbox with icons */}
                <div className="flex items-center gap-4">
                  <Key className={`h-6 w-6 ${!apiKey ? 'text-white-400' : 'text-muted-foreground'}`} />
                  {/* {apiKeyPreview ? (
                    <span className="font-mono text-base text-foreground">{apiKeyPreview + '...'}</span>
                  ) : apiKey ? (
                    <span className="font-mono text-base text-foreground">{apiKey.slice(0, 8) + '...'}</span>
                  ) : (
                    <span className="font-mono text-base text-green-400">••••••••••••••</span>
                  )} */}
                  <div className="flex-1 relative">
                    <Input
                      value={apiKeyPreview ? (apiKeyPreview + '...') : "••••••••••••••"}
                      readOnly
                      disabled={!apiKeyPreview}
                      className={`font-mono bg-black/50 backdrop-blur-sm border-gray-700/30 pr-16 h-10 text-sm tracking-tight ${!apiKeyPreview ? 'opacity-60 cursor-not-allowed text-white-400 border-white-400' : ''}`}
                      style={{ fontFamily: 'monospace' }}
                    />
                  </div>
                </div>
                {/* Create/Regenerate Key Button below textbox, moved right, smaller, no icon */}
                <div className="flex justify-end">
                  {!apiKey ? (
                    <Button
                      onClick={async () => {
                        setIsLoading(true);
                        setError(null);
                        try {
                          const response = await authApi.regenerateApiKey();
                          setNewApiKey(response.api_key);
                          setApiKeyPreview(response.api_key.slice(0, 8));
                          setShowApiKeyModal(true);
                          setShowNewApiKey(true);
                          setApiKey(response.api_key); // update so button switches
                        } catch (err: any) {
                          console.error("API key creation error:", err);
                        } finally {
                          setIsLoading(false);
                        }
                      }}
                      disabled={isLoading}
                      className={`border transition rounded-lg px-3 py-1.5 font-semibold text-xs border-green-400 bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:border-green-400`}
                    >
                      {isLoading ? "Creating..." : "Create Key"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => setShowConfirmDialog(true)}
                        disabled={isLoading}
                        className={`border transition rounded-lg px-3 py-1.5 font-semibold text-xs border-white/30 bg-white/10 text-white hover:bg-white/20 hover:border-white/20`}
                      >
                        {isLoading ? "Regenerating..." : "Regenerate Key"}
                      </Button>
                      {/* Confirmation Dialog */}
                      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Regenerate API Key?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to regenerate your API key? Your old key will no longer work.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel onClick={() => setShowConfirmDialog(false)}>No</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => {
                                setPendingRegen(true);
                                handleRegenerateKey();
                              }}
                              disabled={isLoading}
                            >
                              Yes, Regenerate
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                </div>
                {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
              </div>
            </div>
            </Card>
          </div>

          {/* Pricing Section - Centered */}
          <div className="w-full flex justify-center">
            <PricingSection onSelectPlan={handlePlanSelect} />
          </div>
        </div>

      {/* API Key Modal */}
      <Dialog open={showApiKeyModal} onOpenChange={setShowApiKeyModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your New API Key</DialogTitle>
            <DialogDescription>
              This is the only time you will be able to see your API key. Please copy and store it securely.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 mt-4">
            <Input
              value={newApiKey || ''}
              readOnly
              className="font-mono bg-black/50 backdrop-blur-sm border-gray-700/30 h-10 text-sm tracking-tight flex-1"
              style={{ fontFamily: 'monospace' }}
            />
            <Button onClick={handleCopy} variant="outline" className="ml-2">Copy</Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowApiKeyModal(false)} variant="ghost">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Minimalist Toast Notification */}
      {toast.visible && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
          <div className={`
            flex items-center gap-2 px-4 py-2 rounded-lg border backdrop-blur-sm
            ${toast.type === 'loading' ? 'bg-gray-500/10 border-gray-500/20 text-gray-400' : 
              toast.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
              'bg-red-500/10 border-red-500/20 text-red-400'}
          `}>
            {toast.type === 'loading' && (
              <div className="h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent"></div>
            )}
            {toast.type === 'success' && (
              <div className="h-3 w-3 rounded-full bg-green-400 flex items-center justify-center">
                <div className="h-1.5 w-1.5 rounded-full bg-gray-900"></div>
              </div>
            )}
            {toast.type === 'error' && (
              <div className="h-3 w-3 rounded-full bg-red-400 flex items-center justify-center">
                <div className="h-0.5 w-1.5 rounded-full bg-gray-900"></div>
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

      {/* Large Blurred Ball Effect - Bigger and centered within content area */}
      <div className="fixed bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/4 z-0 ml-32">
        <div className="w-[800px] h-[800px] bg-gradient-to-t from-purple-700/50 to-blue-700/40 rounded-full blur-3xl opacity-60"></div>
      </div>

      {/* Bottom Strip Effect - Curved like bottom half of a circle with space theme */}
      <div className="fixed -bottom-24 -left-16 -right-16 z-0 ml-64 overflow-visible">
        {/* Star Pattern Background */}
        <div 
          className="absolute inset-0 opacity-50"
          style={{
            background: `
              radial-gradient(3px 3px at 20px 30px, #fff, transparent),
              radial-gradient(2px 2px at 40px 70px, rgba(255,255,255,0.9), transparent),
              radial-gradient(2px 2px at 90px 40px, rgba(255,255,255,1), transparent),
              radial-gradient(2px 2px at 130px 80px, #fff, transparent),
              radial-gradient(3px 3px at 160px 30px, rgba(255,255,255,0.8), transparent),
              radial-gradient(2px 2px at 200px 60px, rgba(255,255,255,0.9), transparent),
              radial-gradient(3px 3px at 240px 20px, #fff, transparent),
              radial-gradient(2px 2px at 280px 90px, rgba(255,255,255,1), transparent),
              radial-gradient(3px 3px at 320px 50px, rgba(255,255,255,0.7), transparent),
              radial-gradient(2px 2px at 360px 10px, #fff, transparent),
              radial-gradient(1px 1px at 80px 15px, rgba(255,255,255,0.8), transparent),
              radial-gradient(1px 1px at 180px 45px, rgba(255,255,255,0.9), transparent),
              radial-gradient(1px 1px at 300px 75px, rgba(255,255,255,0.7), transparent)
            `,
            backgroundSize: '400px 100px',
            backgroundRepeat: 'repeat'
          }}
        ></div>

        <div className="relative w-full h-72">
          {/* Main curved strip - creates the "U" shape - more blue and much more blurred */}
          <div 
            className="absolute bottom-0 -left-32 -right-32 bg-gradient-to-r from-blue-800/35 via-blue-900/50 to-blue-800/35 opacity-70"
            style={{
              height: '320px',
              borderRadius: '50%',
              transform: 'scaleY(0.8)',
              transformOrigin: 'bottom',
              filter: 'blur(32px)' // Much more blur (was 19.2px)
            }}
          ></div>
          {/* Additional layer for smoother curve - more blue and more blurred */}
          <div 
            className="absolute bottom-0 -left-24 -right-24 bg-gradient-to-r from-blue-700/25 via-blue-800/35 to-blue-700/25 opacity-50"
            style={{
              height: '280px',
              borderRadius: '50%',
              transform: 'scaleY(0.7)',
              transformOrigin: 'bottom',
              filter: 'blur(16px)' // More blur (was 9.6px)
            }}
          ></div>
          {/* Extra wide base layer - more blue and much more blurred */}
          <div 
            className="absolute bottom-0 -left-48 -right-48 bg-gradient-to-r from-blue-900/20 via-blue-800/30 to-blue-900/20 opacity-40"
            style={{
              height: '400px',
              borderRadius: '50%',
              transform: 'scaleY(0.9)',
              transformOrigin: 'bottom',
              filter: 'blur(40px)' // Much more blur (was 28.8px)
            }}
          ></div>
          {/* Additional side emphasis layers - more blue and more blurred */}
          <div 
            className="absolute bottom-0 -left-64 -right-64 bg-gradient-to-r from-blue-800/25 via-transparent to-blue-800/25 opacity-35"
            style={{
              height: '360px',
              borderRadius: '50%',
              transform: 'scaleY(0.85)',
              transformOrigin: 'bottom',
              filter: 'blur(32px)' // More blur (was 19.2px)
            }}
          ></div>
        </div>
      </div>
    </SidebarLayout>
  );
}