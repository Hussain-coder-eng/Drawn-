interface AuthScreenProps {
  onGoogleLogin: () => void;
  isLoggingIn: boolean;
  error: string | null;
}

export default function AuthScreen({ onGoogleLogin, isLoggingIn, error }: AuthScreenProps) {
  return (
    <div
      data-testid="auth-screen"
      className="fixed inset-0 z-[9999] bg-[#0f0f13] flex flex-col items-center justify-center px-8"
    >
      <div className="mb-12 text-center">
        <h1 className="text-[56px] font-display font-bold tracking-tighter text-white uppercase italic leading-none">
          Draw<span className="text-accent-primary">n</span>
        </h1>
        <p className="text-[12px] text-text-secondary mt-2 font-medium uppercase tracking-[0.2em]">
          Draw your run.
        </p>
      </div>
      <div className="mb-12 w-[200px] h-[120px]">
        <svg viewBox="0 0 200 120" className="w-full h-full">
          <rect width="200" height="120" rx="12" fill="#18181f" />
          <line x1="0" y1="40" x2="200" y2="40" stroke="#2a2a38" strokeWidth="1" />
          <line x1="0" y1="80" x2="200" y2="80" stroke="#2a2a38" strokeWidth="1" />
          <line x1="66" y1="0" x2="66" y2="120" stroke="#2a2a38" strokeWidth="1" />
          <line x1="133" y1="0" x2="133" y2="120" stroke="#2a2a38" strokeWidth="1" />
          <circle cx="100" cy="60" r="36" fill="none" stroke="#FF2D6B" strokeWidth="2.5"
            strokeDasharray="226" strokeDashoffset="226" strokeLinecap="round">
            <animate attributeName="stroke-dashoffset" from="226" to="0"
              dur="2.5s" repeatCount="indefinite" calcMode="ease" />
          </circle>
        </svg>
      </div>
      <div className="w-full max-w-[320px] space-y-3">
        {error && (
          <p className="text-danger text-[12px] text-center font-medium">{error}</p>
        )}
        <button
          data-testid="google-login-btn"
          onClick={onGoogleLogin}
          disabled={isLoggingIn}
          className="w-full h-[56px] bg-white rounded-full flex items-center justify-center gap-3 text-[15px] font-sans font-semibold text-gray-800 hover:opacity-90 transition-all disabled:opacity-50"
        >
          <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {isLoggingIn ? "Signing in…" : "Continue with Google"}
        </button>
      </div>
      <p className="mt-8 text-[11px] text-text-muted text-center">
        By continuing you agree to our Terms &amp; Privacy
      </p>
    </div>
  );
}
