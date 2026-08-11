import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ArrowLeft, Check, CheckCircle2, Copy, CreditCard,
  Edit2, Search, Smartphone, Users, X, AlertCircle,
  Award, ChevronRight, Info, Mail, Loader2,
  FileText, Zap, ExternalLink,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

// ─── Figma assets (event banner fallback) ────────────────────────────────────
import imgBanner    from 'figma:asset/e105b5e610ed3a80a379fd20d3b62ba8ac6e74be.png';
import imgSynergy   from 'figma:asset/c1bbbe3578f99a2cce1355514a603fdcb1c8dc52.png';

// ─── Types ────────────────────────────────────────────────────────────────────
type CheckoutStep =
  | 'auth' | 'categories' | 'uniform' | 'partners'
  | 'review' | 'partner-review' | 'billing' | 'payment-method' | 'payment-details' | 'success';

interface TournamentMeta {
  id: string;
  name: string;
  coverUrl: string | null;
  location: string | null;
  dateLabel: string;
  registrationFee: number;
  discountPercent: number;
  discountMinCategories: number;
  includeUniform: boolean;
}

interface Category {
  id: string;
  name: string;
  gender: string;           // modality from DB
  pricePerAthlete: number;  // BRL
  spotsLeft: number;
  total: number;
}

interface Partner {
  id: string;
  nickname: string;
  name: string;
  avatar?: string;
  isPrecadastro?: boolean;
  precadastroEmail?: string;
  precadastroCpf?: string;
  precadastroPhone?: string;
}

interface CheckoutData {
  user: { id: string; name: string; email: string } | null;
  selectedCategories: Category[];
  partners: Record<string, Partner | null>;
  billing: { name: string; cpf: string; email: string; whatsapp: string };
  couponCode: string;
  couponStatus: 'idle' | 'loading' | 'valid' | 'invalid';
  couponDiscount: number;
  payOptions: Record<string, 'full' | 'mine'>;
  paymentMethod: BillingType | null;
  uniformSizes: { payer: string | null; partner: string | null };
}

interface PartnerRegData {
  registrationId: string;
  tournamentName: string;
  tournamentDate: string;
  tournamentLocation: string | null;
  categoryName: string;
  uniformSize: string | null;
  priceInBRL: number;
  payerName: string;
}

type BillingType = 'PIX' | 'BOLETO' | 'CREDIT_CARD';

interface AsaasPaymentResult {
  payment_id: string;
  invoice_url: string;
  billing_type: BillingType;
  pix_code?: string;
  pix_qr_base64?: string;
  pix_expiration?: string;
  boleto_url?: string;
  boleto_identification_field?: string;
  boleto_due_date?: string;
  registration_ids: string[];
  payer_total_brl: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STEP_ORDER: CheckoutStep[] = [
  'auth', 'categories', 'partners', 'uniform', 'review', 'billing',
  'payment-method', 'payment-details', 'success',
];
const PARTNER_STEP_ORDER: CheckoutStep[] = [
  'auth', 'partner-review', 'billing', 'payment-method', 'payment-details', 'success',
];
const VISIBLE_STEPS: CheckoutStep[] = [
  'auth', 'categories', 'partners', 'uniform', 'review', 'billing', 'payment-method',
];
const PARTNER_VISIBLE_STEPS: CheckoutStep[] = [
  'auth', 'partner-review', 'billing', 'payment-method',
];
const STEP_LABELS: Partial<Record<CheckoutStep, string>> = {
  auth: 'Acesso', categories: 'Categorias', partners: 'Dupla', uniform: 'Uniforme',
  review: 'Revisão', 'partner-review': 'Revisão', billing: 'Faturamento', 'payment-method': 'Pagamento',
};
const UNIFORM_SIZES = ['PP', 'P', 'M', 'G', 'GG', 'XGG'];
const INITIAL_DATA: CheckoutData = {
  user: null, selectedCategories: [], partners: {},
  billing: { name: '', cpf: '', email: '', whatsapp: '' },
  couponCode: '', couponStatus: 'idle', couponDiscount: 0,
  payOptions: {}, paymentMethod: null, uniformSizes: { payer: null, partner: null },
};
const SERVICE_FEE_RATE = 0.03;

// ─── Pricing ──────────────────────────────────────────────────────────────────
const myAthletePrice = (catIdx: number, price: number, discountRate: number) =>
  catIdx === 0 ? price : price * (1 - discountRate);

const partnerAthletePrice = (price: number) => price;

interface PricingLine {
  cat: Category; idx: number;
  myPrice: number; partnerPrice: number;
  hasPartner: boolean; isDiscounted: boolean;
  payOption: 'full' | 'mine';
  userPays: number; partnerOwes: number;
}
interface PricingResult {
  lines: PricingLine[];
  userBaseTotal: number; couponAmt: number;
  afterCoupon: number; serviceFee: number; total: number;
  partnerTotalOwed: number;
}

const computePricing = (data: CheckoutData, discountRate: number): PricingResult => {
  const lines: PricingLine[] = data.selectedCategories.map((cat, idx) => {
    const myPrice      = myAthletePrice(idx, cat.pricePerAthlete, discountRate);
    const partnerPrice = partnerAthletePrice(cat.pricePerAthlete);
    const hasPartner   = data.partners[cat.id] != null;
    const payOption    = data.payOptions[cat.id] ?? 'full';
    const userPays     = payOption === 'full' && hasPartner ? myPrice + partnerPrice : myPrice;
    const partnerOwes  = payOption === 'mine' && hasPartner ? partnerPrice : 0;
    return { cat, idx, myPrice, partnerPrice, hasPartner, isDiscounted: idx > 0, payOption, userPays, partnerOwes };
  });
  const userBaseTotal    = lines.reduce((s, l) => s + l.userPays, 0);
  const couponAmt        = data.couponStatus === 'valid' ? userBaseTotal * data.couponDiscount : 0;
  const afterCoupon      = userBaseTotal - couponAmt;
  const serviceFee       = afterCoupon * SERVICE_FEE_RATE;
  const total            = afterCoupon + serviceFee;
  const partnerTotalOwed = lines.reduce((s, l) => s + l.partnerOwes, 0);
  return { lines, userBaseTotal, couponAmt, afterCoupon, serviceFee, total, partnerTotalOwed };
};

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt    = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCPF = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9,11)}`;
};
const fmtPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
};

// ─── Validators ───────────────────────────────────────────────────────────────
const validateCPF = (cpf: string): boolean => {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +d[i] * (10 - i);
  let r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== +d[9]) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += +d[i] * (11 - i);
  r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === +d[10];
};

const validateEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

// Garante que returnUrl é do mesmo origin que VITE_APP_URL — evita open redirect
const safeReturnUrl = (url: string): string => {
  const appUrl = (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  try {
    const parsed = new URL(url);
    const allowed = new URL(appUrl || window.location.origin);
    if (parsed.origin === allowed.origin) return url;
  } catch { /* URL relativa ou inválida */ }
  return appUrl || '/';
};

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Btn({ onClick, disabled, variant='primary', type='button', className='', children, fullWidth }: {
  onClick?: ()=>void; disabled?: boolean; variant?: 'primary'|'secondary'|'ghost';
  type?: 'button'|'submit'; className?: string; children: React.ReactNode; fullWidth?: boolean;
}) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-[100px] px-6 h-[48px] transition-all text-[14px] font-semibold whitespace-nowrap';
  const vs = {
    primary:   'bg-[#3ECF8E] text-[#121212] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed',
    secondary: 'bg-[#2f2f2f] text-white hover:bg-[#3a3a3a] disabled:opacity-40',
    ghost:     'text-[#8e8e8e] hover:text-white h-auto px-2',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${base} ${vs[variant]} ${fullWidth?'w-full':''} ${className}`}>
      {children}
    </button>
  );
}

function Field({ label, value, onChange, placeholder, type='text', error, suffix, disabled, autoFocus }: {
  label?: string; value: string; onChange: (v:string)=>void; placeholder?: string;
  type?: string; error?: string; suffix?: React.ReactNode; disabled?: boolean; autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && <label className="text-[13px] text-[#8e8e8e]">{label}</label>}
      <div className={`flex items-center gap-2 bg-[#1c1c1c] border rounded-[8px] px-3 h-[48px] transition-colors
        ${error?'border-[#e5534b]':'border-[#3c3c3c] focus-within:border-[#3ECF8E]'} ${disabled?'opacity-50':''}`}>
        <input type={type} value={value} onChange={e=>onChange(e.target.value)}
          placeholder={placeholder} disabled={disabled} autoFocus={autoFocus}
          className="flex-1 bg-transparent text-white text-[14px] outline-none placeholder-[#4a4a4a] min-w-0"/>
        {suffix && <div className="shrink-0">{suffix}</div>}
      </div>
      {error && (
        <p className="text-[12px] text-[#e5534b] flex items-center gap-1">
          <AlertCircle size={12}/>{error}
        </p>
      )}
    </div>
  );
}

function Card({ children, className='' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#1c1c1c] border border-[#2a2a2a] rounded-[16px] p-6 ${className}`}>
      {children}
    </div>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-white text-[22px] font-semibold leading-tight mb-1">{title}</h2>
      {subtitle && <p className="text-[#8e8e8e] text-[14px]">{subtitle}</p>}
    </div>
  );
}

function Nav({ onBack, onNext, nextLabel='Continuar', nextDisabled=false, loading=false }: {
  onBack?: ()=>void; onNext?: ()=>void; nextLabel?: string; nextDisabled?: boolean; loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mt-5">
      {onBack ? <Btn variant="ghost" onClick={onBack}><ArrowLeft size={16}/>Voltar</Btn> : <div/>}
      {onNext && (
        <Btn onClick={onNext} disabled={nextDisabled || loading}>
          {loading ? <Loader2 size={16} className="animate-spin"/> : <>{nextLabel}<ChevronRight size={16}/></>}
        </Btn>
      )}
    </div>
  );
}

function InfoBox({ children, color='blue', className='' }: { children: React.ReactNode; color?: 'blue'|'green'|'amber'; className?: string }) {
  const c = {
    blue:  'bg-blue-500/10 border-blue-500/20 text-blue-300',
    green: 'bg-[#3ECF8E]/10 border-[#3ECF8E]/20 text-[#3ECF8E]',
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
  };
  return (
    <div className={`flex gap-2.5 p-3 rounded-[10px] border text-[12px] leading-relaxed ${c[color]} ${className}`}>
      <Info size={14} className="shrink-0 mt-0.5"/>
      <div>{children}</div>
    </div>
  );
}

