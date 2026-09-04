import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { AccountRole } from './RoleSelector';

export function AuthField({ label, aside, ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; aside?: ReactNode }) {
  return <div className="auth-field"><div className="auth-label-row"><label htmlFor={props.id}>{label}</label>{aside}</div><input {...props} /></div>;
}

export function PasswordField(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string; label?: string; aside?: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const { label = 'Password', aside, ...inputProps } = props;
  return (
    <div className="auth-field">
      <div className="auth-label-row"><label htmlFor={props.id}>{label}</label>{aside}</div>
      <div className="auth-password">
        <input {...inputProps} type={visible ? 'text' : 'password'} />
        <button type="button" disabled={props.disabled} aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

// onFill lets the sign-in form take the credentials directly: the demo password is long,
// case-sensitive and punctuated, and retyping it by hand is the usual reason a demo sign-in
// comes back as "Invalid email or password".
export function DemoAccess({ role, onFill }: { role: AccountRole; onFill?: (email: string, password: string) => void }) {
  if (import.meta.env.VITE_DEMO_MODE === 'false') return null;
  const email = role === 'admin' ? 'shopsphere675@gmail.com' : `${role === 'seller' ? 'seller' : 'customer'}1@shopsphere.test`;
  const password = role === 'admin' ? 'Qwerty@9876' : 'ShopSphereDemo!2026';
  return (
    <details className="auth-demo">
      <summary>Trying the demo?</summary>
      <div>
        <p>Use the {role === 'user' ? 'customer' : role} sandbox account. No real payments.</p>
        <dl><dt>Email</dt><dd>{email}</dd><dt>Password</dt><dd>{password}</dd></dl>
        {onFill && <button type="button" className="auth-demo-fill" onClick={() => onFill(email, password)}>Fill these in</button>}
      </div>
    </details>
  );
}
