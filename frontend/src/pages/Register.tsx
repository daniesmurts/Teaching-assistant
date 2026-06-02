import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useRegister } from '../hooks/useAuth'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export default function Register() {
  const [form, setForm] = useState({ email: '', password: '', name: '', university: '' })
  const register = useRegister()

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    register.mutate(form)
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-bold text-ink tracking-tight">GradeAssist</h1>
          <p className="font-sans text-sm text-ink-secondary mt-2">Create your account</p>
        </div>

        <div className="bg-surface border border-border rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label="Full name" value={form.name} onChange={set('name')} placeholder="Dr. Иванов" />
            <Input label="University" value={form.university} onChange={set('university')} placeholder="МГУ" />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={set('email')}
              placeholder="you@university.ru"
              required
            />
            <Input
              label="Password"
              type="password"
              value={form.password}
              onChange={set('password')}
              placeholder="Min 8 characters"
              required
            />
            <Button type="submit" className="w-full" loading={register.isPending}>
              Create account
            </Button>
          </form>
        </div>

        <p className="text-center text-sm font-sans text-ink-secondary mt-4">
          Have an account?{' '}
          <Link to="/login" className="text-amber hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