// ─── Event Banner ─────────────────────────────────────────────────────────────
function EventBanner({ tournament }: { tournament: TournamentMeta | null }) {
  const coverSrc = tournament?.coverUrl ?? imgBanner;
  return (
    <div className="w-full px-4 pt-3 pb-0">
      <div className="relative overflow-hidden mx-auto" style={{ width:'100%', maxWidth:1092, height:280, borderRadius:12 }}>
        <img src={coverSrc} alt={tournament?.name ?? 'Evento'} className="absolute inset-0 w-full h-full object-cover object-center"/>
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black/70 to-transparent"/>
        <div className="absolute bottom-4 left-0 right-0 px-5 flex items-end justify-between">
          <div>
            <p className="text-white font-semibold text-[16px] leading-tight drop-shadow">
              {tournament?.name ?? '…'}
            </p>
            {tournament?.location && (
              <p className="text-white/60 text-[12px] drop-shadow">{tournament.location}</p>
            )}
          </div>
          <span className="text-[10px] font-semibold text-[#3ECF8E] bg-[#3ECF8E]/15 border border-[#3ECF8E]/30 px-2 py-0.5 rounded-full">
            Inscrições abertas
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Step Indicator ───────────────────────────────────────────────────────────
function StepIndicator({ current, includeUniform, isPartner }: { current: CheckoutStep; includeUniform?: boolean; isPartner?: boolean }) {
  const baseVisible = isPartner ? PARTNER_VISIBLE_STEPS : VISIBLE_STEPS;
  const visibleSteps = baseVisible.filter(s => s !== 'uniform' || includeUniform);
  const ci = visibleSteps.indexOf(
    current === 'payment-details' ? 'payment-method' : current,
  );
  return (
    <div className="flex items-center justify-center gap-1 py-4 max-w-3xl mx-auto w-full px-4">
      {visibleSteps.map((s, i) => {
        const done = i < ci, active = i === ci;
        return (
          <React.Fragment key={s}>
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all
                ${done   ? 'bg-[#3ECF8E]'
                : active ? 'bg-[#3ECF8E] ring-4 ring-[#3ECF8E]/20'
                         : 'bg-[#232323] border border-[#3c3c3c]'}`}>
                {done
                  ? <Check size={12} className="text-[#121212]"/>
                  : <span className={`text-[10px] font-bold ${active?'text-[#121212]':'text-[#4a4a4a]'}`}>{i+1}</span>}
              </div>
              <span className={`text-[9px] uppercase tracking-wider hidden sm:block
                ${active?'text-white':done?'text-[#3ECF8E]':'text-[#3a3a3a]'}`}>{STEP_LABELS[s]}</span>
            </div>
            {i < visibleSteps.length-1 && (
              <div className={`flex-1 h-px mb-4 transition-all ${i<ci?'bg-[#3ECF8E]':'bg-[#2a2a2a]'}`}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── STEP: Partner Review (read-only) ─────────────────────────────────────────
function PartnerReviewStep({ regData, onNext }: {
  regData: PartnerRegData;
  onNext: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-[#8e8e8e] text-[11px] uppercase tracking-wider mb-1">Sua inscrição</p>
          <h2 className="text-white font-bold text-[18px] leading-tight">{regData.tournamentName}</h2>
          {regData.tournamentDate && (
            <p className="text-[#8e8e8e] text-[13px] mt-1">{regData.tournamentDate}{regData.tournamentLocation ? ` · ${regData.tournamentLocation}` : ''}</p>
          )}
        </div>

        <div className="border border-[#2a2a2a] rounded-[12px] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[#8e8e8e] text-[13px]">Dupla com</span>
            <span className="text-white text-[13px] font-medium">{regData.payerName}</span>
          </div>
          {regData.uniformSize && (
            <div className="flex items-center justify-between">
              <span className="text-[#8e8e8e] text-[13px]">Uniforme (seu tamanho)</span>
              <span className="text-white text-[13px] font-medium">{regData.uniformSize}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-[#2a2a2a] pt-3 mt-1">
            <span className="text-[#8e8e8e] text-[13px]">Valor a pagar</span>
            <span className="text-[#3ECF8E] text-[16px] font-bold">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(regData.priceInBRL)}
            </span>
          </div>
        </div>

        <InfoBox color="green">
          Os dados da inscrição foram definidos pelo seu parceiro de dupla e não podem ser alterados.
        </InfoBox>

        <Btn onClick={onNext} fullWidth>
          Confirmar e continuar
        </Btn>
      </div>
    </Card>
  );
}

// ─── STEP 1: Auth ─────────────────────────────────────────────────────────────
function AuthStep({ onUpdate, onNext, onPartnerLogin, partnerMode }: {
  onUpdate: (u: Partial<CheckoutData>) => void;
  onNext: () => void;
  onPartnerLogin?: (userId: string) => Promise<void>;
  partnerMode?: boolean;
}) {
  const [mode, setMode]         = useState<'login'|'register'>('login');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [confirm, setConfirm]   = useState('');
  const [errs, setErrs]         = useState<Record<string,string>>({});
  const [loading, setLoading]   = useState(false);

  const submit = async () => {
    const e: Record<string,string> = {};
    if (!validateEmail(email))  e.email = 'Email inválido';
    if (password.length < 6)    e.password = 'Mínimo 6 caracteres';
    if (mode === 'register') {
      if (name.trim().length < 2) e.name = 'Nome obrigatório';
      if (password !== confirm)   e.confirm = 'Senhas não conferem';
    }
    if (Object.keys(e).length) { setErrs(e); return; }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const user = data.user;
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, first_name, last_name')
          .eq('id', user.id)
          .maybeSingle();
        const displayName = profile
          ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username
          : email.split('@')[0];
        onUpdate({ user: { id: user.id, name: displayName, email: user.email! } });
        if (onPartnerLogin) {
          setLoading(true);
          try {
            await onPartnerLogin(user.id);
          } catch {
            setErrs({ submit: 'Erro ao carregar inscrição. Tente novamente.' });
          } finally {
            setLoading(false);
          }
        } else {
          onNext();
        }
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        const user = data.user;
        if (user) {
          onUpdate({ user: { id: user.id, name: name.trim(), email: user.email! } });
          onNext();
        }
      }
    } catch (err: any) {
      setErrs({ submit: err.message || 'Erro de autenticação. Tente novamente.' });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    // Save full URL (with partner params) before OAuth — Supabase drops query params on redirect.
    // The dedicated /oauth-callback route restores it after session is established.
    sessionStorage.setItem('deserty_oauth_return', window.location.href);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/' },
    });
  };

  return (
    <Card>
      <StepHeading
        title={mode === 'login' ? 'Bem-vindo(a) de volta!' : 'Criar conta'}
        subtitle={mode === 'login'
          ? 'Entre para continuar sua inscrição'
          : 'Crie sua conta para se inscrever'}
      />
      <div className="flex flex-col gap-4">
        {mode === 'register' && (
          <Field label="Nome completo" value={name}
            onChange={v=>{setName(v);setErrs(e=>({...e,name:''}))}}
            placeholder="Seu nome completo" error={errs.name}/>
        )}
        <Field label="Email" type="email" value={email}
          onChange={v=>{setEmail(v);setErrs(e=>({...e,email:''}))}}
          placeholder="seu@email.com" error={errs.email}/>
        <Field label="Senha" type="password" value={password}
          onChange={v=>{setPassword(v);setErrs(e=>({...e,password:''}))}}
          placeholder="••••••••" error={errs.password}/>
        {mode === 'register' && (
          <Field label="Confirmar senha" type="password" value={confirm}
            onChange={v=>{setConfirm(v);setErrs(e=>({...e,confirm:''}))}}
            placeholder="••••••••" error={errs.confirm}/>
        )}
        {errs.submit && (
          <p className="text-[12px] text-[#e5534b] flex items-center gap-1">
            <AlertCircle size={12}/>{errs.submit}
          </p>
        )}
      </div>
      <div className="mt-6 flex flex-col gap-3">
        <Btn onClick={submit} fullWidth disabled={loading}>
          {loading ? <Loader2 size={16} className="animate-spin"/> : (mode === 'login' ? 'Entrar' : 'Criar conta')}
        </Btn>
        {!partnerMode && (
          <button onClick={handleGoogle}
            className="w-full h-[48px] bg-[#1c1c1c] hover:bg-[#252525] border border-[#333] text-white font-medium rounded-[100px] flex items-center justify-center gap-3 transition-colors text-[14px]">
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Entrar com Google
          </button>
        )}
        {partnerMode && (
          <InfoBox color="amber">
            Use seu email e senha para acessar. Caso só tenha conta Google, defina uma senha em deserty.com.br/conta.
          </InfoBox>
        )}
      </div>
      <div className="mt-4 text-center">
        <span className="text-[14px] text-[#8e8e8e]">{mode==='login'?'Não tem conta? ':'Já tem conta? '}</span>
        <button onClick={()=>{setMode(m=>m==='login'?'register':'login');setErrs({})}}
          className="text-[14px] text-[#3ECF8E] hover:underline">
          {mode==='login'?'Criar conta':'Entrar'}
        </button>
      </div>
    </Card>
  );
}

// ─── STEP 2: Categories ───────────────────────────────────────────────────────
function CategoryStep({ data, onUpdate, onNext, onBack, categories, discountRate }: {
  data: CheckoutData; onUpdate: (u: Partial<CheckoutData>) => void;
  onNext: () => void; onBack: () => void;
  categories: Category[]; discountRate: number;
}) {
  const toggle = (cat: Category) => {
    const exists = data.selectedCategories.find(c => c.id === cat.id);
    onUpdate({
      selectedCategories: exists
        ? data.selectedCategories.filter(c => c.id !== cat.id)
        : [...data.selectedCategories, cat],
    });
  };

  const selectedCount = data.selectedCategories.length;
  const myPreview = data.selectedCategories.reduce(
    (s, cat, idx) => s + myAthletePrice(idx, cat.pricePerAthlete, discountRate), 0,
  );
  const discountPct = Math.round(discountRate * 100);

  return (
    <>
      <Card>
        <StepHeading title="Escolha sua(s) categoria(s)"
          subtitle="Selecione uma ou mais categorias para se inscrever"/>

        {discountPct > 0 && (
          <div className="mb-4">
            <InfoBox color="blue">
              <span className="font-medium text-white">Desconto multi-categoria (para você):</span>
              {' '}a 2ª+ categoria tem <span className="font-semibold text-white">{discountPct}% de desconto</span> no
              valor do seu ingresso. Sua dupla paga o valor integral de cada categoria.
            </InfoBox>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {categories.map(cat => {
            const sel      = !!data.selectedCategories.find(c => c.id === cat.id);
            const sold     = cat.spotsLeft === 0 && cat.total > 0;
            const wouldIdx = sel
              ? data.selectedCategories.findIndex(c => c.id === cat.id)
              : selectedCount;
            const previewPrice = myAthletePrice(wouldIdx, cat.pricePerAthlete, discountRate);
            const isDisc = wouldIdx > 0 && discountPct > 0;

            return (
              <button key={cat.id} onClick={() => !sold && toggle(cat)} disabled={sold}
                className={`relative text-left p-4 rounded-[12px] border transition-all
                  ${sold ? 'opacity-40 cursor-not-allowed border-[#2a2a2a] bg-[#191919]'
                    : sel ? 'border-[#3ECF8E] bg-[#3ECF8E]/10 ring-1 ring-[#3ECF8E]/20'
                          : 'border-[#2a2a2a] bg-[#171717] hover:border-[#4a4a4a]'}`}>
                {sel && !sold && (
                  <div className="absolute top-3 right-3 w-5 h-5 bg-[#3ECF8E] rounded-full flex items-center justify-center">
                    <Check size={11} className="text-[#121212]"/>
                  </div>
                )}
                {sold && (
                  <span className="absolute top-3 right-3 text-[10px] bg-[#2f2f2f] text-[#8e8e8e] px-2 py-0.5 rounded-full">
                    Esgotado
                  </span>
                )}
                <p className="text-white font-semibold text-[15px]">{cat.name}</p>
                <p className="text-[#8e8e8e] text-[12px] mt-0.5">{cat.gender}</p>
                <div className="mt-3 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[#4a4a4a] w-14 shrink-0">Você:</span>
                    {isDisc ? (
                      <>
                        <span className="text-[11px] text-[#4a4a4a] line-through">{fmt(cat.pricePerAthlete)}</span>
                        <span className="text-[#3ECF8E] font-semibold text-[13px]">{fmt(previewPrice)}</span>
                        <span className="text-[10px] bg-[#3ECF8E]/20 text-[#3ECF8E] px-1 py-0.5 rounded-full font-semibold">−{discountPct}%</span>
                      </>
                    ) : (
                      <span className="text-[#3ECF8E] font-semibold text-[13px]">{fmt(cat.pricePerAthlete)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[#4a4a4a] w-14 shrink-0">Dupla:</span>
                    <span className="text-[#8e8e8e] text-[12px]">{fmt(cat.pricePerAthlete)}</span>
                  </div>
                </div>
                {!sold && cat.total > 0 && cat.spotsLeft < 999 && (
                  <p className="text-[10px] text-[#3a3a3a] mt-2">{cat.spotsLeft}/{cat.total} vagas</p>
                )}
              </button>
            );
          })}
        </div>

        {selectedCount > 0 && (
          <div className="mt-4 px-4 py-3 bg-[#171717] rounded-[10px] border border-[#2a2a2a] flex items-center justify-between">
            <div>
              <p className="text-[#8e8e8e] text-[13px]">{selectedCount} categoria(s) · sua parte estimada</p>
              {selectedCount > 1 && discountPct > 0 && (
                <p className="text-[11px] text-[#3ECF8E] mt-0.5">
                  Desconto de {discountPct}% aplicado na {selectedCount > 2 ? `2ª–${selectedCount}ª` : '2ª'} categoria
                </p>
              )}
            </div>
            <span className="text-[#3ECF8E] font-semibold text-[17px]">{fmt(myPreview)}</span>
          </div>
        )}
      </Card>
      <Nav onBack={onBack} onNext={onNext} nextDisabled={selectedCount === 0}/>
    </>
  );
}

// ─── STEP 3: Uniform ──────────────────────────────────────────────────────────
function UniformStep({ data, onUpdate, onNext, onBack }: {
  data: CheckoutData; onUpdate: (u: Partial<CheckoutData>) => void;
  onNext: () => void; onBack: () => void;
}) {
  // Detect if any category has a partner with split payment
  const partnerEntry = Object.entries(data.partners).find(([catId, p]) =>
    p != null && (data.payOptions[catId] === 'mine' || data.payOptions[catId] == null)
  );
  const partner = partnerEntry?.[1] ?? null;

  const payerDone   = !!data.uniformSizes.payer;
  const partnerDone = !partner || !!data.uniformSizes.partner;
  const canProceed  = payerDone && partnerDone;

  const SizeGrid = ({
    selected, onSelect,
  }: { selected: string | null; onSelect: (s: string) => void }) => (
    <div className="grid grid-cols-3 gap-3">
      {UNIFORM_SIZES.map(size => {
        const sel = selected === size;
        return (
          <button key={size} onClick={() => onSelect(size)}
            className={`h-14 rounded-[12px] border font-semibold text-[15px] transition-all
              ${sel
                ? 'border-[#3ECF8E] bg-[#3ECF8E]/10 text-[#3ECF8E] ring-1 ring-[#3ECF8E]/20'
                : 'border-[#2a2a2a] bg-[#171717] text-[#8e8e8e] hover:border-[#4a4a4a] hover:text-white'}`}>
            {size}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <Card>
        <StepHeading title="Tamanhos do uniforme" subtitle="Cada atleta escolhe o seu tamanho"/>

        {/* Payer */}
        <div className="mb-6">
          <p className="text-[13px] text-[#8e8e8e] mb-3 font-medium">
            Seu tamanho
          </p>
          <SizeGrid
            selected={data.uniformSizes.payer}
            onSelect={s => onUpdate({ uniformSizes: { ...data.uniformSizes, payer: s } })}
          />
        </div>

        {/* Partner (only if split-payment duo) */}
        {partner && (
          <div className="border-t border-[#2a2a2a] pt-6">
            <p className="text-[13px] text-[#8e8e8e] mb-3 font-medium">
              Tamanho de <span className="text-white">{partner.name}</span>
            </p>
            <SizeGrid
              selected={data.uniformSizes.partner}
              onSelect={s => onUpdate({ uniformSizes: { ...data.uniformSizes, partner: s } })}
            />
          </div>
        )}

        <InfoBox color="green" className="mt-5">
          O uniforme será entregue presencialmente no dia do evento.
        </InfoBox>
      </Card>
      <div className="flex items-center justify-between mt-5">
        <Btn variant="ghost" onClick={onBack}><ArrowLeft size={16}/>Voltar</Btn>
        <Btn onClick={onNext} disabled={!canProceed}>
          Próximo<ChevronRight size={16}/>
        </Btn>
      </div>
    </>
  );
}

// ─── STEP 4: Partners ─────────────────────────────────────────────────────────
function PartnerSearch({ category, catIdx, partner, onSelect, userName, discountRate }: {
  category: Category; catIdx: number; partner: Partner | null;
  onSelect: (p: Partner | null) => void; userName: string; discountRate: number;
}) {
  const [q, setQ]                 = useState('');
  const [results, setResults]     = useState<Partner[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen]           = useState(false);
  const [modal, setModal]         = useState(false);
  const [pre, setPre]             = useState({ name: '', email: '', cpf: '', phone: '' });
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const abortRef      = useRef<AbortController>();
  const wrap          = useRef<HTMLDivElement>(null);

  const myPrice      = myAthletePrice(catIdx, category.pricePerAthlete, discountRate);
  const pPartnerPrice = partnerAthletePrice(category.pricePerAthlete);
  const pairPrice    = myPrice + pPartnerPrice;

  const search = useCallback((val: string) => {
    setQ(val);

    // Cancel pending debounce
    clearTimeout(debounceTimer.current);

    if (!val.trim()) {
      // Cancel in-flight request too
      abortRef.current?.abort();
      setResults([]);
      setSearching(false);
      setOpen(false);
      return;
    }

    setSearching(true);
    setOpen(true);

    debounceTimer.current = setTimeout(() => {
      // Cancel any still-running request before firing a new one
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const term = val.toLowerCase().replace('@', '');

      supabase
        .from('profiles')
        .select('id, username, first_name, last_name, avatar_url')
        .or(`username.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
        .limit(8)
        .abortSignal(controller.signal)
        .then(({ data, error }) => {
          // Ignore results from aborted requests
          if (controller.signal.aborted || error) return;

          const mapped: Partner[] = (data ?? []).map((p: any) => ({
            id: p.id,
            nickname: p.username ?? p.id.slice(0, 8),
            name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || 'Atleta',
            avatar: p.avatar_url ?? undefined,
          }));
          setResults(mapped);
          setSearching(false);
        });
    }, 350);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    clearTimeout(debounceTimer.current);
    abortRef.current?.abort();
  }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => {
    if (!partner) { setQ(''); setResults([]); setOpen(false); }
  }, [partner?.id]);

  const submitPre = () => {
    if (!pre.name.trim() || !validateEmail(pre.email) || !validateCPF(pre.cpf)) return;
    onSelect({
      id: `pre-${crypto.randomUUID()}`,
      nickname: pre.name.toLowerCase().replace(/\s+/g,'_'),
      name: pre.name.trim(),
      isPrecadastro: true,
      precadastroEmail: pre.email,
      precadastroCpf:   pre.cpf,
      precadastroPhone: pre.phone,
    });
    setModal(false);
    setPre({ name:'', email:'', cpf:'', phone:'' });
  };
  const preCanSubmit = pre.name.trim().length >= 2 && validateEmail(pre.email) && validateCPF(pre.cpf);

  return (
    <div className="border border-[#2a2a2a] rounded-[12px] p-4 bg-[#171717]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-white font-semibold">{category.name}</p>
          <p className="text-[#8e8e8e] text-[12px]">{category.gender}</p>
        </div>
        <div className="text-right">
          {partner ? (
            <>
              <p className="text-[#3ECF8E] font-semibold text-[15px]">{fmt(pairPrice)}</p>
              <p className="text-[10px] text-[#3ECF8E]/70">dupla ({fmt(myPrice)} + {fmt(pPartnerPrice)})</p>
            </>
          ) : (
            <>
              <p className="text-[#8e8e8e] text-[13px]">{fmt(myPrice)} <span className="text-[11px]">você</span></p>
              <p className="text-[10px] text-[#4a4a4a]">+ dupla → {fmt(pairPrice)}</p>
            </>
          )}
        </div>
      </div>

      <div className="border-t border-[#252525] my-3"/>

      {/* Me */}
      <div className="flex items-center gap-3 mb-3">
        <img src={imgSynergy} className="w-8 h-8 rounded-full object-cover shrink-0" alt=""/>
        <div className="flex-1 min-w-0">
          <p className="text-white text-[13px] font-medium">{userName}</p>
          <p className="text-[#4a4a4a] text-[11px]">você</p>
        </div>
        <span className="text-[#3ECF8E] text-[12px] font-medium">{fmt(myPrice)}</span>
      </div>

      {/* Partner row */}
      {partner ? (
        <div className="flex items-center gap-3 bg-[#1c1c1c] rounded-[8px] p-3">
          {partner.avatar
            ? <img src={partner.avatar} className="w-8 h-8 rounded-full object-cover shrink-0" alt={partner.name}/>
            : <div className="w-8 h-8 rounded-full bg-[#3ECF8E]/20 flex items-center justify-center shrink-0">
                <Users size={14} className="text-[#3ECF8E]"/>
              </div>}
          <div className="flex-1 min-w-0">
            <p className="text-white text-[13px] font-medium truncate">{partner.name}</p>
            <p className="text-[#8e8e8e] text-[11px]">
              @{partner.nickname}{partner.isPrecadastro ? ' · pré-cadastro' : ''}
            </p>
          </div>
          <span className="text-[#8e8e8e] text-[12px] font-medium mr-2">{fmt(pPartnerPrice)}</span>
          <button onClick={() => onSelect(null)} className="text-[#4a4a4a] hover:text-white transition-colors">
            <X size={15}/>
          </button>
        </div>
      ) : (
        <div ref={wrap} className="relative">
          <div className={`flex items-center gap-2 bg-[#1c1c1c] border rounded-[8px] px-3 h-[44px] transition-colors ${open?'border-[#3ECF8E]':'border-[#3c3c3c]'}`}>
            <Search size={14} className="text-[#4a4a4a] shrink-0"/>
            <input value={q} onChange={e=>search(e.target.value)} onFocus={()=>q&&setOpen(true)}
              placeholder="@nickname da dupla"
              className="flex-1 bg-transparent text-white text-[14px] outline-none placeholder-[#3a3a3a] min-w-0"/>
            {searching && <div className="w-4 h-4 border-2 border-[#3ECF8E] border-t-transparent rounded-full animate-spin shrink-0"/>}
          </div>
          {open && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[#252525] border border-[#3c3c3c] rounded-[10px] overflow-hidden z-50 shadow-2xl">
              {results.length > 0
                ? results.map(u => (
                  <button key={u.id} onClick={() => { onSelect(u); setOpen(false); setQ(''); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#333] transition-colors text-left">
                    {u.avatar
                      ? <img src={u.avatar} className="w-8 h-8 rounded-full object-cover shrink-0" alt={u.name}/>
                      : <div className="w-8 h-8 rounded-full bg-[#3ECF8E]/20 flex items-center justify-center shrink-0">
                          <Users size={12} className="text-[#3ECF8E]"/>
                        </div>}
                    <div>
                      <p className="text-white text-[13px]">{u.name}</p>
                      <p className="text-[#8e8e8e] text-[11px]">@{u.nickname}</p>
                    </div>
                  </button>
                ))
                : !searching && q ? (
                  <div className="p-4 text-center">
                    <p className="text-[#8e8e8e] text-[13px] mb-3">
                      Nenhum atleta encontrado com "@{q.replace('@','')}"
                    </p>
                    <button onClick={() => { setOpen(false); setModal(true); }}
                      className="text-[13px] text-[#3ECF8E] hover:underline">
                      + Convidar / Pré-cadastro
                    </button>
                  </div>
                ) : null}
            </div>
          )}
        </div>
      )}

      {/* Pré-cadastro modal */}
      {modal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80">
          <div className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-[16px] p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold">Pré-cadastro da dupla</h3>
              <button onClick={() => setModal(false)} className="text-[#8e8e8e] hover:text-white"><X size={18}/></button>
            </div>
            <p className="text-[#8e8e8e] text-[12px] mb-4 leading-relaxed">
              A dupla não precisa ter conta agora. Preencha os dados para reservar a vaga —
              um convite com link de pagamento será enviado por e-mail.
            </p>
            <div className="flex flex-col gap-3">
              <Field label="Nome completo *" value={pre.name} onChange={v=>setPre(p=>({...p,name:v}))} placeholder="Nome da dupla"/>
              <Field label="E-mail *" type="email" value={pre.email} onChange={v=>setPre(p=>({...p,email:v}))} placeholder="email@dupla.com"/>
              <Field label="CPF *" value={pre.cpf} onChange={v=>setPre(p=>({...p,cpf:fmtCPF(v)}))} placeholder="000.000.000-00"/>
              <Field label="WhatsApp" value={pre.phone} onChange={v=>setPre(p=>({...p,phone:fmtPhone(v)}))} placeholder="(xx) xxxxx-xxxx"/>
            </div>
            <p className="text-[11px] text-[#3a3a3a] mt-2">* campos obrigatórios</p>
            <div className="flex gap-3 mt-4">
              <Btn variant="secondary" onClick={() => setModal(false)} fullWidth>Cancelar</Btn>
              <Btn onClick={submitPre} disabled={!preCanSubmit} fullWidth>Reservar vaga</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PartnerStep({ data, onUpdate, onNext, onBack, discountRate }: {
  data: CheckoutData; onUpdate: (u: Partial<CheckoutData>) => void;
  onNext: () => void; onBack: () => void; discountRate: number;
}) {
  const allDone = data.selectedCategories.every(c => data.partners[c.id] != null);
  const myTotal = data.selectedCategories.reduce((s,cat,idx) => s + myAthletePrice(idx, cat.pricePerAthlete, discountRate), 0);
  const partnerTotal = data.selectedCategories.reduce((s,cat) =>
    s + (data.partners[cat.id] ? partnerAthletePrice(cat.pricePerAthlete) : 0), 0);

  return (
    <>
      <Card>
        <StepHeading title="Informe sua dupla"
          subtitle="Busque e vincule seu parceiro(a) em cada categoria"/>
        <div className="flex flex-col gap-4">
          {data.selectedCategories.map((cat, idx) => (
            <PartnerSearch key={cat.id} category={cat} catIdx={idx}
              partner={data.partners[cat.id] ?? null}
              onSelect={p => onUpdate({ partners: { ...data.partners, [cat.id]: p } })}
              userName={data.user?.name ?? 'Você'} discountRate={discountRate}/>
          ))}
        </div>
        {allDone && (
          <div className="mt-4 p-3 bg-[#171717] rounded-[10px] border border-[#3ECF8E]/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white text-[13px] font-medium">Total da inscrição (dupla)</p>
                <p className="text-[#8e8e8e] text-[11px]">
                  Sua parte: {fmt(myTotal)} · Duplas: {fmt(partnerTotal)}
                </p>
              </div>
              <span className="text-[#3ECF8E] font-semibold text-[18px]">{fmt(myTotal + partnerTotal)}</span>
            </div>
          </div>
        )}
      </Card>
      <Nav onBack={onBack} onNext={onNext} nextDisabled={!allDone}/>
    </>
  );
}

// ─── STEP 4: Review ───────────────────────────────────────────────────────────
function ReviewStep({ data, onUpdate, onNext, onBack, onGoTo, discountRate }: {
  data: CheckoutData; onUpdate: (u: Partial<CheckoutData>) => void;
  onNext: () => void; onBack: () => void; onGoTo: (s: CheckoutStep) => void; discountRate: number;
}) {
  const pricing = computePricing(data, discountRate);

  return (
    <>
      <Card>
        <StepHeading title="Revise sua inscrição"
          subtitle="Confira os dados antes de prosseguir"/>

        {/* ── Atleta ── */}
        <div className="border border-[#2a2a2a] rounded-[12px] overflow-hidden mb-3">
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#1a1a1a]">
            <span className="text-[11px] text-[#4a4a4a] uppercase tracking-wider font-medium">Atleta</span>
            <button onClick={() => onGoTo('auth')} className="text-[#3ECF8E] text-[12px] flex items-center gap-1 active:opacity-60">
              <Edit2 size={11}/>Editar
            </button>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <img src={imgSynergy} className="w-9 h-9 rounded-full object-cover shrink-0" alt=""/>
            <div className="min-w-0">
              <p className="text-white text-[14px] font-medium truncate">{data.user?.name}</p>
              <p className="text-[#4a4a4a] text-[12px] truncate">{data.user?.email}</p>
            </div>
          </div>
        </div>

        {/* ── Categorias ── */}
        {pricing.lines.map(({ cat, idx, myPrice, isDiscounted }) => {
          const partner   = data.partners[cat.id];
          const pPrice    = partnerAthletePrice(cat.pricePerAthlete);
          const pairTotal = myPrice + (partner ? pPrice : 0);

          return (
            <div key={cat.id} className="border border-[#2a2a2a] rounded-[12px] overflow-hidden mb-3">

              {/* Cabeçalho da categoria */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a1a] border-b border-[#2a2a2a]">
                <span className="text-white text-[13px] font-semibold truncate flex-1 min-w-0">{cat.name}</span>
                <span className="text-[11px] bg-[#252525] text-[#6e6e6e] px-2 py-0.5 rounded-full shrink-0">{cat.gender}</span>
                {isDiscounted && discountRate > 0 && (
                  <span className="text-[10px] bg-[#3ECF8E]/15 text-[#3ECF8E] px-2 py-0.5 rounded-full font-semibold shrink-0">
                    −{Math.round(discountRate*100)}%
                  </span>
                )}
              </div>

              {/* Tabela de jogadores + valores */}
              <div className="divide-y divide-[#1e1e1e]">
                {/* Linha: Você */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <img src={imgSynergy} className="w-7 h-7 rounded-full object-cover shrink-0" alt=""/>
                  <span className="text-[13px] text-white truncate flex-1 min-w-0">{data.user?.name}</span>
                  <span className="text-[#3ECF8E] text-[13px] font-semibold shrink-0">{fmt(myPrice)}</span>
                </div>

                {/* Linha: Parceiro */}
                {partner && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    {partner.avatar
                      ? <img src={partner.avatar} className="w-7 h-7 rounded-full object-cover shrink-0" alt=""/>
                      : <div className="w-7 h-7 rounded-full bg-[#252525] flex items-center justify-center shrink-0"><Users size={10} className="text-[#5a5a5a]"/></div>}
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] text-white truncate block">{partner.name}</span>
                      {partner.nickname && <span className="text-[11px] text-[#4a4a4a]">@{partner.nickname}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] text-[#8e8e8e] font-medium">{fmt(pPrice)}</span>
                      <button onClick={() => onGoTo('partners')} className="text-[#3ECF8E] active:opacity-60"><Edit2 size={12}/></button>
                    </div>
                  </div>
                )}

                {/* Linha: Total */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#151515]">
                  <span className="text-[12px] text-[#5a5a5a]">{partner ? 'Total da dupla' : 'Subtotal'}</span>
                  <span className="text-[#3ECF8E] text-[14px] font-semibold">{fmt(pairTotal)}</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* ── Total geral ── */}
        <div className="flex items-center justify-between px-4 py-4 bg-[#171717] rounded-[12px] border border-[#2a2a2a]">
          <div>
            <p className="text-white text-[14px] font-semibold">Total que você pagará</p>
            {pricing.partnerTotalOwed > 0 && (
              <p className="text-[11px] text-amber-400 mt-0.5">
                + {fmt(pricing.partnerTotalOwed)} cobrado às duplas
              </p>
            )}
          </div>
          <span className="text-[#3ECF8E] font-bold text-[20px]">{fmt(pricing.userBaseTotal)}</span>
        </div>
      </Card>
      <Nav onBack={onBack} onNext={onNext} nextLabel="Confirmar e prosseguir"/>
    </>
  );
}

// ─── STEP 5: Billing ──────────────────────────────────────────────────────────
function BillingStep({ data, onUpdate, onNext, onBack, discountRate }: {
  data: CheckoutData; onUpdate: (u: Partial<CheckoutData>) => void;
  onNext: () => void; onBack: () => void; discountRate: number;
}) {
  const [errs, setErrs] = useState<Record<string,string>>({});
  const pricing = computePricing(data, discountRate);

  useEffect(() => {
    if (data.user) {
      onUpdate({ billing: {
        name:     data.billing.name  || data.user.name,
        email:    data.billing.email || data.user.email,
        cpf:      data.billing.cpf,
        whatsapp: data.billing.whatsapp,
      }});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upB = (k: keyof CheckoutData['billing'], v: string) =>
    onUpdate({ billing: { ...data.billing, [k]: v } });

  const validate = () => {
    const e: Record<string,string> = {};
    if (!data.billing.name.trim())                       e.name  = 'Nome obrigatório';
    if (!validateCPF(data.billing.cpf))                  e.cpf   = 'CPF inválido';
    if (!validateEmail(data.billing.email))              e.email = 'Email inválido';
    setErrs(e);
    return !Object.keys(e).length;
  };

  return (
    <>
      <Card>
        <StepHeading title="Dados de faturamento" subtitle="Confira e complete seus dados"/>
        <div className="flex flex-col gap-4 mb-6">
          <Field label="Nome completo" value={data.billing.name}
            onChange={v=>{upB('name',v);setErrs(e=>({...e,name:''}))}}
            placeholder="Seu nome completo" error={errs.name}/>
          <Field label="CPF" value={data.billing.cpf}
            onChange={v=>{upB('cpf',fmtCPF(v));setErrs(e=>({...e,cpf:''}))}}
            placeholder="000.000.000-00" error={errs.cpf}/>
          <Field label="E-mail para comprovante" type="email" value={data.billing.email}
            onChange={v=>{upB('email',v);setErrs(e=>({...e,email:''}))}}
            placeholder="seu@email.com" error={errs.email}/>
          <Field label="WhatsApp" value={data.billing.whatsapp}
            onChange={v=>upB('whatsapp',fmtPhone(v))}
            placeholder="(11) 99999-0000"/>
        </div>

        {/* Order Summary */}
        <p className="text-[13px] text-[#8e8e8e] mb-2">Resumo do pedido</p>
        <div className="bg-[#171717] rounded-[12px] border border-[#2a2a2a] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#252525]">
                <th className="text-left text-[10px] text-[#4a4a4a] uppercase tracking-wider p-3">Descrição</th>
                <th className="text-right text-[10px] text-[#4a4a4a] uppercase tracking-wider p-3">Valor</th>
              </tr>
            </thead>
            <tbody>
              {pricing.lines.map(({ cat, myPrice, partnerPrice, hasPartner, isDiscounted, payOption, userPays }) => (
                <tr key={cat.id} className="border-b border-[#222]">
                  <td className="p-3 text-white text-[12px]">
                    {cat.name} {cat.gender}
                    {isDiscounted && discountRate > 0 && (
                      <span className="ml-1.5 text-[10px] bg-[#3ECF8E]/20 text-[#3ECF8E] px-1 py-0.5 rounded-full">
                        −{Math.round(discountRate*100)}%
                      </span>
                    )}
                    {payOption === 'mine' && hasPartner && (
                      <span className="ml-1 text-[#4a4a4a] text-[10px]">(sua parte)</span>
                    )}
                    {payOption === 'full' && hasPartner && (
                      <p className="text-[10px] text-[#4a4a4a] mt-0.5">
                        Você {fmt(myPrice)} + Dupla {fmt(partnerPrice)}
                      </p>
                    )}
                  </td>
                  <td className="p-3 text-right text-white text-[12px]">{fmt(userPays)}</td>
                </tr>
              ))}
              <tr>
                <td className="p-3 text-white font-semibold text-[14px]">Total</td>
                <td className="p-3 text-right text-[#3ECF8E] font-semibold text-[17px]">{fmt(pricing.userBaseTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {pricing.partnerTotalOwed > 0 && (
          <div className="mt-3">
            <InfoBox color="amber">
              As duplas com pagamento separado receberão e-mails individuais com suas faturas.
              Total cobrado às duplas:{' '}
              <span className="font-semibold text-white">{fmt(pricing.partnerTotalOwed)}</span>.
            </InfoBox>
          </div>
        )}
      </Card>
      <Nav onBack={onBack} onNext={() => { if (validate()) onNext(); }} nextLabel="Ir para pagamento"/>
    </>
  );
}

// ─── STEP 6: Payment Method ───────────────────────────────────────────────────
function PaymentMethodStep({ data, onUpdate, onBack, discountRate, onPay, paying }: {
  data: CheckoutData; onUpdate: (u: Partial<CheckoutData>) => void;
  onNext: () => void; onBack: () => void; discountRate: number;
  onPay: () => void; paying: boolean;
}) {
  const pricing = computePricing(data, discountRate);
  const methods: { id: BillingType; icon: React.ReactNode; title: string; sub: string }[] = [
    { id: 'PIX',         icon: <Zap size={20}/>,        title: 'Pix',              sub: 'Aprovação instantânea' },
    { id: 'BOLETO',      icon: <FileText size={20}/>,   title: 'Boleto Bancário',  sub: 'Vencimento em 3 dias úteis' },
    { id: 'CREDIT_CARD', icon: <CreditCard size={20}/>, title: 'Cartão de Crédito', sub: 'Visa, Mastercard, Elo e outras' },
  ];

  return (
    <>
      <Card>
        <StepHeading title="Forma de pagamento"
          subtitle={`Total a pagar: ${fmt(pricing.userBaseTotal)}`}/>
        <div className="flex flex-col gap-3">
          {methods.map(m => {
            const sel = data.paymentMethod === m.id;
            return (
              <button key={m.id} onClick={() => onUpdate({ paymentMethod: m.id })}
                className={`w-full text-left p-4 rounded-[12px] border transition-all flex items-center gap-4
                  ${sel ? 'border-[#3ECF8E] bg-[#3ECF8E]/10 ring-1 ring-[#3ECF8E]/20'
                        : 'border-[#2a2a2a] bg-[#171717] hover:border-[#4a4a4a]'}`}>
                <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all
                  ${sel ? 'bg-[#3ECF8E] text-[#121212]' : 'bg-[#252525] text-[#8e8e8e]'}`}>{m.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold">{m.title}</p>
                  <p className="text-[#8e8e8e] text-[12px]">{m.sub}</p>
                </div>
                {sel && <div className="w-5 h-5 bg-[#3ECF8E] rounded-full flex items-center justify-center shrink-0"><Check size={11} className="text-[#121212]"/></div>}
              </button>
            );
          })}
        </div>

        {data.paymentMethod === 'CREDIT_CARD' && (
          <div className="mt-4">
            <InfoBox color="blue">
              Você será redirecionado para o ambiente seguro de pagamento em uma nova aba.
            </InfoBox>
          </div>
        )}
        {data.paymentMethod === 'PIX' && (
          <div className="mt-4">
            <InfoBox color="green">
              O QR Code e código Pix serão exibidos na próxima tela. Aprovação instantânea.
            </InfoBox>
          </div>
        )}
      </Card>
      <div className="flex items-center justify-between mt-5">
        <Btn variant="ghost" onClick={onBack}><ArrowLeft size={16}/>Voltar</Btn>
        <Btn onClick={onPay} disabled={!data.paymentMethod || paying}>
          {paying
            ? <><Loader2 size={16} className="animate-spin"/>Preparando…</>
            : data.paymentMethod === 'PIX' ? <><Zap size={16}/>Gerar QR Code Pix</>
            : data.paymentMethod === 'BOLETO' ? <><FileText size={16}/>Gerar Boleto</>
            : <>Ir para pagamento<ChevronRight size={16}/></>}
        </Btn>
      </div>
    </>
  );
}

// ─── STEP 7: Payment Details — Pix / Boleto inline, Cartão redirect ──────────
function PaymentDetailsStep({
  error,
  paymentResult,
  pollStatus,
  onCopyPix,
  onCopyBoleto,
  pixCopied,
  boletoCopied,
  onBack,
}: {
  error: string | null;
  paymentResult: AsaasPaymentResult | null;
  pollStatus: 'waiting' | 'paid' | 'expired';
  onCopyPix: () => void;
  onCopyBoleto: () => void;
  pixCopied: boolean;
  boletoCopied: boolean;
  onBack: () => void;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <div className="w-16 h-16 bg-[#e5534b]/10 rounded-full flex items-center justify-center">
          <AlertCircle size={32} className="text-[#e5534b]"/>
        </div>
        <div className="text-center">
          <h2 className="text-white text-[20px] font-semibold mb-2">Erro ao processar</h2>
          <p className="text-[#8e8e8e] text-[14px] max-w-sm">{error}</p>
        </div>
        <div className="flex gap-3">
          <Btn variant="secondary" onClick={onBack}><ArrowLeft size={16}/>Voltar</Btn>
          <Btn onClick={() => window.location.reload()}>Tentar novamente</Btn>
        </div>
      </div>
    );
  }

  if (!paymentResult) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 size={36} className="text-[#3ECF8E] animate-spin"/>
        <p className="text-[#8e8e8e] text-[14px]">Gerando pagamento…</p>
      </div>
    );
  }

  const { billing_type } = paymentResult;

  if (pollStatus === 'paid') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-20 h-20 bg-[#3ECF8E]/10 rounded-full flex items-center justify-center">
          <CheckCircle2 size={40} className="text-[#3ECF8E]" strokeWidth={1.5}/>
        </div>
        <h2 className="text-white text-[22px] font-semibold">Pagamento confirmado!</h2>
        <p className="text-[#8e8e8e] text-[14px]">Redirecionando…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-12 w-full">
      <Card>
        {/* PIX */}
        {billing_type === 'PIX' && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap size={18} className="text-[#3ECF8E]"/>
                <h2 className="text-white font-semibold text-[16px]">Pague com Pix</h2>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"/>
                <span className="text-amber-400 text-[12px]">Aguardando…</span>
              </div>
            </div>

            {paymentResult.pix_qr_base64 && (
              <div className="flex justify-center">
                <div className="bg-white p-3 rounded-[16px] w-[200px] h-[200px] flex items-center justify-center">
                  <img
                    src={`data:image/png;base64,${paymentResult.pix_qr_base64}`}
                    alt="QR Code Pix" className="w-full h-full object-contain"
                  />
                </div>
              </div>
            )}

            {paymentResult.pix_code && (
              <div className="bg-[#171717] rounded-[12px] border border-[#2a2a2a] p-4">
                <p className="text-[#8e8e8e] text-[11px] mb-2">Pix Copia e Cola</p>
                <p className="text-[#8e8e8e] text-[11px] font-mono break-all leading-relaxed mb-3">
                  {paymentResult.pix_code.slice(0, 60)}…
                </p>
                <button
                  onClick={onCopyPix}
                  className={`w-full h-[44px] rounded-[10px] flex items-center justify-center gap-2 font-semibold text-[13px] transition-all
                    ${pixCopied ? 'bg-[#3ECF8E] text-[#121212]' : 'bg-[#2a2a2a] text-white hover:bg-[#333]'}`}
                >
                  {pixCopied ? <Check size={16}/> : <Copy size={16}/>}
                  {pixCopied ? 'Copiado!' : 'Copiar código Pix'}
                </button>
              </div>
            )}

            <InfoBox color="green">
              Confirme o pagamento no seu app bancário. Esta tela atualiza automaticamente.
            </InfoBox>
          </div>
        )}

        {/* BOLETO */}
        {billing_type === 'BOLETO' && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-[#3ECF8E]"/>
              <h2 className="text-white font-semibold text-[16px]">Boleto Bancário</h2>
            </div>

            {paymentResult.boleto_due_date && (
              <InfoBox color="amber">
                Vencimento: <strong>{new Date(paymentResult.boleto_due_date + 'T00:00:00').toLocaleDateString('pt-BR')}</strong>
                {' '}· Compensação em até 3 dias úteis após o pagamento.
              </InfoBox>
            )}

            {paymentResult.boleto_identification_field && (
              <div className="bg-[#171717] rounded-[12px] border border-[#2a2a2a] p-4">
                <p className="text-[#8e8e8e] text-[11px] mb-2">Linha digitável</p>
                <p className="text-[#8e8e8e] text-[12px] font-mono break-all leading-relaxed mb-3">
                  {paymentResult.boleto_identification_field}
                </p>
                <button
                  onClick={onCopyBoleto}
                  className={`w-full h-[44px] rounded-[10px] flex items-center justify-center gap-2 font-semibold text-[13px] transition-all
                    ${boletoCopied ? 'bg-[#3ECF8E] text-[#121212]' : 'bg-[#2a2a2a] text-white hover:bg-[#333]'}`}
                >
                  {boletoCopied ? <Check size={16}/> : <Copy size={16}/>}
                  {boletoCopied ? 'Copiado!' : 'Copiar linha digitável'}
                </button>
              </div>
            )}

            {paymentResult.boleto_url && (
              <a
                href={paymentResult.boleto_url} target="_blank" rel="noreferrer"
                className="w-full h-[48px] rounded-[100px] border border-[#3c3c3c] flex items-center justify-center gap-2 text-white/70 hover:text-white hover:border-[#4a4a4a] transition-colors text-[14px] font-medium"
              >
                <ExternalLink size={16}/>Ver / imprimir boleto
              </a>
            )}
          </div>
        )}

        {/* CARTÃO */}
        {billing_type === 'CREDIT_CARD' && (
          <div className="flex flex-col items-center gap-5 py-6 text-center">
            <CreditCard size={40} className="text-[#3ECF8E]" strokeWidth={1.5}/>
            <div>
              <h2 className="text-white font-semibold text-[18px] mb-2">Página de pagamento aberta</h2>
              <p className="text-[#8e8e8e] text-[14px] max-w-sm">
                Conclua o pagamento na nova aba. Sua inscrição será confirmada automaticamente.
              </p>
            </div>
            {paymentResult.invoice_url && (
              <a
                href={paymentResult.invoice_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 px-6 h-[48px] rounded-[100px] bg-[#3ECF8E]/10 border border-[#3ECF8E]/30 text-[#3ECF8E] font-semibold text-[14px] hover:bg-[#3ECF8E]/20 transition-colors"
              >
                <ExternalLink size={16}/>Abrir novamente
              </a>
            )}
          </div>
        )}

        {pollStatus === 'expired' && (
          <div className="mt-4 p-3 bg-[#e5534b]/10 border border-[#e5534b]/20 rounded-[10px]">
            <p className="text-[#e5534b] text-[13px] text-center">O código expirou. Volte e gere um novo pagamento.</p>
          </div>
        )}
      </Card>

      {pollStatus !== 'paid' && (
        <div className="mt-5 flex justify-start">
          <Btn variant="ghost" onClick={onBack}><ArrowLeft size={16}/>Voltar</Btn>
        </div>
      )}
    </div>
  );
}

// ─── STEP 8: Success ──────────────────────────────────────────────────────────
function SuccessStep({ data, returnUrl, tournamentId, discountRate }: {
  data: CheckoutData; returnUrl: string; tournamentId: string; discountRate: number;
}) {
  const pricing = computePricing(data, discountRate);
  const partnerEmails = pricing.lines
    .filter(l => l.payOption === 'mine' && l.hasPartner)
    .map(l => ({ partner: data.partners[l.cat.id]!, cat: l.cat, amount: l.partnerPrice }));

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-md w-full">
        <div className="flex justify-center mb-8">
          <div className="w-28 h-28 bg-[#3ECF8E]/10 rounded-full flex items-center justify-center">
            <div className="w-20 h-20 bg-[#3ECF8E]/20 rounded-full flex items-center justify-center">
              <CheckCircle2 size={44} className="text-[#3ECF8E]" strokeWidth={1.5}/>
            </div>
          </div>
        </div>
        <h1 className="text-white text-[28px] font-semibold mb-3 leading-tight">Inscrição confirmada! 🎉</h1>
        <p className="text-[#8e8e8e] text-[15px] leading-relaxed mb-2">
          Sua inscrição está confirmada e já consta no sistema.
        </p>
        <p className="text-[#4a4a4a] text-[13px] mb-6">
          Comprovante enviado para <span className="text-white">{data.billing.email || data.user?.email}</span>
        </p>

        <div className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-[12px] p-4 text-left mb-4">
          <p className="text-[11px] text-[#4a4a4a] uppercase tracking-wider mb-3">Categorias inscritas</p>
          {data.selectedCategories.map(cat => {
            const partner = data.partners[cat.id];
            return (
              <div key={cat.id} className="flex items-center justify-between py-2.5 border-b border-[#222] last:border-0">
                <div>
                  <p className="text-white text-[14px] font-medium">{cat.name} {cat.gender}</p>
                  {partner && <p className="text-[#8e8e8e] text-[12px]">Dupla: {partner.name}</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-[#3ECF8E]"/>
                  <span className="text-[#3ECF8E] text-[12px]">Inscrito</span>
                </div>
              </div>
            );
          })}
        </div>

        {partnerEmails.length > 0 && (
          <div className="bg-[#1c1c1c] border border-[#2a2a2a] rounded-[12px] p-4 text-left mb-6">
            <p className="text-[11px] text-[#4a4a4a] uppercase tracking-wider mb-3">E-mails enviados às duplas</p>
            {partnerEmails.map(({ partner, cat, amount }, i) => (
              <div key={i} className="flex items-start gap-3 py-2.5 border-b border-[#222] last:border-0">
                <Mail size={14} className="text-amber-400 mt-0.5 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-[13px] font-medium truncate">{partner.name}</p>
                  <p className="text-[#8e8e8e] text-[11px]">
                    {partner.precadastroEmail || `@${partner.nickname}`} · {cat.name} {cat.gender}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-amber-400 font-semibold text-[13px]">{fmt(amount)}</p>
                  <p className="text-[#3a3a3a] text-[10px]">prazo: 3 dias</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <Btn variant="secondary" onClick={() => window.location.href = returnUrl} fullWidth>
            <ArrowLeft size={15}/>Voltar ao evento
          </Btn>
          <Btn onClick={() => {
            const appUrl = (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/$/, '') ?? '';
            window.location.href = tournamentId ? `${appUrl}/tournament/${tournamentId}` : returnUrl;
          }} fullWidth>
            <Award size={15}/>Ver torneio
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Main Checkout Page ───────────────────────────────────────────────────────
export function CheckoutPage() {
  const navigate    = useNavigate();
  const [params]    = useSearchParams();

  // ── URL params ──────────────────────────────────────────────────────────────
  const tournamentId  = params.get('tid') ?? '';
  const returnUrl     = safeReturnUrl(params.get('return') ?? (import.meta.env.VITE_APP_URL as string) ?? '/');
  const isPartnerFlow = params.get('partnerFlow') === '1';
  const partnerRegId  = params.get('regId') ?? '';

  // ── State ──────────────────────────────────────────────────────────────────
  const [step, setStep]           = useState<CheckoutStep>('auth');
  const [partnerRegData, setPartnerRegData] = useState<PartnerRegData | null>(null);
  const partnerDataLoadedRef = useRef(false);
  const [data, setData]           = useState<CheckoutData>(INITIAL_DATA);
  const [tournament, setTournament] = useState<TournamentMeta | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [initError, setInitError]   = useState<string | null>(null);
  const [paying, setPaying]           = useState(false);
  const [payError, setPayError]       = useState<string | null>(null);
  const [paymentResult, setPaymentResult] = useState<AsaasPaymentResult | null>(null);
  const [pollStatus, setPollStatus]   = useState<'waiting' | 'paid' | 'expired'>('waiting');
  const [pixCopied, setPixCopied]     = useState(false);
  const [boletoCopied, setBoletoCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPolling(), []);

  // Atualiza o título da aba do browser conforme torneio e categorias selecionadas
  useEffect(() => {
    if (!tournament) return;
    const cats = data.selectedCategories.map(c => c.name).join(", ");
    document.title = cats
      ? `Deserty — ${tournament.name} · ${cats}`
      : `Deserty — ${tournament.name}`;
    return () => { document.title = "Deserty"; };
  }, [tournament, data.selectedCategories]);

  const discountRate = (tournament?.discountPercent ?? 0) / 100;

  const update = (u: Partial<CheckoutData>) => setData(p => ({ ...p, ...u }));

  // ── Partner flow: detect Google OAuth sign-in via onAuthStateChange ──────────
  // initCheckout relies on getSession() timing which can miss the PKCE exchange.
  // onAuthStateChange('SIGNED_IN') fires reliably once the session is established.
  useEffect(() => {
    if (!isPartnerFlow || !partnerRegId) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user && !partnerDataLoadedRef.current) {
        partnerDataLoadedRef.current = true;
        await loadPartnerRegData(partnerRegId, session.user.id);
      }
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── On mount: inicializa checkout (sem callback Stripe) ──────────────────
  useEffect(() => {
    initCheckout();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPartnerRegData = async (regId: string, userId: string) => {
    try {
      const { data: reg } = await supabase
        .from('registrations')
        .select('id, tournament_id, uniform_size, duo_id, payment_status')
        .eq('id', regId)
        .eq('player_id', userId)
        .maybeSingle();

      if (!reg) {
        setInitError('Inscrição não encontrada. Verifique se está logado com a conta correta.');
        setLoadingInit(false);
        return;
      }

      if (reg.payment_status === 'paid') {
        setInitError('Esta inscrição já foi paga.');
        setLoadingInit(false);
        return;
      }

      const [{ data: tournament }, { data: payerReg }] = await Promise.all([
        supabase.from('tournaments')
          .select('id, title, registration_fee, location, start_date')
          .eq('id', reg.tournament_id)
          .maybeSingle(),
        reg.duo_id
          ? supabase.from('registrations')
              .select('profiles(first_name, last_name, username)')
              .eq('duo_id', reg.duo_id)
              .eq('duo_position', 1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (!tournament) {
        setInitError('Torneio não encontrado.');
        setLoadingInit(false);
        return;
      }

      const payerProfile = (payerReg as any)?.profiles;
      const payerName = payerProfile
        ? [payerProfile.first_name, payerProfile.last_name].filter(Boolean).join(' ') || payerProfile.username
        : 'Atleta 1';

      setPartnerRegData({
        registrationId: reg.id,
        tournamentName: tournament.title,
        tournamentDate: tournament.start_date
          ? new Date(tournament.start_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
          : '',
        tournamentLocation: tournament.location ?? null,
        categoryName: tournament.title,
        uniformSize: reg.uniform_size ?? null,
        priceInBRL: tournament.registration_fee ?? 60,
        payerName,
      });

      setTournament({
        id: tournament.id,
        name: tournament.title,
        coverUrl: null,
        location: tournament.location ?? null,
        dateLabel: tournament.start_date
          ? new Date(tournament.start_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
          : '',
        registrationFee: tournament.registration_fee ?? 60,
        discountPercent: 0,
        discountMinCategories: 2,
        includeUniform: false,
      });

      const cat: Category = {
        id: tournament.id,
        name: tournament.title,
        gender: '',
        pricePerAthlete: tournament.registration_fee ?? 60,
        spotsLeft: 999,
        total: 999,
      };
      setCategories([cat]);
      update({ selectedCategories: [cat] });

      setStep('partner-review');
    } catch (err: any) {
      setInitError(err.message ?? 'Erro ao carregar inscrição.');
    } finally {
      setLoadingInit(false);
    }
  };

  const initCheckout = async () => {
    if (!tournamentId) {
      // Supabase OAuth (implicit flow) drops query params and redirects to the root URL.
      // The SDK processes the hash tokens synchronously on load, so session is available here.
      // Restore the original partner URL from localStorage if present.
      const savedUrl = sessionStorage.getItem('deserty_oauth_return');
      if (savedUrl) {
        const { data: { session: s } } = await supabase.auth.getSession();
        if (s?.user) {
          sessionStorage.removeItem('deserty_oauth_return');
          window.location.replace(savedUrl);
          return;
        }
      }
      setInitError('Torneio não identificado. Volte ao evento e tente novamente.');
      setLoadingInit(false);
      return;
    }

    try {
      // ── 1. Restore Supabase session ──────────────────────────────────────────
      const accessToken  = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        // Remove tokens from URL
        const clean = new URL(window.location.href);
        clean.searchParams.delete('access_token');
        clean.searchParams.delete('refresh_token');
        window.history.replaceState({}, '', clean.toString());
      }

      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, first_name, last_name')
          .eq('id', session.user.id)
          .maybeSingle();
        const displayName = profile
          ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username
          : session.user.email?.split('@')[0] ?? 'Atleta';
        update({ user: { id: session.user.id, name: displayName, email: session.user.email! } });
        // partner flow: data loading happens below, step will be set there
        if (!isPartnerFlow) setStep('categories');
      }

      // Partner flow: if session already exists on page load, load registration data.
      // If no session yet (user needs to log in), onAuthStateChange handles it after OAuth.
      if (isPartnerFlow && partnerRegId) {
        if (session?.user && !partnerDataLoadedRef.current) {
          partnerDataLoadedRef.current = true;
          await loadPartnerRegData(partnerRegId, session.user.id);
        } else if (!session?.user) {
          setLoadingInit(false);
        }
        return;
      }

      // ── 2. Fetch tournament + event cover ──────────────────────────────────
      const [{ data: t, error: tErr }, { count: registeredCount }] = await Promise.all([
        supabase
          .from('tournaments')
          .select('id, title, modality, location, start_date, end_date, registration_fee, discount_percent, discount_min_categories, include_uniform, max_registrations, event_id, events(cover_url)')
          .eq('id', tournamentId)
          .maybeSingle(),
        supabase
          .from('registrations')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', tournamentId)
          .in('payment_status', ['paid', 'pending']),
      ]);

      if (tErr || !t) {
        setInitError('Torneio não encontrado.');
        setLoadingInit(false);
        return;
      }

      const eventCover = (t as any).events?.cover_url ?? null;
      const maxRegs: number | null = (t as any).max_registrations ?? null;
      const totalSpots = maxRegs ?? 0;
      const takenSpots = registeredCount ?? 0;
      const spotsLeft = maxRegs != null ? Math.max(0, totalSpots - takenSpots) : 999;

      setTournament({
        id:                    t.id,
        name:                  t.title,
        coverUrl:              eventCover,
        location:              t.location ?? null,
        dateLabel:             t.start_date
          ? new Date(t.start_date).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' })
          : '',
        registrationFee:       t.registration_fee ?? 60,
        discountPercent:       t.discount_percent ?? 0,
        discountMinCategories: t.discount_min_categories ?? 2,
        includeUniform:        (t as any).include_uniform ?? false,
      });

      // ── 3. Build category from tournament itself ────────────────────────────
      // tournament_categories table doesn't exist; each tournament IS a category
      const mapped: Category[] = [{
        id:              t.id,
        name:            t.title,
        gender:          (t as any).modality ?? '',
        pricePerAthlete: t.registration_fee ?? 60,
        spotsLeft,
        total:           maxRegs ?? spotsLeft,
      }];
      setCategories(mapped);

      // ── 4. Pre-select categories from URL param ─────────────────────────────
      const preCats = params.get('cats');
      if (preCats) {
        const preIds = preCats.split(',');
        const preSel = mapped.filter(c => preIds.includes(c.id));
        if (preSel.length > 0) update({ selectedCategories: preSel });
      }
    } catch (err: any) {
      setInitError(err.message ?? 'Erro ao carregar torneio.');
    } finally {
      setLoadingInit(false);
    }
  };

  // ── Navigation ─────────────────────────────────────────────────────────────
  const activeStepOrder = isPartnerFlow ? PARTNER_STEP_ORDER : STEP_ORDER;

  const goNext = () => {
    let i = activeStepOrder.indexOf(step) + 1;
    while (i < activeStepOrder.length) {
      const next = activeStepOrder[i];
      if (next === 'uniform' && !tournament?.includeUniform) { i++; continue; }
      setStep(next);
      return;
    }
  };
  const goBack = () => {
    let i = activeStepOrder.indexOf(step) - 1;
    while (i >= 0) {
      const prev = activeStepOrder[i];
      if (prev === 'uniform' && !tournament?.includeUniform) { i--; continue; }
      setStep(prev);
      return;
    }
    window.location.href = returnUrl;
  };

  // ── handlePay → chama Asaas, mostra tela de pagamento inline ────────────────
  const handlePay = async () => {
    if (!data.user || !tournament) return;
    // Captura snapshot imutável do estado antes de qualquer await — evita race condition
    // se o usuário alterar categorias ou parceiro durante o processamento
    const snapshot = {
      user:               data.user,
      selectedCategories: [...data.selectedCategories],
      partners:           { ...data.partners },
      billing:            { ...data.billing },
      payOptions:         { ...data.payOptions },
      paymentMethod:      data.paymentMethod,
      uniformSizes:       { ...data.uniformSizes },
    };
    const tournamentSnapshot = { ...tournament };

    setPaying(true);
    setPayError(null);
    setPaymentResult(null);
    setPollStatus('waiting');

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? (import.meta.env.VITE_SUPABASE_ANON_KEY as string);

      const firstPartner = Object.values(snapshot.partners).find(Boolean);
      const hasSplitDuo = snapshot.selectedCategories.some(c => snapshot.payOptions[c.id] === 'mine');

      const commonBody = {
        payer: {
          player_id: snapshot.user.id,
          full_name: snapshot.billing.name || snapshot.user.name,
          email:     snapshot.billing.email || snapshot.user.email,
          cpf:       snapshot.billing.cpf,
          whatsapp:  snapshot.billing.whatsapp,
        },
        billing_type: snapshot.paymentMethod ?? 'PIX',
        uniform_size: snapshot.uniformSizes.payer ?? undefined,
        partner_uniform_size: snapshot.uniformSizes.partner ?? undefined,
      };

      const edgeFnBase = (import.meta.env.VITE_EDGE_FN_BASE as string | undefined)
        ?? `${supabaseUrl}/functions/v1/server/make-server-06b83993`;

      let endpoint: string;
      let body: object;

      if (isPartnerFlow && partnerRegId) {
        endpoint = `${edgeFnBase}/asaas/partner-payment`;
        body = { ...commonBody, registration_id: partnerRegId };
      } else {
        endpoint = `${edgeFnBase}/asaas/create-payment`;
        body = {
          ...commonBody,
          tournament_id: tournamentSnapshot.id,
          category_ids:  snapshot.selectedCategories.map(c => c.id),
          ...(firstPartner && hasSplitDuo ? {
            duo_partner: {
              player_id: firstPartner.isPrecadastro ? undefined : firstPartner.id,
              full_name:  firstPartner.name,
              email:      firstPartner.precadastroEmail ?? '',
              cpf:        firstPartner.precadastroCpf ?? '',
              whatsapp:   firstPartner.precadastroPhone ?? '',
            },
            payer_covers_duo: false,
          } : firstPartner ? {
            duo_partner: {
              player_id: firstPartner.isPrecadastro ? undefined : firstPartner.id,
              full_name:  firstPartner.name,
              email:      firstPartner.precadastroEmail ?? '',
              cpf:        firstPartner.precadastroCpf ?? '',
              whatsapp:   firstPartner.precadastroPhone ?? '',
            },
            payer_covers_duo: true,
          } : {}),
        };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify(body),
      });

      const result: AsaasPaymentResult & { error?: string; retryAfterSeconds?: number } = await res.json();

      if (!res.ok) {
        if (res.status === 503) {
          const wait = result.retryAfterSeconds ?? 30;
          setPayError(
            `O serviço de pagamento está temporariamente indisponível. ` +
            `Tente novamente em ${wait} segundo${wait !== 1 ? 's' : ''}.`
          );
        } else {
          setPayError(result.error ?? 'Erro ao processar pagamento.');
        }
        setStep('payment-details');
        return;
      }

      setPaymentResult(result);
      setStep('payment-details');

      // Cartão: abre em nova aba (não precisa polling)
      if (snapshot.paymentMethod === 'CREDIT_CARD' && result.invoice_url) {
        window.open(result.invoice_url, '_blank');
      }

      // Pix / Boleto: polling de confirmação a cada 5s
      if (snapshot.paymentMethod !== 'CREDIT_CARD' && result.registration_ids?.[0]) {
        const regId = result.registration_ids[0];
        stopPolling();
        let pollAttempts = 0;
        const MAX_POLL_ATTEMPTS = 72; // 72 × 5s = 6 minutos
        pollRef.current = setInterval(async () => {
          pollAttempts++;
          if (pollAttempts > MAX_POLL_ATTEMPTS) {
            stopPolling();
            setPayError('Tempo de espera esgotado. Verifique o status da inscrição no app ou entre em contato com o suporte.');
            return;
          }
          try {
            const checkRes = await fetch(
              `${edgeFnBase}/asaas/check-status`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                  'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
                },
                body: JSON.stringify({ registration_id: regId }),
              },
            );
            if (!checkRes.ok) {
              const errBody = await checkRes.json().catch(() => ({}));
              console.error('[poll check-status]', checkRes.status, errBody);
              return; // tenta novamente no próximo tick
            }
            const status = await checkRes.json();
            if (status.payment_status === 'paid') {
              setPollStatus('paid');
              stopPolling();
              setTimeout(() => setStep('success'), 1500);
            } else if (status.payment_status === 'expired') {
              setPollStatus('expired');
              stopPolling();
            }
          } catch {
            // Erro de rede — continua tentando até MAX_POLL_ATTEMPTS
          }
        }, 5000);
      }
    } catch (err: any) {
      setPayError(err.message ?? 'Erro de conexão. Tente novamente.');
      setStep('payment-details');
    } finally {
      setPaying(false);
    }
  };

  const handleCopyPix = async () => {
    if (!paymentResult?.pix_code) return;
    await navigator.clipboard.writeText(paymentResult.pix_code);
    setPixCopied(true);
    setTimeout(() => setPixCopied(false), 2000);
  };

  const handleCopyBoleto = async () => {
    if (!paymentResult?.boleto_identification_field) return;
    await navigator.clipboard.writeText(paymentResult.boleto_identification_field);
    setBoletoCopied(true);
    setTimeout(() => setBoletoCopied(false), 2000);
  };

  const stepProps = { data, onUpdate: update, onNext: goNext, onBack: goBack };

  // ── Loading / Error state ──────────────────────────────────────────────────
  if (loadingInit) {
    return (
      <div className="min-h-screen bg-[#121212] flex items-center justify-center">
        <Loader2 size={36} className="text-[#3ECF8E] animate-spin"/>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="min-h-screen bg-[#121212] flex flex-col items-center justify-center gap-4 px-6 text-center">
        <AlertCircle size={40} className="text-[#e5534b]"/>
        <h2 className="text-white text-[20px] font-semibold">Ops!</h2>
        <p className="text-[#8e8e8e] text-[14px] max-w-sm">{initError}</p>
        <Btn onClick={() => window.location.href = returnUrl}>
          <ArrowLeft size={16}/>Voltar ao evento
        </Btn>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#121212] flex flex-col" style={{ fontFamily:"'DM Sans',sans-serif" }}>

      {/* Banner */}
      <EventBanner tournament={tournament}/>

      {/* Sticky nav + step indicator */}
      <div className="sticky top-0 z-20">
        <div className="bg-[#121212]/95 backdrop-blur-sm border-b border-[#1a1a1a] flex items-center justify-between px-5 py-2.5">
          {step !== 'success'
            ? <button onClick={() => { if (activeStepOrder.indexOf(step) > 0) goBack(); else window.location.href = returnUrl; }}
                className="flex items-center gap-1.5 text-[#8e8e8e] hover:text-white transition-colors text-[13px]">
                <ArrowLeft size={15}/><span className="hidden sm:inline">Voltar</span>
              </button>
            : <div/>}
          <div className="flex items-center gap-2">
            <span className="text-white text-[13px] font-semibold">{tournament?.name ?? 'Inscrição'}</span>
          </div>
          <div className="w-16"/>
        </div>
        {step !== 'success' && step !== 'payment-details' && (
          <div className="bg-[#121212]/95 backdrop-blur-sm border-b border-[#1a1a1a]">
            <StepIndicator current={step} includeUniform={tournament?.includeUniform} isPartner={isPartnerFlow}/>
          </div>
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 ${step==='success'||step==='payment-details'?'flex flex-col':''}`}>
        <div className={step==='success'||step==='payment-details' ? 'flex-1 flex flex-col' : 'max-w-2xl mx-auto px-4 py-6 pb-12 w-full'}>
          {step === 'auth'           && (
            <AuthStep
              onUpdate={update}
              onNext={goNext}
              partnerMode={isPartnerFlow}
              onPartnerLogin={isPartnerFlow && partnerRegId ? async (userId) => {
                await loadPartnerRegData(partnerRegId, userId);
              } : undefined}
            />
          )}
          {step === 'partner-review' && partnerRegData && (
            <PartnerReviewStep regData={partnerRegData} onNext={goNext}/>
          )}
          {step === 'categories'     && (
            <CategoryStep {...stepProps} categories={categories} discountRate={discountRate}/>
          )}
          {step === 'uniform'        && (
            <UniformStep data={data} onUpdate={update} onNext={goNext} onBack={goBack}/>
          )}
          {step === 'partners'       && (
            <PartnerStep {...stepProps} discountRate={discountRate}/>
          )}
          {step === 'review'         && (
            <ReviewStep {...stepProps} onGoTo={setStep} discountRate={discountRate}/>
          )}
          {step === 'billing'        && (
            <BillingStep {...stepProps} discountRate={discountRate}/>
          )}
          {step === 'payment-method' && (
            <PaymentMethodStep {...stepProps} discountRate={discountRate} onPay={handlePay} paying={paying}/>
          )}
          {step === 'payment-details' && (
            <PaymentDetailsStep
              error={payError}
              paymentResult={paymentResult}
              pollStatus={pollStatus}
              onCopyPix={handleCopyPix}
              onCopyBoleto={handleCopyBoleto}
              pixCopied={pixCopied}
              boletoCopied={boletoCopied}
              onBack={() => { stopPolling(); setPaymentResult(null); setPollStatus('waiting'); setStep('payment-method'); }}
            />
          )}
          {step === 'success'         && (
            <SuccessStep data={data} returnUrl={returnUrl} tournamentId={tournamentId} discountRate={discountRate}/>
          )}
        </div>
      </div>
    </div>
  );
}
