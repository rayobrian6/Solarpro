import { redirect } from 'next/navigation';

/** Operations has been merged into the Command Center (Dashboard). */
export default function OperationsRedirect() {
  redirect('/dashboard');
}