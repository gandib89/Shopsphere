import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import NavBar from '../components/NavBar';
import { Button } from '../components/ui/Button';
import { ErrorState, LoadingState } from '../components/ui/AsyncState';
import { startESewaCheckout } from '../lib/esewa';
import { authFetch } from '../lib/session';

interface PaymentRecord { id: string; status: 'Initiated' | 'Succeeded' | 'Failed' }
interface PaymentOrder {
  _id: string;
  status: string;
  totalPrice: number;
  product: { name: string };
  payments?: PaymentRecord[];
}

type ResultFrameProps = {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
};

const ResultFrame = ({ icon, title, description, children }: ResultFrameProps) => (
  <main className="flex min-h-[calc(100dvh-5rem)] items-center justify-center bg-paper px-4 py-12">
    <section className="w-full max-w-lg border border-hairline bg-paper-raised px-5 py-9 text-center sm:px-10" aria-labelledby="payment-result-title">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-current" aria-hidden="true">{icon}</div>
      <h1 id="payment-result-title" className="text-3xl font-bold text-ink sm:text-4xl">{title}</h1>
      <p className="mx-auto mt-3 max-w-md leading-relaxed text-ink-muted">{description}</p>
      {children && <div className="mt-7">{children}</div>}
    </section>
  </main>
);

const readError = async (response: Response, fallback: string) => {
  try { const body = await response.json(); return body.message || fallback; } catch { return fallback; }
};

export default function Failure() {
  const { orderId } = useParams();
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const loadOrder = useCallback(async () => {
    if (!orderId) {
      setError('This payment link does not contain a valid order number.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/details/${orderId}`);
      if (!response.ok) throw new Error(await readError(response, 'We could not load this order.'));
      setOrder(await response.json());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'We could not load this order.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { void loadOrder(); }, [loadOrder]);

  const retryPayment = async () => {
    if (!orderId) return;
    setRetrying(true);
    setError('');
    try {
      await startESewaCheckout(orderId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reopen eSewa. Please try again.');
      setRetrying(false);
    }
  };

  const cancelOrder = async () => {
    if (!orderId) return;
    setCancelling(true);
    setError('');
    try {
      const response = await authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/cancel/${orderId}`, { method: 'PUT' });
      if (!response.ok) throw new Error(await readError(response, 'Could not cancel this order.'));
      setOrder(previous => previous ? { ...previous, status: 'Cancelled' } : previous);
      setConfirmCancel(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not cancel this order.');
    } finally {
      setCancelling(false);
    }
  };

  const paymentStatus = order?.payments?.[0]?.status;
  const paid = paymentStatus === 'Succeeded' && order?.status !== 'Pending' && order?.status !== 'Cancelled';
  const cancelled = order?.status === 'Cancelled';
  const pendingVerification = paymentStatus === 'Initiated' || (paymentStatus === 'Succeeded' && order?.status === 'Pending');

  const paymentActions = order?.status === 'Pending' && <>
    <div className="flex flex-col justify-center gap-3 sm:flex-row">
      <Button loading={retrying} disabled={cancelling} onClick={() => void retryPayment()}>Retry with eSewa</Button>
      <Button variant="secondary" disabled={retrying || cancelling} onClick={() => setConfirmCancel(true)}>Cancel order</Button>
    </div>
    {confirmCancel && <div className="mt-5 border border-seal/40 bg-seal/5 p-4 text-left" role="alertdialog" aria-labelledby="cancel-order-title">
      <h2 id="cancel-order-title" className="font-semibold text-ink">Cancel this unpaid order?</h2>
      <p className="mt-1 text-sm text-ink-muted">You will need to place a new order if you change your mind.</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button variant="danger" loading={cancelling} onClick={() => void cancelOrder()}>Yes, cancel order</Button>
        <Button variant="quiet" disabled={cancelling} onClick={() => setConfirmCancel(false)}>Keep order</Button>
      </div>
    </div>}
  </>;

  return <>
    <NavBar />
    {loading ? <main className="min-h-[calc(100dvh-5rem)] bg-paper"><LoadingState description="Checking payment status…" /></main>
      : error && !order ? <main className="min-h-[calc(100dvh-5rem)] bg-paper"><ErrorState title="We could not check this payment" description={error} action={<Button onClick={() => void loadOrder()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} /></main>
      : paid ? <ResultFrame icon={<CheckCircle2 className="h-9 w-9 text-moss" />} title="Payment already confirmed" description="eSewa verified this payment and your order is confirmed.">
          <Link className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-brass bg-brass px-4 text-sm font-semibold text-white hover:bg-brass-dark" to={`/success/${orderId}`}>View confirmation</Link>
        </ResultFrame>
      : cancelled ? <ResultFrame icon={<XCircle className="h-9 w-9 text-seal" />} title="Order cancelled" description="This order is cancelled and can no longer be paid.">
          <Link className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-ink px-4 text-sm font-semibold text-ink hover:bg-ink hover:text-white" to="/">Continue shopping</Link>
        </ResultFrame>
      : pendingVerification ? <ResultFrame icon={<AlertTriangle className="h-9 w-9 text-brass" />} title="Payment verification is pending" description="We have not received a final result from eSewa. Check again, retry payment, or cancel the unpaid order.">
          {error && <p className="mb-4 text-sm text-seal" role="alert">{error}</p>}
          <Button className="mb-3 w-full" variant="quiet" onClick={() => void loadOrder()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Check status again</Button>
          {paymentActions}
        </ResultFrame>
      : <ResultFrame icon={<XCircle className="h-9 w-9 text-seal" />} title="Payment was not completed" description="eSewa did not complete the payment. Your order is still saved and has not been cancelled.">
          {error && <p className="mb-4 text-sm text-seal" role="alert">{error}</p>}
          {paymentActions}
          <Link className="mt-5 inline-flex min-h-11 items-center justify-center px-4 text-sm font-semibold text-ink underline underline-offset-4" to="/my-orders">View my orders</Link>
        </ResultFrame>}
  </>;
}
