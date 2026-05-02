import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export function OAuthCallbackPage() {
  useEffect(() => {
    // Wait for Supabase to process OAuth tokens, then restore the saved partner URL.
    // We always redirect to savedUrl if present — the CheckoutPage handles session detection.
    supabase.auth.getSession().then(() => {
      const savedUrl = localStorage.getItem('deserty_oauth_return');
      localStorage.removeItem('deserty_oauth_return');
      window.location.replace(savedUrl ?? '/');
    });
  }, []);

  return (
    <div className="flex items-center justify-center h-screen bg-[#121212]">
      <Loader2 size={32} className="animate-spin text-[#3ECF8E]" />
    </div>
  );
}
