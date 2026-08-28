import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { Loader, Tag, X } from "lucide-react";
import NavBar from "../components/NavBar";
import { PageHeader } from "../components/operations/PageHeader";
import { Button } from "../components/ui/Button";
import { EmptyState, LoadingState } from "../components/ui/AsyncState";

interface CartItem {
  _id: string;
  product: {
    id: string;
    name: string;
    price: number;
    image?: string;
  };
  quantity: number;
  price: number;
  variants?: Record<string, string>;
  addedAt: string;
}

interface Cart {
  _id: string;
  user: string;
  email: string;
  items: CartItem[];
  totalPrice: number;
}

function CartCheckout() {
  const navigate = useNavigate();
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const token = localStorage.getItem("token");

  const [userDetails, setUserDetails] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    street: "",
    city: "",
    state: "",
    zipCode: "",
    country: "",
    deliveryDate: "",
  });

  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discountAmount: number;
  } | null>(null);
  const [validatingPromo, setValidatingPromo] = useState(false);

  useEffect(() => {
    if (!token) {
      toast.error("Please login to proceed with checkout");
      navigate("/auth");
      return;
    }
    fetchCart();
  }, [token, navigate]);

  const fetchCart = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/cart/get`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setCart(response.data.data);
      // Pre-fill email if available
      if (response.data.data?.email) {
        setUserDetails((prev) => ({
          ...prev,
          email: response.data.data.email,
        }));
      }
      setLoading(false);
    } catch (error) {
      console.error("Error fetching cart:", error);
      toast.error("Failed to load cart");
      setLoading(false);
    }
  };

  const validatePromoCode = async () => {    if (!promoCode.trim()) {
      toast.error("Please enter a promo code");
      return;
    }

    if (!cart) {
      toast.error("Cart not loaded");
      return;
    }

    setValidatingPromo(true);
    try {
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/validate`,
        {
          code: promoCode,
          purchaseAmount: cart.totalPrice,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.data.success) {
        setAppliedPromo({
          code: response.data.promoCode.code,
          discountAmount: response.data.discountAmount,
        });
        toast.success(`Promo code applied! You saved Rs. ${response.data.discountAmount}`);
      }
    } catch (error: any) {
      console.error("Promo code validation error:", error);
      toast.error(error.response?.data?.message || "Invalid promo code");
    } finally {
      setValidatingPromo(false);
    }
  };

  const removePromoCode = () => {
    setAppliedPromo(null);
    setPromoCode("");
    toast.info("Promo code removed");
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      toast.error("Please login to proceed with checkout");
      navigate("/auth");
      return;
    }

    if (!cart || cart.items.length === 0) {
      toast.error("Your cart is empty");
      return;
    }

    if (!userDetails.firstName || !userDetails.lastName || !userDetails.email) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (!userDetails.phone || !userDetails.street || !userDetails.city || !userDetails.state || !userDetails.zipCode || !userDetails.country) {
      toast.error("Please fill complete delivery address");
      return;
    }

    if (!userDetails.deliveryDate) {
      toast.error("Please select a preferred delivery date");
      return;
    }

    setSubmitting(true);

    try {
      // Apply promo code usage if discount is applied
      if (appliedPromo?.code) {
        try {
          await axios.post(
            `${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/apply`,
            { code: appliedPromo.code },
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );
        } catch (promoError) {
          console.error("Error applying promo code:", promoError);
          // Continue even if promo apply fails
        }
      }

      // Create orders for ALL cart items (grouped together)
      const cartItemsPayload = cart.items.map(item => ({
        productId: item.product.id,
        quantity: item.quantity,
        variants: item.variants || {},
        color: item.variants?.color,
      }));

      const orderPayload = {
        firstName: userDetails.firstName,
        lastName: userDetails.lastName,
        email: userDetails.email,
        phone: userDetails.phone,
        deliveryDate: new Date(userDetails.deliveryDate || new Date()).toISOString(),
        cartItems: cartItemsPayload,
        deliveryAddress: {
          street: userDetails.street,
          city: userDetails.city,
          state: userDetails.state,
          zipCode: userDetails.zipCode,
          country: userDetails.country,
        },
        promoCode: appliedPromo ? {
          code: appliedPromo.code,
          discountAmount: appliedPromo.discountAmount,
        } : null,
      };

      const orderResponse = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/createBulkOrder`,
        orderPayload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const responseData = orderResponse.data;
      const orderId = responseData.order.id; // Primary order for payment

      // Ask the backend to sign the eSewa checkout fields — it recomputes the amount from the
      // orders in the DB (incl. promo discount) and signs with a secret that never reaches the browser.
      const backendBase = (import.meta.env.VITE_BACKEND_URL as string).replace('/api', '');
      const checkoutRes = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/payment/checkout`,
        { orderId },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Idempotency-Key": uuidv4(),
          },
        }
      );
      const {
        transactionUuid, signature, signedFieldNames, productCode,
        amount, taxAmount, totalAmount, formActionUrl,
      } = checkoutRes.data;

      const form = document.createElement("form");
      form.action = formActionUrl;
      form.method = "POST";

      const inputs = {
        amount: amount.toString(),
        tax_amount: taxAmount.toString(),
        product_service_charge: "0",
        product_delivery_charge: "0",
        total_amount: totalAmount.toString(),
        transaction_uuid: transactionUuid,
        product_code: productCode,
        success_url: `${backendBase}/api/v1/payment/esewa/success/${orderId}`,
        failure_url: `${backendBase}/api/v1/payment/esewa/failure/${orderId}`,
        signed_field_names: signedFieldNames,
        signature,
      };

      Object.entries(inputs).forEach(([key, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        form.appendChild(input);
      });

      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
    } catch (error) {
      console.error("Checkout error:", error);
      const errorMsg =
        error instanceof Error && error.message
          ? error.message
          : "Checkout failed. Please try again.";
      toast.error(errorMsg);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <>
        <NavBar />
        <main className="min-h-screen bg-paper"><LoadingState description="Preparing checkout" /></main>
      </>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <>
        <NavBar />
        <main className="min-h-screen bg-paper">
          <EmptyState title="Your cart is empty" description="Add an item before starting checkout." action={<Button onClick={() => navigate("/")}>Browse products</Button>} />
        </main>
      </>
    );
  }

  return (
    <>
      <NavBar />
      <main className="min-h-screen bg-paper">
        <PageHeader
          eyebrow="Secure checkout"
          title="Delivery and payment"
          description="Confirm your order and tell us where to deliver it."
          action={<Button variant="quiet" onClick={() => navigate("/cart")}>Back to cart</Button>}
        />
        <div className="container-store py-7 sm:py-10">

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Order Summary */}
            <div className="lg:col-span-2">
              <div className="rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-4 shadow-sm sm:p-8">
                <h2 className="text-2xl font-bold text-ink mb-6">Order Items</h2>

                <div className="mb-8 divide-y divide-hairline overflow-hidden rounded-[var(--radius-control)] border border-hairline">
                  {cart.items.map((item) => (
                    <div
                      key={item._id}
                      className="flex items-center justify-between p-4"
                    >
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-ink">
                          {item.product.name}
                        </h3>
                        <p className="text-sm text-ink-muted font-mono tabular-nums">
                          Quantity: {item.quantity}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-ink font-mono tabular-nums">
                          Rs. {(item.product.price * item.quantity).toLocaleString()}
                        </p>
                        <p className="text-sm text-ink-muted font-mono tabular-nums">
                          Rs. {item.product.price.toLocaleString()} each
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* User Details Form */}
                <h2 className="text-2xl font-bold text-ink mb-6 mt-8">
                  Delivery Details
                </h2>

                <form onSubmit={handleCheckout} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-ink font-semibold mb-2">
                        First Name *
                      </label>
                      <input
                        type="text"
                        placeholder="Enter first name"
                        value={userDetails.firstName}
                        onChange={(e) =>
                          setUserDetails({
                            ...userDetails,
                            firstName: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-ink font-semibold mb-2">
                        Last Name *
                      </label>
                      <input
                        type="text"
                        placeholder="Enter last name"
                        value={userDetails.lastName}
                        onChange={(e) =>
                          setUserDetails({
                            ...userDetails,
                            lastName: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-ink font-semibold mb-2">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        placeholder="Enter email address"
                        value={userDetails.email}
                        onChange={(e) =>
                          setUserDetails({
                            ...userDetails,
                            email: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-ink font-semibold mb-2">
                        Phone Number *
                      </label>
                      <input
                        type="tel"
                        placeholder="Enter phone number"
                        value={userDetails.phone}
                        onChange={(e) =>
                          setUserDetails({
                            ...userDetails,
                            phone: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-ink font-semibold mb-2">
                        Street Address *
                      </label>
                      <input
                        type="text"
                        placeholder="123 Main St"
                        value={userDetails.street}
                        onChange={(e) =>
                          setUserDetails({
                            ...userDetails,
                            street: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-ink font-semibold mb-2">
                        City *
                      </label>
                      <input
                        type="text"
                        placeholder="City"
                        value={userDetails.city}
                        onChange={(e) =>
                          setUserDetails({
                            ...userDetails,
                            city: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-ink font-semibold mb-2">
                        State/Province *
                      </label>
                      <input
                        type="text"
                        placeholder="State"
                        value={userDetails.state}
                        onChange={(e) =>
                          setUserDetails({
                            ...userDetails,
                            state: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-ink font-semibold mb-2">
                        Zip/Postal Code *
                      </label>
                      <input
                        type="text"
                        placeholder="Zip Code"
                        value={userDetails.zipCode}
                        onChange={(e) =>
                          setUserDetails({
                            ...userDetails,
                            zipCode: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-ink font-semibold mb-2">
                        Country *
                      </label>
                      <input
                        type="text"
                        placeholder="Country"
                        value={userDetails.country}
                        onChange={(e) =>
                          setUserDetails({
                            ...userDetails,
                            country: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-ink font-semibold mb-2">
                        Preferred Delivery Date *
                      </label>
                      <input
                        type="date"
                        value={userDetails.deliveryDate}
                        min={new Date().toISOString().split('T')[0]}
                        onChange={(e) =>
                          setUserDetails({
                            ...userDetails,
                            deliveryDate: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brass px-4 py-3 font-semibold text-white transition hover:bg-brass-dark disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader className="w-5 h-5 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      "Proceed to Payment"
                    )}
                  </button>
                </form>
              </div>
            </div>

            {/* Order Summary Sidebar */}
            <div className="lg:col-span-1">
              <div className="sticky top-24 h-fit rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-4 shadow-sm sm:p-8">
                <h3 className="text-xl font-bold text-ink mb-6">Order Summary</h3>

                {/* Promo Code Section */}
                <div className="mb-6 rounded-[var(--radius-control)] border border-hairline bg-paper p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Tag className="w-4 h-4 text-brass" />
                    <span className="text-sm font-semibold text-ink">Have a promo code?</span>
                  </div>
                  {!appliedPromo ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter code"
                        value={promoCode}
                        onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                        className="flex-1 px-3 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-sm"
                      />
                      <button
                        type="button"
                        onClick={validatePromoCode}
                        disabled={validatingPromo}
                        className="rounded-[var(--radius-control)] bg-brass px-4 py-2 text-sm font-semibold text-white transition hover:bg-brass-dark disabled:opacity-50"
                      >
                        {validatingPromo ? "..." : "Apply"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-[var(--radius-control)] border border-moss bg-paper p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-moss font-semibold text-sm font-mono tabular-nums">{appliedPromo.code}</span>
                        <span className="text-moss text-xs">Applied</span>
                      </div>
                      <button
                        type="button"
                        onClick={removePromoCode}
                        className="text-seal hover:text-seal active:scale-[0.97] transition"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-4 mb-6">
                  <div className="flex justify-between items-center">
                    <span className="text-ink-muted">Subtotal</span>
                    <span className="font-semibold text-ink font-mono tabular-nums">
                      Rs. {cart.totalPrice.toLocaleString()}
                    </span>
                  </div>
                  {appliedPromo && (
                    <div className="flex justify-between items-center text-moss">
                      <span className="flex items-center gap-1">
                        <Tag className="w-4 h-4" />
                        Promo Discount
                      </span>
                      <span className="font-semibold font-mono tabular-nums">
                        - Rs. {appliedPromo.discountAmount.toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-ink-muted">Shipping</span>
                    <span className="font-semibold text-moss">FREE</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-ink-muted">Tax</span>
                    <span className="font-semibold text-ink">-</span>
                  </div>
                  <div className="border-t border-hairline pt-4 flex justify-between items-center">
                    <span className="text-lg font-bold text-ink">Total</span>
                    <span className="text-2xl font-bold text-ink font-mono tabular-nums">
                      Rs. {(cart.totalPrice - (appliedPromo?.discountAmount || 0)).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="rounded-[var(--radius-control)] border border-hairline bg-paper p-4 text-sm text-ink-muted">
                  <p className="font-semibold mb-2 text-ink">Items in Cart</p>
                  <p className="text-ink-muted font-mono tabular-nums">{cart.items.length} product(s)</p>
                </div>

                <div className="mt-6 pt-6 border-t border-hairline">
                  <p className="text-xs text-ink-muted text-center">
                    Your payment information is secure and encrypted
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

export default CartCheckout;
