import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Tag, X } from 'lucide-react';
import NavBar from '../components/NavBar';
import { PageHeader } from '../components/operations/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/AsyncState';
import { Field, SelectField } from '../components/ui/Field';
import { startESewaCheckout } from '../lib/esewa';
import { authFetch } from '../lib/session';
import { getImageUrl } from '../lib/utils';

interface CartItem {
  _id: string;
  product: { id: string; name: string; price: number; image?: string; images?: string[] };
  quantity: number;
  price: number;
  variants?: Record<string, string>;
}
interface Cart { _id: string; email: string; items: CartItem[]; totalPrice: number }
type Details = { firstName: string; lastName: string; email: string; phone: string; street: string; city: string; state: string; zipCode: string; country: string; deliveryDate: string };
type ProfileDefaults = { firstName?: string; lastName?: string; email?: string; phone?: string; homeStreet?: string; homeCity?: string; homeState?: string; homeZipCode?: string };
type FieldErrors = Partial<Record<keyof Details, string>>;

const provinces = ['Koshi', 'Madhesh', 'Bagmati', 'Gandaki', 'Lumbini', 'Karnali', 'Sudurpashchim'];
const fieldClass = 'w-full rounded-[var(--radius-control)] border border-hairline bg-paper px-4 py-3 text-ink transition-colors focus:border-brass';
const today = () => new Date(Date.now() + 86400000).toISOString().split('T')[0];
const apiMessage = (error: unknown, fallback: string) => axios.isAxiosError(error) ? error.response?.data?.message || fallback : error instanceof Error ? error.message : fallback;

