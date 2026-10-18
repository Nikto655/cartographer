import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, action?: Toast['action']) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

/** Bottom-centre, 2.5s, one at a time (§9.5). */
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, action) => {
    const id = ++seq;
    set({ toasts: [{ id, message, action }] });
    window.setTimeout(() => {
      if (get().toasts.some((t) => t.id === id)) get().dismiss(id);
    }, 2500);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (message: string, action?: Toast['action']) => useToasts.getState().push(message, action);

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
