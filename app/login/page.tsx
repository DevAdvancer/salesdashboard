'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/lib/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff } from 'lucide-react';
import { handleApiError } from '@/lib/utils/error-handler';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});
type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true); setError(null);
    try {
      await login(data.email, data.password);
      router.push('/dashboard');
    } catch (err: any) {
      setError(handleApiError(err, { title: 'Login Failed', showToast: true, retry: () => onSubmit(data) }));
    } finally { setIsLoading(false); }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--background)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem',
      fontFamily: 'var(--font-sans-stack)',
    }}>
      {/* Subtle terracotta glow */}
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(201,100,66,0.09) 0%, transparent 65%)',
      }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '24rem' }}>

        {/* Brand mark */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '3.5rem', height: '3.5rem', borderRadius: '50%',
            background: 'rgba(201,100,66,0.10)',
            boxShadow: '0 0 0 1px rgba(201,100,66,0.20)',
            marginBottom: '0.875rem',
            overflow: 'hidden',
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/silverspace.png"
              alt="Silverspace Inc."
              style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '0.375rem' }}
            />
          </div>
          <h1 style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontWeight: 500, fontSize: '1.625rem',
            color: 'var(--foreground)', lineHeight: 1.15, margin: 0,
          }}>
            SalesHub CRM
          </h1>
          <p style={{ marginTop: '0.375rem', fontSize: '0.875rem', color: 'var(--muted-foreground)', lineHeight: 1.50 }}>
            Sign in to your workspace
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: '1rem',
          padding: '1.75rem',
          boxShadow: '0 0 0 1px var(--border), 0 8px 32px rgba(0,0,0,0.25)',
        }}>
          {error && (
            <div style={{
              padding: '0.625rem 0.875rem', marginBottom: '1.125rem',
              background: 'rgba(181,51,51,0.10)', border: '1px solid rgba(181,51,51,0.25)',
              borderRadius: '0.5rem', fontSize: '0.8125rem', color: '#e57373', lineHeight: 1.50,
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.125rem' }}>

              {/* Email */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <Label htmlFor="email">Email address</Label>
                <Input id="email" type="email" placeholder="you@company.com" {...register('email')} disabled={isLoading} />
                {errors.email && <p style={{ fontSize: '0.75rem', color: '#e57373', margin: 0 }}>{errors.email.message}</p>}
              </div>

              {/* Password */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <Label htmlFor="password">Password</Label>
                <div style={{ position: 'relative' }}>
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    {...register('password')}
                    disabled={isLoading}
                    style={{ paddingRight: '2.75rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    style={{
                      position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', padding: '0.25rem',
                      color: 'var(--muted-foreground)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', borderRadius: '0.25rem',
                      transition: 'color 0.12s ease',
                    }}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {errors.password && <p style={{ fontSize: '0.75rem', color: '#e57373', margin: 0 }}>{errors.password.message}</p>}
              </div>

              <Button type="submit" id="login-submit" loading={isLoading} className="w-full h-10 mt-0.5">
                {isLoading ? 'Signing in…' : 'Sign in'}
              </Button>
            </div>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>
          Contact support at{' '}
          <a href="mailto:harsh.patel@silverspaceinc.com" style={{ color: '#d97757', fontWeight: 500 }}>
            harsh.patel@silverspaceinc.com
          </a>
        </p>
      </div>
    </div>
  );
}
