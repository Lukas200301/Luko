import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { cn, initials } from '../lib/utils';

// ---------- Button ----------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'icon';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 shadow-sm',
  secondary: 'bg-surface-2 text-fg hover:bg-border/70',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110 shadow-sm',
  outline: 'border border-border text-fg hover:bg-surface-2'
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  icon: 'h-9 w-9 justify-center'
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, className, children, disabled, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center rounded-lg font-medium transition outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

// ---------- Card ----------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-border bg-surface shadow-sm', className)}>{children}</div>;
}

export function CardHeader({ title, description, actions, icon }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 text-muted">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

// ---------- Form controls ----------

const fieldClass = cn(
  'w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted/70',
  'outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60'
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return <input ref={ref} className={cn(fieldClass, 'h-9', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref
) {
  return <textarea ref={ref} className={cn(fieldClass, 'min-h-24 py-2 leading-relaxed', className)} {...props} />;
});

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldClass, 'h-9 cursor-pointer pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-xs font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, disabled, label }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition',
        'focus-visible:ring-2 focus-visible:ring-accent/60 outline-none disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border'
      )}
    >
      <span className={cn('inline-block size-4 rounded-full bg-white shadow transition', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
    </button>
  );
}

export function SettingRow({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {description && <div className="mt-0.5 text-xs text-muted">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ---------- Display ----------

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent/15 text-accent',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger'
};

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', badgeTones[tone], className)}>
      {children}
    </span>
  );
}

export function StatusDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2.5', className)}>
      {online && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-50" />}
      <span className={cn('relative inline-flex size-2.5 rounded-full', online ? 'bg-success' : 'bg-danger')} />
    </span>
  );
}

// Shows `src`, then `fallbackSrc` if that fails to load, then the name's initials.
export function Avatar({ src, fallbackSrc, name, className }: { src?: string | null; fallbackSrc?: string | null; name: string; className?: string }) {
  const sources = [src, fallbackSrc].filter((s, i, all): s is string => !!s && all.indexOf(s) === i);
  const [failed, setFailed] = useState<string[]>([]);
  const current = sources.find(s => !failed.includes(s));
  if (current) {
    return (
      <img
        key={current}
        src={current}
        alt=""
        loading="lazy"
        onError={() => setFailed(f => [...f, current])}
        className={cn('size-9 shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent', className)}>
      {initials(name)}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-muted', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-surface-2 p-3 text-muted">{icon}</div>}
      <div className="text-sm font-medium">{title}</div>
      {description && <div className="mt-1 max-w-sm text-xs text-muted">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', title, children, className }: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'border-accent/30 bg-accent/8 text-fg',
    warning: 'border-warning/35 bg-warning/10 text-fg',
    danger: 'border-danger/35 bg-danger/10 text-fg',
    success: 'border-success/35 bg-success/10 text-fg'
  }[tone];
  const Icon = { info: Info, warning: AlertTriangle, danger: XCircle, success: CheckCircle2 }[tone];
  const iconColor = { info: 'text-accent', warning: 'text-warning', danger: 'text-danger', success: 'text-success' }[tone];

  return (
    <div className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', styles, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconColor)} />
      <div className="min-w-0 space-y-1">
        {title && <div className="font-medium">{title}</div>}
        <div className="text-xs leading-relaxed text-muted">{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: {
  value: T;
  onChange: (value: T) => void;
  tabs: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="inline-flex rounded-lg bg-surface-2 p-1">
      {tabs.map(tab => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition',
            value === tab.value ? 'bg-surface text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Dialog ----------

export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-2xl border border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm',
        size === 'xl' ? 'max-w-4xl' : size === 'lg' ? 'max-w-2xl' : 'max-w-md'
      )}
    >
      {open && (
        <div>
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
          {children && <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>(resolve => setState({ ...options, resolve }));
  }, []);

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!state}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        description={state?.description}
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {state?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}

// ---------- Toasts ----------

interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
}

const ToastContext = createContext<(tone: Toast['tone'], message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = nextId.current++;
    setToasts(t => [...t, { id, tone, message }]);
    setTimeout(() => setToasts(t => t.filter(toast => toast.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2">
        {toasts.map(toast => {
          const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? XCircle : Info;
          const color = toast.tone === 'success' ? 'text-success' : toast.tone === 'error' ? 'text-danger' : 'text-accent';
          return (
            <div key={toast.id} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-lg">
              <Icon className={cn('mt-0.5 size-4 shrink-0', color)} />
              <span className="min-w-0 break-words">{toast.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return {
    success: (message: string) => push('success', message),
    error: (error: unknown) => push('error', error instanceof Error ? error.message : String(error)),
    info: (message: string) => push('info', message)
  };
}
