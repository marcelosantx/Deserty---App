import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ArrowLeft, Check, CheckCircle2, Copy, CreditCard,
  Edit2, Search, Smartphone, Users, X, AlertCircle,
  Clock, Award, ChevronRight, Info, Mail, Tag, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

// ─── Figma assets (event banner fallback) ────────────────────────────────────
import imgBanner    from 'figma:asset/e105b5e610ed3a80a379fd20d3b62ba8ac6e74be.png';
import imgSynergy   from 'figma:asset/c1bbbe3578f99a2cce1355514a603fdcb1c8dc52.png';

// ─── Types ────────────────────────────────────────────────────────────────────
type CheckoutStep =
  | 'auth' | 'categories' | 'uniform' | 'partners'
  | 'review' | 'billing' | 'payment-method' | 'payment-details' | 'success';

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
  paymentMethod: 'pix' | 'credit_card' | null;
  uniformSize: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STEP_ORDER: CheckoutStep[] = [
  'auth', 'categories', 'uniform', 'partners', 'review', 'billing',
  'payment-method', 'payment-details', 'success',
];
const VISIBLE_STEPS: CheckoutStep[] = [
  'auth', 'categories', 'uniform', 'partners', 'review', 'billing', 'payment-method',
];
const STEP_LABELS: Partial<Record<CheckoutStep, string>> = {
  auth: 'Acesso', categories: 'Categorias', uniform: 'Uniforme', partners: 'Dupla',
  review: 'Revisão', billing: 'Faturamento', 'payment-method': 'Pagamento',
};
const UNIFORM_SIZES = ['PP', 'P', 'M', 'G', 'GG', 'XGG'];
const INITIAL_DATA: CheckoutData = {
  user: null, selectedCategories: [], partners: {},
  billing: { name: '', cpf: '', email: '', whatsapp: '' },
  couponCode: '', couponStatus: 'idle', couponDiscount: 0,
  payOptions: {}, paymentMethod: null, uniformSize: null,
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
function StepIndicator({ current, includeUniform }: { current: CheckoutStep; includeUniform?: boolean }) {
  const visibleSteps = VISIBLE_STEPS.filter(s => s !== 'uniform' || includeUniform);
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

// ─── STEP 1: Auth ─────────────────────────────────────────────────────────────
function AuthStep({ onUpdate, onNext }: {
  onUpdate: (u: Partial<CheckoutData>) => void; onNext: () => void;
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
    if (!email.includes('@'))   e.email = 'Email inválido';
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
        onNext();
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
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
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
            const sold     = cat.spotsLeft === 0;
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
                {!sold && (
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
  return (
    <>
      <Card>
        <StepHeading title="Tamanho do uniforme" subtitle="Escolha o tamanho da sua camiseta"/>
        <div className="grid grid-cols-3 gap-3">
          {UNIFORM_SIZES.map(size => {
            const sel = data.uniformSize === size;
            return (
              <button key={size} onClick={() => onUpdate({ uniformSize: size })}
                className={`h-14 rounded-[12px] border font-semibold text-[15px] transition-all
                  ${sel
                    ? 'border-[#3ECF8E] bg-[#3ECF8E]/10 text-[#3ECF8E] ring-1 ring-[#3ECF8E]/20'
                    : 'border-[#2a2a2a] bg-[#171717] text-[#8e8e8e] hover:border-[#4a4a4a] hover:text-white'}`}>
                {size}
              </button>
            );
          })}
        </div>
        <InfoBox color="green" className="mt-5">
          O uniforme será entregue presencialmente no dia do evento.
        </InfoBox>
      </Card>
      <div className="flex items-center justify-between mt-5">
        <Btn variant="ghost" onClick={onBack}><ArrowLeft size={16}/>Voltar</Btn>
        <Btn onClick={onNext} disabled={!data.uniformSize}>
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
    if (!pre.name.trim() || !pre.email.trim() || pre.cpf.replace(/\D/g,'').length < 11) return;
    onSelect({
      id: `pre-${Date.now()}`,
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
  const preCanSubmit = pre.name.trim().length >= 2 && pre.email.includes('@') && pre.cpf.replace(/\D/g,'').length === 11;

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
function PaySplitBlock({ cat, catIdx, partner, payOption, onSetOption, discountRate }: {
  cat: Category; catIdx: number; partner: Partner | null;
  payOption: 'full' | 'mine'; onSetOption: (v: 'full' | 'mine') => void; discountRate: number;
}) {
  const myPrice   = myAthletePrice(catIdx, cat.pricePerAthlete, discountRate);
  const pPrice    = partnerAthletePrice(cat.pricePerAthlete);
  const pairTotal = myPrice + pPrice;

  return (
    <div className="border border-[#252525] rounded-[10px] p-4 bg-[#171717] mt-3">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-white text-[13px] font-semibold">{cat.name}</p>
        <span className="text-[10px] bg-[#2a2a2a] text-[#8e8e8e] px-1.5 py-0.5 rounded-full">{cat.gender}</span>
        {catIdx > 0 && discountRate > 0 && (
          <span className="text-[10px] bg-[#3ECF8E]/20 text-[#3ECF8E] px-1.5 py-0.5 rounded-full font-semibold">
            −{Math.round(discountRate*100)}% (você)
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mb-4 text-[12px]">
        <div className="flex items-center gap-2">
          <img src={imgSynergy} className="w-5 h-5 rounded-full object-cover" alt=""/>
          <span className="text-[#8e8e8e]">Você</span>
          <span className="text-white font-semibold">{fmt(myPrice)}</span>
        </div>
        {partner && (
          <div className="flex items-center gap-2">
            {partner.avatar
              ? <img src={partner.avatar} className="w-5 h-5 rounded-full object-cover" alt=""/>
              : <div className="w-5 h-5 rounded-full bg-[#2f2f2f] flex items-center justify-center"><Users size={9} className="text-[#8e8e8e]"/></div>}
            <span className="text-[#8e8e8e] truncate max-w-[100px]">{partner.name}</span>
            <span className="text-white font-semibold">{fmt(pPrice)}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {(['full','mine'] as const).map(opt => (
          <button key={opt} onClick={() => onSetOption(opt)}
            className={`w-full text-left p-3 rounded-[8px] border transition-all flex items-center gap-3
              ${payOption===opt?'border-[#3ECF8E] bg-[#3ECF8E]/10':'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#4a4a4a]'}`}>
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all
              ${payOption===opt?'border-[#3ECF8E] bg-[#3ECF8E]':'border-[#4a4a4a]'}`}>
              {payOption===opt && <div className="w-1.5 h-1.5 rounded-full bg-[#121212]"/>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-[12px] font-medium">
                {opt==='full' ? 'Pagar total da dupla' : 'Pagar somente minha parte'}
              </p>
              <p className="text-[#8e8e8e] text-[11px] truncate">
                {opt==='full' ? 'Você cobre os dois' : `${partner?.name ?? 'Dupla'} paga ${fmt(pPrice)} separado`}
              </p>
            </div>
            <span className="text-[#3ECF8E] font-semibold text-[13px] shrink-0">
              {fmt(opt==='full' ? pairTotal : myPrice)}
            </span>
          </button>
        ))}
      </div>
      {payOption === 'mine' && partner && (
        <div className="mt-3">
          <InfoBox color="amber">
            <Mail size={12} className="inline mr-1 shrink-0"/>
            <span className="font-medium text-white">{partner.name}</span>
            {partner.precadastroEmail ? ` (${partner.precadastroEmail})` : ''}
            {' '}receberá um e-mail com a fatura de{' '}
            <span className="font-semibold text-white">{fmt(pPrice)}</span>
            {' '}para {cat.name} {cat.gender}. Prazo: <span className="font-semibold text-white">3 dias</span>.
          </InfoBox>
        </div>
      )}
    </div>
  );
}

function ReviewStep({ data, onUpdate, onNext, onBack, onGoTo, discountRate }: {
  data: CheckoutData; onUpdate: (u: Partial<CheckoutData>) => void;
  onNext: () => void; onBack: () => void; onGoTo: (s: CheckoutStep) => void; discountRate: number;
}) {
  const setPayOption = (catId: string, val: 'full'|'mine') =>
    onUpdate({ payOptions: { ...data.payOptions, [catId]: val } });
  const pricing = computePricing(data, discountRate);

  return (
    <>
      <Card>
        <StepHeading title="Revise sua inscrição"
          subtitle="Confira os dados e escolha a divisão de pagamento por categoria"/>
        <div className="border border-[#2a2a2a] rounded-[10px] p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-[#4a4a4a] uppercase tracking-wider">Atleta</span>
            <button onClick={() => onGoTo('auth')} className="text-[#3ECF8E] text-[12px] flex items-center gap-1 hover:underline">
              <Edit2 size={11}/>Editar
            </button>
          </div>
          <div className="flex items-center gap-3">
            <img src={imgSynergy} className="w-10 h-10 rounded-full object-cover" alt=""/>
            <div>
              <p className="text-white font-medium">{data.user?.name}</p>
              <p className="text-[#8e8e8e] text-[13px]">{data.user?.email}</p>
            </div>
          </div>
        </div>
        {pricing.lines.map(({ cat, idx, myPrice, isDiscounted }) => {
          const partner = data.partners[cat.id];
          return (
            <div key={cat.id} className="border border-[#2a2a2a] rounded-[10px] p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold">{cat.name}</span>
                  <span className="text-[11px] bg-[#2a2a2a] text-[#8e8e8e] px-2 py-0.5 rounded-full">{cat.gender}</span>
                  {isDiscounted && discountRate > 0 && (
                    <span className="text-[10px] bg-[#3ECF8E]/20 text-[#3ECF8E] px-1.5 py-0.5 rounded-full font-semibold">
                      −{Math.round(discountRate*100)}% (você)
                    </span>
                  )}
                </div>
                <span className="text-[#3ECF8E] font-semibold text-[13px]">{fmt(myPrice)}/você</span>
              </div>
              <div className="flex flex-col gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <img src={imgSynergy} className="w-6 h-6 rounded-full object-cover" alt=""/>
                  <span className="text-[13px] text-white">{data.user?.name}</span>
                </div>
                {partner && (
                  <div className="flex items-center gap-2">
                    {partner.avatar
                      ? <img src={partner.avatar} className="w-6 h-6 rounded-full object-cover" alt=""/>
                      : <div className="w-6 h-6 rounded-full bg-[#2f2f2f] flex items-center justify-center"><Users size={10} className="text-[#8e8e8e]"/></div>}
                    <span className="text-[13px] text-white">{partner.name}</span>
                    <span className="text-[11px] text-[#4a4a4a]">@{partner.nickname}</span>
                    <button onClick={() => onGoTo('partners')} className="ml-auto text-[#3ECF8E] hover:opacity-70"><Edit2 size={12}/></button>
                  </div>
                )}
              </div>
              <PaySplitBlock cat={cat} catIdx={idx} partner={partner ?? null}
                payOption={data.payOptions[cat.id] ?? 'full'}
                onSetOption={v => setPayOption(cat.id, v)} discountRate={discountRate}/>
            </div>
          );
        })}
        <div className="px-4 py-3 bg-[#171717] rounded-[10px] border border-[#2a2a2a] flex items-center justify-between">
          <div>
            <p className="text-[#8e8e8e] text-[13px]">Total que você pagará</p>
            {pricing.partnerTotalOwed > 0 && (
              <p className="text-[11px] text-amber-400 mt-0.5">
                + {fmt(pricing.partnerTotalOwed)} cobrado(s) das duplas individualmente
              </p>
            )}
          </div>
          <span className="text-[#3ECF8E] font-semibold text-[18px]">{fmt(pricing.userBaseTotal)}</span>
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
    if (data.billing.cpf.replace(/\D/g,'').length < 11) e.cpf   = 'CPF inválido';
    if (!data.billing.email.includes('@'))               e.email = 'Email inválido';
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
function PaymentMethodStep({ data, onUpdate, onNext, onBack, discountRate, onPay, paying }: {
  data: CheckoutData; onUpdate: (u: Partial<CheckoutData>) => void;
  onNext: () => void; onBack: () => void; discountRate: number;
  onPay: () => void; paying: boolean;
}) {
  const pricing = computePricing(data, discountRate);
  return (
    <>
      <Card>
        <StepHeading title="Forma de pagamento"
          subtitle={`Total a pagar: ${fmt(pricing.userBaseTotal)}`}/>
        <div className="flex flex-col gap-3">
          {([
            { id:'credit_card' as const, icon:<CreditCard size={20}/>, title:'Cartão de Crédito', sub:'Visa, Mastercard, Elo e outras bandeiras', disabled: false },
            { id:'pix' as const,         icon:<Smartphone size={20}/>, title:'Pix',                sub:'Em breve', disabled: true },
          ] as const).map(m => {
            const sel = data.paymentMethod === m.id;
            return (
              <button key={m.id} onClick={() => !m.disabled && onUpdate({ paymentMethod: m.id })}
                disabled={m.disabled}
                className={`w-full text-left p-4 rounded-[12px] border transition-all flex items-center gap-4
                  ${m.disabled ? 'opacity-40 cursor-not-allowed border-[#2a2a2a] bg-[#171717]'
                    : sel ? 'border-[#3ECF8E] bg-[#3ECF8E]/10 ring-1 ring-[#3ECF8E]/20'
                           : 'border-[#2a2a2a] bg-[#171717] hover:border-[#4a4a4a]'}`}>
                <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all
                  ${sel?'bg-[#3ECF8E] text-[#121212]':'bg-[#252525] text-[#8e8e8e]'}`}>{m.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold">{m.title}</p>
                  <p className="text-[#8e8e8e] text-[12px]">{m.sub}</p>
                </div>
                {sel && <div className="w-5 h-5 bg-[#3ECF8E] rounded-full flex items-center justify-center shrink-0"><Check size={11} className="text-[#121212]"/></div>}
              </button>
            );
          })}
        </div>

        {data.paymentMethod && (
          <div className="mt-5">
            <InfoBox color="green">
              Você será redirecionado para o ambiente seguro do Stripe para finalizar o pagamento.
              {data.paymentMethod === 'pix' && ' O QR Code do Pix será exibido na próxima tela.'}
            </InfoBox>
          </div>
        )}
      </Card>
      <div className="flex items-center justify-between mt-5">
        <Btn variant="ghost" onClick={onBack}><ArrowLeft size={16}/>Voltar</Btn>
        <Btn onClick={onPay} disabled={!data.paymentMethod || paying}>
          {paying
            ? <><Loader2 size={16} className="animate-spin"/>Preparando…</>
            : <>Ir para pagamento<ChevronRight size={16}/></>}
        </Btn>
      </div>
    </>
  );
}

// ─── STEP 7: Payment Details (redirect loading / payment processing) ─────────
function PaymentDetailsStep({ error, confirming = false }: { error: string | null; confirming?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      {error ? (
        <>
          <div className="w-16 h-16 bg-[#e5534b]/10 rounded-full flex items-center justify-center">
            <AlertCircle size={32} className="text-[#e5534b]"/>
          </div>
          <div className="text-center">
            <h2 className="text-white text-[20px] font-semibold mb-2">Erro ao processar</h2>
            <p className="text-[#8e8e8e] text-[14px] max-w-sm">{error}</p>
          </div>
          <Btn onClick={() => window.location.reload()}>Tentar novamente</Btn>
        </>
      ) : confirming ? (
        <>
          <div className="w-16 h-16 bg-[#3ECF8E]/10 rounded-full flex items-center justify-center">
            <Loader2 size={32} className="text-[#3ECF8E] animate-spin"/>
          </div>
          <div className="text-center">
            <h2 className="text-white text-[20px] font-semibold mb-2">Confirmando pagamento…</h2>
            <p className="text-[#8e8e8e] text-[14px]">Aguarde enquanto confirmamos sua inscrição.</p>
          </div>
        </>
      ) : (
        <>
          <div className="w-16 h-16 bg-[#3ECF8E]/10 rounded-full flex items-center justify-center">
            <Loader2 size={32} className="text-[#3ECF8E] animate-spin"/>
          </div>
          <div className="text-center">
            <h2 className="text-white text-[20px] font-semibold mb-2">Redirecionando para o Stripe…</h2>
            <p className="text-[#8e8e8e] text-[14px]">Você será enviado para o ambiente seguro de pagamento.</p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── STEP 8: Success ──────────────────────────────────────────────────────────
function SuccessStep({ data, returnUrl, discountRate }: {
  data: CheckoutData; returnUrl: string; discountRate: number;
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
          <Btn onClick={() => window.location.href = returnUrl} fullWidth>
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
  const tournamentId = params.get('tid') ?? '';
  const returnUrl    = params.get('return') ?? (import.meta.env.VITE_APP_URL as string) ?? '/';
  const sessionId    = params.get('session_id');  // Stripe callback

  // ── State ──────────────────────────────────────────────────────────────────
  const [step, setStep]           = useState<CheckoutStep>('auth');
  const [data, setData]           = useState<CheckoutData>(INITIAL_DATA);
  const [tournament, setTournament] = useState<TournamentMeta | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [initError, setInitError]   = useState<string | null>(null);
  const [paying, setPaying]         = useState(false);
  const [payError, setPayError]     = useState<string | null>(null);

  const discountRate = (tournament?.discountPercent ?? 0) / 100;

  const update = (u: Partial<CheckoutData>) => setData(p => ({ ...p, ...u }));

  // ── On mount: check Stripe session_id callback first ──────────────────────
  useEffect(() => {
    if (sessionId) {
      // Restore checkout data saved before Stripe redirect
      try {
        const saved = sessionStorage.getItem('deserty_checkout_data');
        if (saved) {
          setData(JSON.parse(saved));
          sessionStorage.removeItem('deserty_checkout_data');
        }
        const savedTournament = sessionStorage.getItem('deserty_checkout_tournament');
        if (savedTournament) {
          setTournament(JSON.parse(savedTournament));
          sessionStorage.removeItem('deserty_checkout_tournament');
        }
      } catch { /* ignore */ }

      // Poll until webhook confirms payment_status = "paid" (max 30s)
      setStep('payment-details');
      setLoadingInit(false);

      let attempts = 0;
      const maxAttempts = 15;
      const interval = setInterval(async () => {
        attempts++;
        try {
          const { data: reg } = await supabase
            .from('registrations')
            .select('id, payment_status')
            .eq('stripe_session_id', sessionId)
            .maybeSingle();

          if (reg?.payment_status === 'paid') {
            clearInterval(interval);
            setStep('success');
          } else if (attempts >= maxAttempts) {
            clearInterval(interval);
            // Webhook may still be processing — show success anyway
            setStep('success');
          }
        } catch {
          if (attempts >= maxAttempts) {
            clearInterval(interval);
            setStep('success');
          }
        }
      }, 2000);

      return () => clearInterval(interval);
    }
    initCheckout();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initCheckout = async () => {
    if (!tournamentId) {
      setInitError('Torneio não identificado. Volte ao evento e tente novamente.');
      setLoadingInit(false);
      return;
    }

    try {
      // ── 1. Restore Supabase session ──────────────────────────────────────────
      const accessToken  = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      console.log('[Checkout] tokens from URL:', { hasAccess: !!accessToken, hasRefresh: !!refreshToken });

      if (accessToken && refreshToken) {
        const { error: sessErr } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        console.log('[Checkout] setSession result:', { sessErr });
        // Remove tokens from URL
        const clean = new URL(window.location.href);
        clean.searchParams.delete('access_token');
        clean.searchParams.delete('refresh_token');
        window.history.replaceState({}, '', clean.toString());
      }

      const { data: { session } } = await supabase.auth.getSession();
      console.log('[Checkout] session after restore:', { hasSession: !!session, userId: session?.user?.id });
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
        setStep('categories'); // skip auth
      }

      // ── 2. Fetch tournament + event cover ──────────────────────────────────
      const { data: t, error: tErr } = await supabase
        .from('tournaments')
        .select('id, title, modality, location, start_date, end_date, registration_fee, discount_percent, discount_min_categories, include_uniform, event_id, events(cover_url)')
        .eq('id', tournamentId)
        .maybeSingle();

      if (tErr || !t) {
        console.error('[Checkout] tournament fetch error:', tErr, 'tid:', tournamentId);
        setInitError('Torneio não encontrado.');
        setLoadingInit(false);
        return;
      }

      const eventCover = (t as any).events?.cover_url ?? null;

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
        spotsLeft:       32,
        total:           32,
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
  const goNext = () => {
    let i = STEP_ORDER.indexOf(step) + 1;
    while (i < STEP_ORDER.length) {
      const next = STEP_ORDER[i];
      if (next === 'uniform' && !tournament?.includeUniform) { i++; continue; }
      setStep(next);
      return;
    }
  };
  const goBack = () => {
    let i = STEP_ORDER.indexOf(step) - 1;
    while (i >= 0) {
      const prev = STEP_ORDER[i];
      if (prev === 'uniform' && !tournament?.includeUniform) { i--; continue; }
      setStep(prev);
      return;
    }
    window.location.href = returnUrl;
  };

  // ── Call Edge Function → redirect to Stripe ────────────────────────────────
  const handlePay = async () => {
    if (!data.user || !tournament) return;
    setPaying(true);
    setPayError(null);
    setStep('payment-details');

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const checkoutUrl = (import.meta.env.VITE_CHECKOUT_URL as string) || window.location.origin;
      const appUrl      = (import.meta.env.VITE_APP_URL as string) || returnUrl || window.location.origin;

      // Build duo_partner list from the first category that has a partner
      // (for multi-category split, all partners are included in registration ids)
      const firstPartner = Object.values(data.partners).find(Boolean);

      const body = {
        tournament_id: tournament.id,
        category_ids:  data.selectedCategories.map(c => c.id),
        payer: {
          player_id: data.user.id,
          full_name: data.billing.name || data.user.name,
          email:     data.billing.email || data.user.email,
          cpf:       data.billing.cpf,
          whatsapp:  data.billing.whatsapp,
        },
        ...(firstPartner && data.selectedCategories.some(c => data.payOptions[c.id] === 'mine') ? {
          duo_partner: {
            player_id:  firstPartner.isPrecadastro ? undefined : firstPartner.id,
            full_name:  firstPartner.name,
            email:      firstPartner.precadastroEmail ?? '',
            cpf:        firstPartner.precadastroCpf ?? '',
            whatsapp:   firstPartner.precadastroPhone ?? '',
          },
          payer_covers_duo: false,
        } : firstPartner ? {
          duo_partner: {
            player_id:  firstPartner.isPrecadastro ? undefined : firstPartner.id,
            full_name:  firstPartner.name,
            email:      firstPartner.precadastroEmail ?? '',
            cpf:        firstPartner.precadastroCpf ?? '',
            whatsapp:   firstPartner.precadastroPhone ?? '',
          },
          payer_covers_duo: true,
        } : {}),
        payment_method_hint: data.paymentMethod,
        uniform_size: data.uniformSize ?? undefined,
        success_url: `${checkoutUrl || appUrl}/checkout?tid=${tournament.id}&return=${encodeURIComponent(returnUrl)}`,
        cancel_url:  returnUrl,
      };

      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/server/make-server-06b83993/stripe/create-checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`,
            'apikey': anonKey,
          },
          body: JSON.stringify(body),
        },
      );

      const result = await res.json();

      if (!res.ok) {
        setPayError(result.error ?? 'Erro ao processar pagamento.');
        return;
      }

      // Save state before Stripe redirect so success screen has data
      sessionStorage.setItem('deserty_checkout_data', JSON.stringify(data));
      sessionStorage.setItem('deserty_checkout_tournament', JSON.stringify(tournament));
      window.location.href = result.checkout_url;
    } catch (err: any) {
      setPayError(err.message ?? 'Erro de conexão. Tente novamente.');
    } finally {
      setPaying(false);
    }
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
            ? <button onClick={() => { if (STEP_ORDER.indexOf(step) > 0) goBack(); else window.location.href = returnUrl; }}
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
            <StepIndicator current={step} includeUniform={tournament?.includeUniform}/>
          </div>
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 ${step==='success'||step==='payment-details'?'flex flex-col':''}`}>
        <div className={step==='success'||step==='payment-details' ? 'flex-1 flex flex-col' : 'max-w-2xl mx-auto px-4 py-6 pb-12 w-full'}>
          {step === 'auth'           && <AuthStep onUpdate={update} onNext={goNext}/>}
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
          {step === 'payment-details' && <PaymentDetailsStep error={payError} confirming={!!sessionId}/>}
          {step === 'success'         && (
            <SuccessStep data={data} returnUrl={returnUrl} discountRate={discountRate}/>
          )}
        </div>
      </div>
    </div>
  );
}
