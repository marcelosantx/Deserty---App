import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { safeReturnUrl } from '@/lib/safeRedirect';

export function OAuthCallbackPage() {
  useEffect(() => {
    // Wait for Supabase to process OAuth tokens, then restore the saved partner URL.
    // We always redirect to savedUrl if present — the CheckoutPage handles session detection.
    //
    // A URL é gravada em sessionStorage por CheckoutPage.handleGoogle.
    // safeReturnUrl barra destinos fora da nossa origem.
    supabase.auth.getSession().then(() => {
      const savedUrl = sessionStorage.getItem('deserty_oauth_return');
      sessionStorage.removeItem('deserty_oauth_return');
      window.location.replace(safeReturnUrl(savedUrl));
    });
  }, []);

  return (
    <div className="flex items-center justify-center h-screen bg-[#121212]">
      <Loader2 size={32} className="animate-spin text-[#3ECF8E]" />
    </div>
  );
}
