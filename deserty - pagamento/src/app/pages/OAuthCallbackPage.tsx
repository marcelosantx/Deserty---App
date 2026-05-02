import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export function OAuthCallbackPage() {
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const savedUrl = localStorage.getItem('deserty_oauth_return');
      if (savedUrl) {
        localStorage.removeItem('deserty_oauth_return');
        window.location.replace(session?.user ? savedUrl : '/');
      } else {
        window.location.replace('/');
      }
    });
  }, []);

  return (
    <div className="flex items-center justify-center h-screen bg-[#121212]">
      <Loader2 size={32} className="animate-spin text-[#3ECF8E]" />
    </div>
  );
}
