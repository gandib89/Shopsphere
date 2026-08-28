import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Trash2, Plus, Minus } from "lucide-react";
import NavBar from "../components/NavBar";
import { PageHeader } from "../components/operations/PageHeader";
import { Button, IconButton } from "../components/ui/Button";
import { EmptyState, LoadingState } from "../components/ui/AsyncState";
import { CartSummary } from "../components/checkout/CartSummary";

interface CartItem {
  _id: string;
  product: {
    id: string;
    name: string;
    price: number;
    image?: string;
    category?: string;
  };
  quantity: number;
  price: number;
  variants?: Record<string, string>;
}

interface CartData {
  items: CartItem[];
  totalPrice: number;
}

function Cart() {
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartData>({ items: [], totalPrice: 0 });
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string>("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/auth");
      return;
    }
    setToken(token);
  }, [navigate]);

  useEffect(() => {
    if (token) {
      loadCart();
    }
  }, [token]);

  const loadCart = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/cart/get`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.data?.data) {
        setCart({
          items: response.data.data.items || [],
          totalPrice: response.data.data.totalPrice || 0,
        });
      }
      setLoading(false);
    } catch (error: any) {
      console.error("❌ Error loading cart:", error.response?.data || error.message);
      console.error("Status:", error.response?.status);
      console.error("Full error:", error);

      const status = error.response?.status;
      const message = error.response?.data?.message || error.message || "Cart error";

      // If token invalid/expired, force re-login
      if (status === 401 || status === 403) {
        toast.error("Session expired. Please log in again.");
        localStorage.removeItem("token");
        localStorage.removeItem("isAdmin");
        localStorage.removeItem("isSeller");
        localStorage.removeItem("userId");
        navigate("/auth");
        return;
      }

      toast.error(`Cart Error: ${message}`);
      setCart({ items: [], totalPrice: 0 });
      setLoading(false);
    }
  };

  const updateQuantity = async (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }

    try {
      await axios.put(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/cart/update`,
        { productId, quantity },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await loadCart();
      toast.success("Cart updated");
    } catch (error) {
      toast.error("Failed to update cart");
    }
  };

  const removeItem = async (productId: string) => {
    try {
      await axios.delete(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/cart/remove/${productId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await loadCart();
      toast.success("Item removed");
    } catch (error) {
      toast.error("Failed to remove item");
    }
  };

  const handleCheckout = () => {
    if (cart.items.length === 0) {
      toast.error("Your cart is empty!");
      return;
    }
    navigate("/cart-checkout");
  };

  if (loading) {
    return (
      <>
        <NavBar />
        <main className="min-h-screen bg-paper">
          <LoadingState description="Loading your cart" />
        </main>
      </>
    );
  }

  return (
    <>
      <NavBar />
      <main className="min-h-screen bg-paper">
        <PageHeader
          eyebrow="Your order"
          title="Shopping cart"
          description={cart.items.length ? `${cart.items.length} ${cart.items.length === 1 ? 'item' : 'items'} ready for checkout.` : 'Review saved items before checkout.'}
          action={<Button variant="quiet" onClick={() => navigate("/")}>Continue shopping</Button>}
        />

        <div className="container-store py-7 sm:py-10">
          {cart.items.length === 0 ? (
            <EmptyState
              title="Your cart is empty"
              description="Browse the marketplace and add a product when you are ready."
              action={<Button onClick={() => navigate("/")}>Browse products</Button>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <section aria-labelledby="cart-items-title">
                <h2 id="cart-items-title" className="sr-only">Cart items</h2>
                <div className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-surface)] border border-hairline bg-paper-raised shadow-sm">
                  {cart.items.map((item) => (
                    <article key={item._id} className="p-4 sm:p-6">
                      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-base font-semibold text-ink sm:text-lg">
                            {item.product.name}
                          </h3>
                          {item.variants && Object.keys(item.variants).length > 0 && (
                            <p className="mt-1 text-sm text-ink-muted">
                              {Object.entries(item.variants)
                                .map(([key, value]) => `${key}: ${value}`)
                                .join(", ")}
                            </p>
                          )}
                          <p className="mt-2 tabular-nums text-sm font-medium text-ink sm:text-base">
                            Rs. {item.price.toLocaleString()}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
                          <div aria-label={`Quantity for ${item.product.name}`} className="flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline p-1">
                            <IconButton
                              label={`Decrease ${item.product.name} quantity`}
                              size="sm"
                              onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                              className="h-9 w-9 min-h-9"
                            >
                              <Minus className="w-4 h-4" />
                            </IconButton>
                            <span className="w-7 text-center text-sm font-semibold tabular-nums text-ink">
                              {item.quantity}
                            </span>
                            <IconButton
                              label={`Increase ${item.product.name} quantity`}
                              size="sm"
                              onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                              className="h-9 w-9 min-h-9"
                            >
                              <Plus className="w-4 h-4" />
                            </IconButton>
                          </div>

                          <div className="min-w-28 text-right">
                            <p className="text-xs text-ink-muted">Subtotal</p>
                            <p className="text-base font-semibold tabular-nums text-ink">
                              Rs. {(item.price * item.quantity).toLocaleString()}
                            </p>
                          </div>

                          <IconButton
                            label={`Remove ${item.product.name} from cart`}
                            variant="quiet"
                            onClick={() => removeItem(item.product.id)}
                            className="text-seal hover:border-seal/20 hover:bg-seal/5"
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                <Button variant="quiet" onClick={() => navigate("/")} className="mt-5">Continue shopping</Button>
              </section>

              <CartSummary itemCount={cart.items.length} subtotal={cart.totalPrice} onCheckout={handleCheckout} />
            </div>
          )}
        </div>
      </main>
    </>
  );
}

export default Cart;
