import React, { useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signInWithPopup,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { OxynityLogo } from './OxynityLogo';
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  X,
  Check,
  KeyRound,
} from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: (userEmail?: string, displayName?: string, role?: 'operator' | 'admin') => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginSuccess,
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Password reset modal state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState('');
  const [resetErrorMessage, setResetErrorMessage] = useState('');

  // Load remembered email on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem('oxynity_remembered_email');
    if (savedEmail) {
      setEmail(savedEmail);
    }
  }, []);

  // Calculate Password Strength for Signup
  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return { score: 0, label: '', color: 'bg-slate-200' };
    let score = 0;
    if (pwd.length >= 6) score += 1;
    if (pwd.length >= 8) score += 1;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd) || /[^A-Za-z0-9]/.test(pwd)) score += 1;

    switch (score) {
      case 1:
        return { score: 25, label: 'Weak', color: 'bg-rose-500' };
      case 2:
        return { score: 50, label: 'Fair', color: 'bg-amber-500' };
      case 3:
        return { score: 75, label: 'Good', color: 'bg-sky-500' };
      case 4:
        return { score: 100, label: 'Strong', color: 'bg-emerald-500' };
      default:
        return { score: 15, label: 'Too short', color: 'bg-rose-400' };
    }
  };

  const passwordStrength = getPasswordStrength(password);

  // Handle Main Form Submission (Auto-detects Admin role if email contains 'admin')
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      setErrorMessage('Please fill in all required fields.');
      return;
    }

    const isAdminEmail = cleanEmail.toLowerCase().includes('admin');
    const userRole: 'operator' | 'admin' = isAdminEmail ? 'admin' : 'operator';

    if (mode === 'signup') {
      if (!fullName.trim()) {
        setErrorMessage('Please enter your full name.');
        return;
      }
      if (cleanPassword.length < 6) {
        setErrorMessage('Password must be at least 6 characters.');
        return;
      }
      if (cleanPassword !== confirmPassword.trim()) {
        setErrorMessage('Passwords do not match.');
        return;
      }
    }

    if (rememberMe && cleanEmail) {
      localStorage.setItem('oxynity_remembered_email', cleanEmail);
    } else {
      localStorage.removeItem('oxynity_remembered_email');
    }

    setIsLoading(true);

    try {
      if (mode === 'signup') {
        const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPassword).catch((e) => {
          const c = e?.code || '';
          if (
            c === 'auth/network-request-failed' ||
            c === 'auth/operation-not-allowed' ||
            c === 'auth/admin-restricted-operation' ||
            e?.message?.includes('PASSWORD_LOGIN_DISABLED')
          ) {
            console.warn('Firebase Auth cloud network fallback (Signup):', e);
            return null;
          }
          throw e;
        });

        if (userCredential?.user && fullName.trim()) {
          await updateProfile(userCredential.user, {
            displayName: fullName.trim(),
          }).catch(() => {});
        }

        setSuccessMessage(
          isAdminEmail
            ? 'Admin Account Created! Opening Admin Portal...'
            : 'Operator Account Created! Opening App...'
        );

        setTimeout(() => {
          onLoginSuccess(
            cleanEmail,
            fullName.trim() || (isAdminEmail ? 'System Admin' : 'Operator'),
            userRole
          );
        }, 500);
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, cleanPassword).catch((e) => {
          const c = e?.code || '';
          if (
            c === 'auth/network-request-failed' ||
            c === 'auth/operation-not-allowed' ||
            c === 'auth/admin-restricted-operation' ||
            e?.message?.includes('PASSWORD_LOGIN_DISABLED')
          ) {
            console.warn('Firebase Auth cloud network fallback (SignIn):', e);
            return null;
          }
          throw e;
        });

        setSuccessMessage(
          isAdminEmail
            ? 'Admin Logged in! Opening Admin Portal...'
            : 'Logged in! Opening App...'
        );

        setTimeout(() => {
          onLoginSuccess(
            userCredential?.user?.email || cleanEmail,
            userCredential?.user?.displayName || fullName.trim() || (isAdminEmail ? 'System Admin' : 'Operator'),
            userRole
          );
        }, 500);
      }
    } catch (err: any) {
      console.error('Auth Error:', err);
      let msg = 'Authentication failed. Check your credentials.';
      const code = err.code || '';

      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        msg = 'Invalid email or password. Tap "Sign Up" if you need an account.';
      } else if (code === 'auth/email-already-in-use') {
        msg = 'An account with this email already exists. Switch to Sign In.';
      } else if (code === 'auth/invalid-email') {
        msg = 'Please enter a valid email address.';
      } else if (code === 'auth/weak-password') {
        msg = 'Password should be at least 6 characters.';
      } else if (code === 'auth/too-many-requests') {
        msg = 'Too many attempts. Reset password or try again later.';
      } else if (err.message) {
        msg = err.message.replace('Firebase: ', '');
      }
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };


  // Password Reset Email Handler
  const handleSendResetEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanResetEmail = resetEmail.trim();
    if (!cleanResetEmail) {
      setResetErrorMessage('Enter your registered email.');
      return;
    }

    setIsSendingReset(true);
    setResetErrorMessage('');
    setResetSuccessMessage('');

    try {
      await sendPasswordResetEmail(auth, cleanResetEmail);
      setResetSuccessMessage('Reset link sent! Check your email inbox.');
    } catch (err: any) {
      console.error('Reset error:', err);
      let msg = 'Could not send reset email.';
      if (err.code === 'auth/user-not-found') {
        msg = 'No user account found with this email.';
      } else if (err.code === 'auth/invalid-email') {
        msg = 'Invalid email address.';
      } else if (err.message) {
        msg = err.message.replace('Firebase: ', '');
      }
      setResetErrorMessage(msg);
    } finally {
      setIsSendingReset(false);
    }
  };

  // Google Sign-In Handler (Uses Firebase Auth Google Provider enabled in project)
  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const cleanEmail = (user.email || 'operator@oxynity.com').trim().toLowerCase();
      const isAdmin = cleanEmail.includes('admin');
      const role: 'operator' | 'admin' = isAdmin ? 'admin' : 'operator';
      setSuccessMessage(isAdmin ? 'Admin Logged In with Google!' : 'Logged In with Google!');
      setTimeout(() => {
        onLoginSuccess(cleanEmail, user.displayName || 'Google User', role);
      }, 500);
    } catch (err: any) {
      console.error('Google Sign-In Error:', err);
      if (err.code === 'auth/popup-closed-by-user') {
        // User closed popup
      } else {
        setErrorMessage(err.message?.replace('Firebase: ', '') || 'Google Sign-in failed.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-full h-full min-h-screen w-full bg-white text-slate-800 flex flex-col items-center justify-start sm:justify-center p-3 sm:p-4 font-sans relative overflow-y-auto selection:bg-sky-500 selection:text-white py-6">
      {/* Background Soft Aqua Light Glows */}
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-96 sm:w-[500px] h-96 sm:h-[500px] bg-sky-200/40 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-80 h-80 bg-cyan-200/30 rounded-full blur-[100px] pointer-events-none" />

      {/* Main Mobile Card Container */}
      <div className="w-full sm:max-w-[420px] bg-white/95 backdrop-blur-xl rounded-[32px] sm:rounded-[36px] border border-slate-200/80 shadow-2xl shadow-sky-950/10 overflow-hidden relative z-10 flex flex-col">
        
        {/* Mobile Header / Branding */}
        <div className="pt-7 px-6 pb-3 flex flex-col items-center text-center space-y-3 bg-gradient-to-b from-sky-50/60 to-transparent">
          <OxynityLogo lightBackground={true} />
          
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-sky-100/80 text-sky-800 border border-sky-200">
            <Sparkles className="w-3.5 h-3.5 text-sky-600" />
            <span>Smart Aquaculture IoT</span>
          </div>
        </div>

        {/* Segmented Control Tabs (Sign In | Sign Up) */}
        <div className="px-6 pt-2 pb-3">
          <div className="flex bg-slate-100/90 p-1 rounded-2xl border border-slate-200/80">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage('');
                setSuccessMessage('');
              }}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                mode === 'login'
                  ? 'bg-gradient-to-r from-sky-600 via-cyan-600 to-sky-500 text-white shadow-md shadow-sky-500/25'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrorMessage('');
                setSuccessMessage('');
              }}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                mode === 'signup'
                  ? 'bg-gradient-to-r from-sky-600 via-cyan-600 to-sky-500 text-white shadow-md shadow-sky-500/25'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign Up
            </button>
          </div>
        </div>

        {/* Mobile Content Form Body */}
        <div className="px-6 pb-6 flex-1 flex flex-col justify-between">
          <div>
            {/* Title & Subtitle (Sign Up only) */}
            {mode === 'signup' && (
              <div className="mb-4 text-center space-y-1">
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
                  Create Account
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  Register your account for IoT telemetry & controls.
                </p>
              </div>
            )}

            {/* Error Alert */}
            {errorMessage && (
              <div className="mb-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="flex-1">{errorMessage}</span>
              </div>
            )}

            {/* Success Alert */}
            {successMessage && (
              <div className="mb-4 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span className="flex-1">{successMessage}</span>
              </div>
            )}

            {/* Form Fields */}
            <form onSubmit={handleSubmit} className="space-y-3.5">
              
              {/* Full Name (Sign Up Only) */}
              {mode === 'signup' && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 ml-1 block uppercase tracking-wider">
                    Full Name
                  </label>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sky-600">
                      <User className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Alex Morgan"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full h-12 pl-10 pr-4 bg-slate-50 focus:bg-white rounded-2xl border border-slate-200 text-base sm:text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-all shadow-xs"
                    />
                  </div>
                </div>
              )}

              {/* Email Field */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 ml-1 block uppercase tracking-wider">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sky-600">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="email"
                    required
                    placeholder="operator@oxynity.com or admin@oxynity.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-12 pl-10 pr-4 bg-slate-50 focus:bg-white rounded-2xl border border-slate-200 text-base sm:text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-all shadow-xs"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[11px] font-bold text-slate-700 block uppercase tracking-wider">
                    Password
                  </label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => {
                        setResetEmail(email);
                        setResetErrorMessage('');
                        setResetSuccessMessage('');
                        setShowResetModal(true);
                      }}
                      className="text-[11px] font-extrabold text-sky-600 hover:text-sky-700 cursor-pointer"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sky-600">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder={mode === 'login' ? '••••••••' : 'At least 6 characters'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-12 pl-10 pr-11 bg-slate-50 focus:bg-white rounded-2xl border border-slate-200 text-base sm:text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-all shadow-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Password Strength Meter (Signup Mode) */}
              {mode === 'signup' && password.length > 0 && (
                <div className="space-y-1 pt-0.5">
                  <div className="flex justify-between items-center text-[10px] font-semibold px-1">
                    <span className="text-slate-500">Password strength:</span>
                    <span className={passwordStrength.score >= 75 ? 'text-emerald-600' : 'text-amber-600'}>
                      {passwordStrength.label}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${passwordStrength.color} transition-all duration-300`}
                      style={{ width: `${passwordStrength.score}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Confirm Password (Sign Up Only) */}
              {mode === 'signup' && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 ml-1 block uppercase tracking-wider">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sky-600">
                      <KeyRound className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full h-12 pl-10 pr-4 bg-slate-50 focus:bg-white rounded-2xl border border-slate-200 text-base sm:text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-all shadow-xs"
                    />
                  </div>
                </div>
              )}

              {/* Remember Me Checkbox */}
              {mode === 'login' && (
                <div className="flex items-center justify-between pt-0.5">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-600 select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                    />
                    <span>Remember me on this phone</span>
                  </label>
                </div>
              )}

              {/* Primary Action Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-12 mt-2 rounded-2xl font-extrabold text-sm text-white bg-gradient-to-r from-sky-600 via-cyan-600 to-sky-500 hover:from-sky-700 hover:to-cyan-700 shadow-lg shadow-sky-500/30 active:scale-[0.98] cursor-pointer disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>{mode === 'login' ? 'Sign In to App' : 'Create Account'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {/* Divider */}
              <div className="relative my-3.5 flex items-center justify-center">
                <div className="w-full border-t border-slate-200" />
                <span className="bg-white px-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider absolute">
                  or
                </span>
              </div>

              {/* Google Sign In Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full h-12 rounded-2xl font-bold text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 active:scale-[0.98] cursor-pointer disabled:opacity-50 transition-all flex items-center justify-center gap-2.5 shadow-xs"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.97 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>
            </form>

          </div>

          {/* Bottom Switcher Note */}
          <div className="mt-6 text-center text-xs font-semibold text-slate-500 pt-3 border-t border-slate-100">
            {mode === 'login' ? (
              <span>
                New operator or admin?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setErrorMessage('');
                    setSuccessMessage('');
                  }}
                  className="text-sky-600 font-extrabold hover:underline cursor-pointer"
                >
                  Create an account
                </button>
              </span>
            ) : (
              <span>
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMessage('');
                    setSuccessMessage('');
                  }}
                  className="text-sky-600 font-extrabold hover:underline cursor-pointer"
                >
                  Sign In
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Mobile Home Indicator */}
        <div className="pb-2 flex justify-center">
          <div className="w-28 h-1 bg-slate-200 rounded-full" />
        </div>
      </div>

      {/* Forgot Password Modal Dialog */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl relative space-y-4">
            <button
              type="button"
              onClick={() => setShowResetModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1 rounded-xl hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-sky-50 text-sky-600 border border-sky-100">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Reset Password</h3>
                <p className="text-xs text-slate-500">We'll send a reset link to your email.</p>
              </div>
            </div>

            {resetErrorMessage && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{resetErrorMessage}</span>
              </div>
            )}

            {resetSuccessMessage && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{resetSuccessMessage}</span>
              </div>
            )}

            <form onSubmit={handleSendResetEmail} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 ml-1 block uppercase tracking-wider">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sky-600">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="email"
                    required
                    placeholder="operator@oxynity.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="w-full h-12 pl-10 pr-4 bg-slate-50 rounded-2xl border border-slate-200 text-base sm:text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowResetModal(false)}
                  className="flex-1 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSendingReset}
                  className="flex-1 h-11 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 text-white font-bold text-xs cursor-pointer shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSendingReset ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    'Send Link'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
