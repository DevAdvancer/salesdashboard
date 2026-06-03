import { redirect } from 'next/navigation';

export default function SignupPage(): null {
  redirect('/login');
  return null;
}
