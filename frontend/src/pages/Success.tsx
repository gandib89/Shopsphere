import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, XCircle } from 'lucide-react';
import jsPDF from 'jspdf';
import { toast } from 'sonner';
import NavBar from '../components/NavBar';
import { Button } from '../components/ui/Button';
import { ErrorState, LoadingState } from '../components/ui/AsyncState';
import { authFetch } from '../lib/session';

interface PaymentRecord { id: string; status: 'Initiated' | 'Succeeded' | 'Failed' }
interface OrderDetails {
  _id: string;
  status: string;
  firstName: string;
  lastName: string;
  email: string;
  totalPrice: number;
  quantity: number;
  deliveryDate: string;
  product: { _id: string; name: string; price: number };
  variants?: { storage?: string; color?: string; ram?: string };
  color?: string;
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
    <section className="w-full max-w-xl border border-hairline bg-paper-raised px-5 py-9 text-center sm:px-10" aria-labelledby="payment-result-title">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-current" aria-hidden="true">{icon}</div>
      <h1 id="payment-result-title" className="text-3xl font-bold text-ink sm:text-4xl">{title}</h1>
      <p className="mx-auto mt-3 max-w-md leading-relaxed text-ink-muted">{description}</p>
      {children && <div className="mt-7">{children}</div>}
    </section>
  </main>
);

export default function Success() {
  const { orderId } = useParams();
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      if (!response.ok) {
        let message = response.status === 401 ? 'Please sign in again to verify this order.' : 'We could not verify this order.';
        try { const body = await response.json(); message = body.message || message; } catch {}
        throw new Error(message);
      }
      setOrder(await response.json());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'We could not verify this order.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { void loadOrder(); }, [loadOrder]);

  const downloadReceipt = () => {
    if (!order) return;
    try {
      const document = new jsPDF();
      document.setFontSize(22);
      document.text('ShopSphere receipt', 20, 24);
      document.setFontSize(11);
      document.text(`Order: ${order._id}`, 20, 42);
      document.text(`Customer: ${order.firstName} ${order.lastName}`, 20, 50);
      document.text(`Product: ${order.product.name}`, 20, 58);
      document.text(`Quantity: ${order.quantity}`, 20, 66);
      document.text(`Total: Rs. ${Number(order.totalPrice).toLocaleString()}`, 20, 74);
      document.text(`Status: ${order.status}`, 20, 82);
      document.save(`ShopSphere-Receipt-${order._id.slice(-8)}.pdf`);
      toast.success('Receipt downloaded');
    } catch {
      toast.error('Could not generate the receipt. Please try again.');
    }
  };

  const paymentStatus = order?.payments?.[0]?.status;
  const verified = paymentStatus === 'Succeeded' && order?.status !== 'Pending' && order?.status !== 'Cancelled';
  const pending = paymentStatus === 'Initiated' || (paymentStatus === 'Succeeded' && order?.status === 'Pending');

  return <>
    <NavBar />
    {loading ? <main className="min-h-[calc(100dvh-5rem)] bg-paper"><LoadingState description="Verifying payment with ShopSphere…" /></main>
      : error ? <main className="min-h-[calc(100dvh-5rem)] bg-paper"><ErrorState title="We could not verify this payment" description={error} action={<Button onClick={() => void loadOrder()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} /></main>
      : verified && order ? <ResultFrame icon={<CheckCircle2 className="h-9 w-9 text-moss" />} title="Order Successful!" description="eSewa verified your payment and your order is confirmed.">
          <dl className="grid gap-3 border border-hairline bg-paper p-5 text-left text-sm sm:grid-cols-2">
            <div><dt className="text-ink-muted">Order</dt><dd className="mt-1 font-mono font-semibold text-ink">#{order._id.slice(-8)}</dd></div>
            <div><dt className="text-ink-muted">Total paid</dt><dd className="mt-1 font-semibold text-ink">Rs. {Number(order.totalPrice).toLocaleString()}</dd></div>
            <div className="sm:col-span-2"><dt className="text-ink-muted">Product</dt><dd className="mt-1 font-semibold text-ink">{order.product.name} × {order.quantity}</dd></div>
          </dl>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            <Button onClick={downloadReceipt}><Download className="h-4 w-4" aria-hidden="true" />Download receipt</Button>
            <Link className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-ink px-4 text-sm font-semibold text-ink hover:bg-ink hover:text-white" to={`/order/${order._id}`}>View order</Link>
          </div>
        </ResultFrame>
      : pending ? <ResultFrame icon={<AlertTriangle className="h-9 w-9 text-brass" />} title="Payment verification is pending" description="eSewa has not confirmed this payment yet. Your order has not been marked as paid.">
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button onClick={() => void loadOrder()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Check again</Button>
            <Link className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-ink px-4 text-sm font-semibold text-ink hover:bg-ink hover:text-white" to={`/failure/${orderId}`}>Payment options</Link>
          </div>
        </ResultFrame>
      : <ResultFrame icon={<XCircle className="h-9 w-9 text-seal" />} title="Payment was not verified" description="ShopSphere did not receive a verified eSewa payment for this order.">
          <Link className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-brass bg-brass px-4 text-sm font-semibold text-white hover:bg-brass-dark" to={`/failure/${orderId}`}>Review payment options</Link>
        </ResultFrame>}
  </>;
}
