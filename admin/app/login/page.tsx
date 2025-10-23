'use client';


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/src/context/AuthContext"; 
import { useRouter } from 'next/navigation'; 
import Link from 'next/link';
import React, { useState, useEffect } from 'react';
import { authApi } from "@/src/utils/apiClient";
import { Wallet } from "lucide-react";


export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  // // Debug logs for authentication state
  // console.log('[LoginPage] isAuthenticated:', isAuthenticated, 'isLoading:', isLoading);

  useEffect(() => {
    // If auth has finished loading and the user IS authenticated...
    if (!isLoading && isAuthenticated) {
      // ...redirect them away from the login page.
      router.push('/overview');
    }
  }, [isAuthenticated, isLoading, router]);

const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null); 

    try {
      const data = await authApi.login(email, password);
      
      // After successful login, fetch user data
      const userData = await authApi.getCurrentUser();
      
      // Pass both tokens and user data to the login function
      await login({ 
        token: data.access_token,
        refreshToken: data.refresh_token,
        user: userData
      });
      
      // NOW it's safe to redirect
      router.push('/overview'); 

    } catch (error: any) {
      // ... your error handling
      let errorMessage = 'Login failed. Please check your credentials.';
      if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail;
      }
      setError(errorMessage);
      console.error('Login request error:', error);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Wallet className="h-8 w-8" />
            <span className="text-2xl font-bold">Importer</span>
          </div>
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="text-muted-foreground mt-2">Sign in to your account</p>
        </div>

        <div className="bg-background/50 backdrop-blur border border-border rounded-lg p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-md text-sm">
                {error}
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="bg-background/50 border-border"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="bg-background/50 border-border"
              />
            </div>
            
            <Button type="submit" className="w-full mt-6">
              Sign In
            </Button>
          </form>
          
          <div className="mt-6 pt-4 border-t border-border text-center">
            <p className="text-sm text-muted-foreground">
              Don't have an account?{' '}
              <Link href="/signup" className="text-blue-400 hover:text-blue-300 font-medium">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
} 