export default function CartCheckout() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [details, setDetails] = useState<Details>({ firstName: '', lastName: '', email: '', phone: '', street: '', city: '', state: '', zipCode: '', country: 'Nepal', deliveryDate: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [promoCode, setPromoCode] = useState('');
  const [promoError, setPromoError] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discountAmount: number } | null>(null);
  const [validatingPromo, setValidatingPromo] = useState(false);

  const fetchCart = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const [response, profileResponse] = await Promise.all([
        axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/v1/cart/get`),
        authFetch(`${import.meta.env.VITE_BACKEND_URL}/api/v1/auth/me`).catch(() => null),
      ]);
      const next = response.data.data as Cart;
      const profile = profileResponse?.ok ? await profileResponse.json() as ProfileDefaults : null;
      setCart(next);
      setDetails(previous => ({
        ...previous,
        firstName: profile?.firstName || previous.firstName,
        lastName: profile?.lastName || previous.lastName,
        email: profile?.email || next?.email || previous.email,
        phone: profile?.phone || previous.phone,
        street: profile?.homeStreet || previous.street,
        city: profile?.homeCity || previous.city,
        state: profile?.homeState || previous.state,
        zipCode: profile?.homeZipCode || previous.zipCode,
      }));
    } catch (error) {
      setLoadError(apiMessage(error, 'We could not load your cart. Please try again.'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!token) { navigate('/auth', { replace: true }); return; }
    void fetchCart();
  }, [fetchCart, navigate, token]);

  const update = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const key = event.target.name as keyof Details;
    setDetails(previous => ({ ...previous, [key]: event.target.value }));
    setErrors(previous => ({ ...previous, [key]: undefined }));
  };

  const validate = () => {
    const next: FieldErrors = {};
    if (!details.firstName.trim()) next.firstName = 'Enter your first name.';
    if (!details.lastName.trim()) next.lastName = 'Enter your last name.';
    if (!/^\S+@\S+\.\S+$/.test(details.email)) next.email = 'Enter a valid email address.';
    if (!/^(\+977[- ]?)?9\d{9}$/.test(details.phone.replace(/\s/g, ''))) next.phone = 'Enter a valid Nepali mobile number.';
    if (!details.street.trim()) next.street = 'Enter a street, ward, or local address.';
    if (!details.city.trim()) next.city = 'Enter your municipality or city.';
    if (!details.state) next.state = 'Select a province.';
    if (!details.deliveryDate) next.deliveryDate = 'Choose a preferred delivery date.';
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    return !first;
  };

  const applyPromo = async () => {
    if (!promoCode.trim()) { setPromoError('Enter a promo code.'); return; }
    if (!cart) return;
    setValidatingPromo(true); setPromoError('');
    try {
      const response = await axios.post(`${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/validate`, { code: promoCode, purchaseAmount: cart.totalPrice });
      setAppliedPromo({ code: response.data.promoCode.code, discountAmount: response.data.discountAmount });
    } catch (error) { setPromoError(apiMessage(error, 'This promo code is not valid.')); }
    finally { setValidatingPromo(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!cart?.items.length || !validate()) return;
    setSubmitting(true); setSubmitError('');
    try {
      const response = await axios.post(`${import.meta.env.VITE_BACKEND_URL}/api/v1/order/createBulkOrder`, {
        ...details,
        deliveryDate: new Date(details.deliveryDate).toISOString(),
        cartItems: cart.items.map(item => ({ productId: item.product.id, quantity: item.quantity, variants: item.variants || {}, color: item.variants?.color })),
        deliveryAddress: { street: details.street, city: details.city, state: details.state, zipCode: details.zipCode, country: 'Nepal' },
        promoCode: appliedPromo,
      });
      await startESewaCheckout(response.data.order.id);
    } catch (error) {
      setSubmitError(apiMessage(error, 'Checkout could not be started. Your cart is unchanged; please try again.'));
      setSubmitting(false);
    }
  };

  if (loading) return <><NavBar /><main className="min-h-screen bg-paper"><LoadingState description="Preparing checkout…" /></main></>;
  if (loadError) return <><NavBar /><main className="min-h-screen bg-paper"><ErrorState title="We could not load checkout" description={loadError} action={<Button onClick={() => void fetchCart()}>Try again</Button>} /></main></>;
  if (!cart?.items.length) return <><NavBar /><main className="min-h-screen bg-paper"><EmptyState title="Your cart is empty" description="Add an item before starting checkout." action={<Button onClick={() => navigate('/')}>Browse products</Button>} /></main></>;

  const subtotal = Number(cart.totalPrice);
  const total = Math.max(0, subtotal - Number(appliedPromo?.discountAmount || 0));

  return <><NavBar /><main className="min-h-screen bg-paper pb-12">
    <PageHeader eyebrow="Secure checkout" title="Delivery and payment" description="Review your order, add delivery details, then continue to eSewa." action={<Button variant="quiet" onClick={() => navigate('/cart')}>Back to cart</Button>} />
    <div className="container-store py-7 sm:py-10">
      <ol className="mb-7 grid grid-cols-3 border border-hairline bg-paper-raised text-center text-xs font-semibold sm:text-sm" aria-label="Checkout progress">
        <li className="border-r border-hairline bg-brass/10 px-2 py-3 text-brass" aria-current="step">1. Delivery</li><li className="border-r border-hairline px-2 py-3 text-ink-muted">2. Review</li><li className="px-2 py-3 text-ink-muted">3. Pay with eSewa</li>
      </ol>
      <form onSubmit={submit} noValidate className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-7">
          <section className="rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-5 sm:p-7" aria-labelledby="items-title">
            <div className="flex items-baseline justify-between gap-4"><h2 id="items-title" className="text-xl font-semibold text-ink">Review your order</h2><strong className="font-mono text-lg text-ink">Rs. {total.toLocaleString()}</strong></div>
            <div className="mt-5 divide-y divide-hairline border-y border-hairline">{cart.items.map(item => <article key={item._id} className="flex gap-4 py-4">
              <img src={getImageUrl(item.product.image || item.product.images?.[0])} alt="" className="h-16 w-16 shrink-0 object-cover" />
              <div className="min-w-0 flex-1"><h3 className="font-semibold text-ink">{item.product.name}</h3><p className="mt-1 text-sm text-ink-muted">Quantity {item.quantity}{item.variants && Object.values(item.variants).filter(Boolean).length ? ` · ${Object.values(item.variants).filter(Boolean).join(' · ')}` : ''}</p></div>
              <strong className="font-mono text-sm text-ink">Rs. {(Number(item.price || item.product.price) * item.quantity).toLocaleString()}</strong>
            </article>)}</div>
          </section>
          <section className="rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-5 sm:p-7" aria-labelledby="delivery-title">
            <h2 id="delivery-title" className="text-xl font-semibold text-ink">Delivery details</h2><p className="mt-1 text-sm text-ink-muted">Fields marked required must be completed.</p>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <Field id="first-name" name="firstName" label="First name" required autoComplete="given-name" value={details.firstName} onChange={update} error={errors.firstName} className={fieldClass} />
              <Field id="last-name" name="lastName" label="Last name" required autoComplete="family-name" value={details.lastName} onChange={update} error={errors.lastName} className={fieldClass} />
              <Field id="checkout-email" name="email" label="Email" required type="email" autoComplete="email" value={details.email} onChange={update} error={errors.email} className={fieldClass} />
              <Field id="checkout-phone" name="phone" label="Mobile number" required type="tel" autoComplete="tel" placeholder="98XXXXXXXX" value={details.phone} onChange={update} hint="Nepali mobile number, for delivery updates." error={errors.phone} className={fieldClass} />
              <div className="sm:col-span-2"><Field id="street" name="street" label="Street, ward, or local address" required autoComplete="street-address" value={details.street} onChange={update} error={errors.street} className={fieldClass} /></div>
              <Field id="city" name="city" label="Municipality or city" required autoComplete="address-level2" value={details.city} onChange={update} error={errors.city} className={fieldClass} />
              <SelectField id="province" name="state" label="Province" required autoComplete="address-level1" value={details.state} onChange={update} error={errors.state} className={fieldClass}><option value="">Select province</option>{provinces.map(province => <option key={province}>{province}</option>)}</SelectField>
              <Field id="postal-code" name="zipCode" label="Postal code" autoComplete="postal-code" value={details.zipCode} onChange={update} hint="Optional" className={fieldClass} />
              <Field id="country" name="country" label="Country" value="Nepal" readOnly className={`${fieldClass} text-ink-muted`} />
              <div className="sm:col-span-2"><Field id="delivery-date" name="deliveryDate" label="Preferred delivery date" required type="date" min={today()} value={details.deliveryDate} onChange={update} hint="The seller will confirm the final delivery date." error={errors.deliveryDate} className={fieldClass} /></div>
            </div>
          </section>
        </div>
        <aside className="h-fit rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-5 lg:sticky lg:top-24" aria-label="Order total">
          <h2 className="text-xl font-semibold text-ink">Order total</h2>
          <dl className="mt-5 space-y-3 text-sm"><div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd className="font-mono text-ink">Rs. {subtotal.toLocaleString()}</dd></div>{appliedPromo && <div className="flex justify-between text-moss"><dt>Promo ({appliedPromo.code})</dt><dd className="font-mono">− Rs. {Number(appliedPromo.discountAmount).toLocaleString()}</dd></div>}<div className="flex justify-between border-t border-hairline pt-4 text-base font-semibold"><dt>Total</dt><dd className="font-mono">Rs. {total.toLocaleString()}</dd></div></dl>
          <div className="mt-6"><label htmlFor="promo-code" className="text-sm font-semibold text-ink">Promo code</label><div className="mt-2 flex gap-2"><input id="promo-code" value={promoCode} disabled={!!appliedPromo} onChange={event => { setPromoCode(event.target.value.toUpperCase()); setPromoError(''); }} className={`${fieldClass} min-w-0`} />{appliedPromo ? <Button type="button" variant="quiet" aria-label={`Remove promo code ${appliedPromo.code}`} onClick={() => { setAppliedPromo(null); setPromoCode(''); }}><X className="h-4 w-4" aria-hidden="true" /></Button> : <Button type="button" variant="secondary" loading={validatingPromo} onClick={() => void applyPromo()}><Tag className="h-4 w-4" aria-hidden="true" />Apply</Button>}</div>{promoError && <p className="mt-2 text-sm text-seal" role="alert">{promoError}</p>}</div>
          {submitError && <p className="mt-5 border border-seal/30 bg-seal/5 p-3 text-sm text-seal" role="alert">{submitError}</p>}
          <Button className="mt-6 w-full" size="lg" type="submit" loading={submitting}>{submitting ? 'Creating order and opening eSewa…' : `Continue to eSewa — Rs. ${total.toLocaleString()}`}</Button>
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">You’ll continue to eSewa to authorize payment. ShopSphere never receives your eSewa password.</p>
        </aside>
      </form>
    </div>
  </main></>;
}
