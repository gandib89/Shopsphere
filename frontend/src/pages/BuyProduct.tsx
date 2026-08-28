import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { getImageUrl } from "../lib/utils";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { ShoppingCart, Heart, Tag, X, Loader2, Check } from "lucide-react";
import NavBar from "../components/NavBar";

interface Product {
  _id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  images: string[];
  quantity?: number; // Stock/inventory
  variants?: {
    storage?: string[];
    color?: string[];
    ram?: string[];
    screenSize?: string[];
    processor?: string[];
  };
}

function BuyProduct() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const productId = searchParams.get("productId") || "";
  const navigate = useNavigate();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [selectedVariants, setSelectedVariants] = useState<{
    [key: string]: string;
  }>({});
  const [isFavorite, setIsFavorite] = useState(false);
  const [userDetails, setUserDetails] = useState({
    firstName: "",
    lastName: "",
    email: "",
  });

  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discountAmount: number;
  } | null>(null);
  const [validatingPromo, setValidatingPromo] = useState(false);

  const token = localStorage.getItem("token");
  const totalPrice = quantity * (product?.price || 0);
  const finalPrice = totalPrice - (appliedPromo?.discountAmount || 0);

  useEffect(() => {
    handleFetch();
  }, [productId, token]);

  const handleFetch = async () => {
    if (!productId) return;
    try {
      setLoading(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/get/${productId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setProduct(response.data);
    } catch (error) {
      console.error("Error fetching product data:", error);
      toast.error("Failed to load product details");
    } finally {
      setLoading(false);
    }
  };

  const validatePromoCode = async () => {
    if (!promoCode.trim()) {
      toast.error("Please enter a promo code");
      return;
    }

    setValidatingPromo(true);
    try {
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/validate`,
        {
          code: promoCode,
          purchaseAmount: totalPrice,
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


  const handleAddToCart = async () => {
    if (!token) {
      toast.error("Please login to add items to cart");
      navigate("/auth");
      return;
    }

    try {
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/cart/add`,
        {
          productId: product?._id,
          quantity,
          variants: selectedVariants,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.status === 200 || response.status === 201) {
        toast.success(`${product?.name || 'Item'} added to cart ✅`);
      }
    } catch (error) {
      console.error("Error adding to cart:", error);
      toast.error("Failed to add to cart");
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      toast.error("Please login to proceed with checkout");
      navigate("/auth");
      return;
    }

    if (!userDetails.firstName || !userDetails.lastName || !userDetails.email) {
      toast.error("Please fill in all required fields");
      return;
    }

    // Validate that required variants are selected
    if (product?.variants) {
      const hasRequiredVariants = Object.entries(product.variants).some(
        ([_, values]) => values && values.length > 0
      );
      
      if (hasRequiredVariants) {
        const missingVariants = Object.entries(product.variants)
          .filter(([key, values]) => values && values.length > 0 && !selectedVariants[key])
          .map(([key]) => key);
        
        if (missingVariants.length > 0) {
          toast.error(`Please select: ${missingVariants.join(", ")}`);
          return;
        }
      }
    }

    // Validate quantity doesn't exceed available stock
    if (quantity > (product?.quantity || 0)) {
      toast.error(`Only ${product?.quantity || 0} items available in stock`);
      return;
    }

    const formattedData = {
      firstName: userDetails.firstName,
      lastName: userDetails.lastName,
      email: userDetails.email,
      product: product?._id,
      quantity,
      deliveryDate: new Date().toISOString(),
      variants: selectedVariants,
      color: selectedVariants.color,
    };

    if (!formattedData.product) {
      toast.error("Product ID is missing. Please refresh and try again.");
      return;
    }

    try {
      setSubmitting(true);
      
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
      
      // Add promo code to order data
      const orderData = {
        ...formattedData,
        promoCode: appliedPromo ? {
          code: appliedPromo.code,
          discountAmount: appliedPromo.discountAmount,
        } : null,
      };
      
      
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/createOrder`,
        orderData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );


      if (response.status === 201) {
        const newOrderId = response.data.order._id;
        toast.success("Order created! Redirecting to payment...");

        // Ask the backend to sign the eSewa checkout fields — it recomputes the amount from
        // the order in the DB and signs with a secret that never reaches the browser.
        setTimeout(async () => {
          try {
            const backendBase = (import.meta.env.VITE_BACKEND_URL as string).replace('/api', '');
            const checkoutRes = await axios.post(
              `${import.meta.env.VITE_BACKEND_URL}/api/v1/payment/checkout`,
              { orderId: newOrderId },
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
              success_url: `${backendBase}/api/v1/payment/esewa/success/${newOrderId}`,
              failure_url: `${backendBase}/api/v1/payment/esewa/failure/${newOrderId}`,
              signed_field_names: signedFieldNames,
              signature,
            };

            Object.entries(inputs).forEach(([key, value]) => {
              const input = document.createElement("input");
              input.type = "hidden";
              input.name = key;
              input.value = value as string;
              form.appendChild(input);
            });

            document.body.appendChild(form);
            form.submit();
          } catch (esewaError) {
            console.error("Error starting eSewa checkout:", esewaError);
            toast.error("Failed to redirect to payment gateway. Please try again.");
            setSubmitting(false);
          }
        }, 500);
      }
    } catch (error: any) {
      console.error("Error creating order:", error);
      console.error("Error details:", {
        response: error.response?.data,
        status: error.response?.status,
        message: error.message,
      });
      const errorMessage = error.response?.data?.message || error.message || "Failed to create order";
      toast.error(errorMessage);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-brass animate-spin mx-auto mb-4" />
          <p className="text-ink-muted">Loading product details...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <>
        <NavBar />
        <div className="min-h-screen flex items-center justify-center bg-paper px-4">
          <div className="border border-dashed border-hairline bg-paper-raised p-12 max-w-md text-center">
            <div className="mb-6">
              <ShoppingCart className="w-16 h-16 text-brass mx-auto opacity-50" />
            </div>
            <h2 className="text-2xl font-bold text-ink mb-2">No Product Selected</h2>
            <p className="text-ink-muted mb-6">
              Please select a product to purchase. To buy a product, view it from the product listing and click "Buy Now".
            </p>
            <button
              onClick={() => navigate("/")}
              className="w-full bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold px-6 py-3"
            >
              Browse Products
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {submitting && (
        <div className="fixed inset-0 bg-ink/50 animate-overlay-in flex items-center justify-center z-50">
          <div className="bg-paper-raised border border-hairline animate-panel-in p-8 text-center">
            <Loader2 className="w-10 h-10 text-brass animate-spin mx-auto mb-4" />
            <p className="text-lg font-semibold text-ink">Processing Payment...</p>
            <p className="text-sm text-ink-muted mt-2">Please do not close this page or your browser</p>
          </div>
        </div>
      )}
      <NavBar />
      <div className="min-h-screen bg-paper py-6 sm:py-8">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          {/* Product Section */}
          {product && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8 bg-paper-raised border border-hairline p-4 sm:p-8 mb-6 sm:mb-8">
            {/* Images */}
            <div className="space-y-4">
              <div className="relative bg-paper border border-hairline overflow-hidden h-96">
                {product.images && product.images.length > 0 ? (
                  <img
                    src={getImageUrl(product.images[selectedImage])}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-ink-muted">
                    No image available
                  </div>
                )}
              </div>
              {product.images && product.images.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                  {product.images.map((img, idx) => (
                    <img
                      key={idx}
                      src={getImageUrl(img)}
                      alt={`Thumbnail ${idx}`}
                      className={`w-full h-20 object-cover cursor-pointer border-2 transition-colors ${
                        selectedImage === idx
                          ? "border-brass"
                          : "border-hairline hover:border-brass/50"
                      }`}
                      onClick={() => setSelectedImage(idx)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Product Details */}
            <div className="space-y-6">
              {/* Category Badge */}
              {product.category && (
                <div>
                  <span className="inline-block border border-brass text-brass px-4 py-1.5 text-sm font-bold uppercase tracking-wide">
                    {product.category}
                  </span>
                </div>
              )}

              <div>
                <h1 className="text-2xl sm:text-4xl font-bold text-ink">
                  {product.name}
                </h1>
              </div>

              <div className="text-3xl font-bold text-ink font-mono tabular-nums">
                Rs. {product.price.toLocaleString()}
              </div>

              <p className="text-ink-muted">{product.description}</p>

              <div className="bg-paper border border-hairline p-4">
                <p className="text-sm text-ink-muted">
                  <span className="font-semibold text-ink">Available Stock:</span>{" "}
                  <span className="font-mono tabular-nums">{product.quantity || 0}</span> items available
                </p>
              </div>

              {/* Dynamic Variant Options */}
              {product.variants &&
                Object.keys(product.variants).length > 0 &&
                Object.entries(product.variants).map(([variantType, options]) => {
                  if (!options || options.length === 0) return null;
                  return (
                    <div key={variantType}>
                      <label className="block text-sm font-semibold text-ink mb-3 capitalize">
                        {variantType}
                      </label>
                      <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                        {options.map((option) => (
                          <button
                            key={option}
                            onClick={() =>
                              setSelectedVariants((prev) => ({
                                ...prev,
                                [variantType]: option,
                              }))
                            }
                            className={`p-2 border-2 transition text-sm active:scale-[0.97] ${
                              selectedVariants[variantType] === option
                                ? "border-brass bg-brass-light font-semibold text-ink"
                                : "border-hairline text-ink-muted hover:border-brass/50"
                            }`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

              {/* Debug: Show variant status */}
              {(!product.variants || Object.keys(product.variants).length === 0) && (
                <div className="border border-dashed border-hairline p-4 text-sm text-ink-muted">
                  <p className="font-semibold text-ink mb-1">No variants configured</p>
                  <p>This product doesn't have variant options configured.</p>
                </div>
              )}

              {/* Quantity */}
              <div>
                <label className="block text-sm font-semibold text-ink mb-2">
                  Quantity
                </label>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="px-4 py-2 border border-hairline text-ink hover:border-brass active:scale-[0.97] transition"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(Math.max(1, parseInt(e.target.value) || 1))
                    }
                    className="w-16 text-center border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition p-2 font-mono tabular-nums"
                    min="1"
                    max={product.quantity || 100}
                  />
                  <button
                    onClick={() =>
                      setQuantity(
                        Math.min(
                          product.quantity || 100,
                          quantity + 1
                        )
                      )
                    }
                    className="px-4 py-2 border border-hairline text-ink hover:border-brass active:scale-[0.97] transition"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Total Price */}
              <div className="text-xl font-bold text-ink">
                Total: <span className="font-mono tabular-nums">Rs. {totalPrice.toLocaleString()}</span>
              </div>

              {/* Buttons */}
              <div className="flex gap-4">
                <button
                  onClick={handleAddToCart}
                  className="flex-1 flex items-center justify-center gap-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold px-6 py-3"
                >
                  <ShoppingCart size={20} />
                  Add to Cart
                </button>
                <button
                  onClick={() => setIsFavorite(!isFavorite)}
                  className={`px-6 py-3 border transition active:scale-[0.98] ${
                    isFavorite
                      ? "border-seal text-seal bg-seal/5"
                      : "border-ink text-ink hover:bg-ink hover:text-paper"
                  }`}
                >
                  <Heart size={20} fill={isFavorite ? "currentColor" : "none"} />
                </button>
              </div>

              {/* Buy Now Button */}
              <button
                onClick={() => {
                  const el = document.getElementById("checkout-section");
                  if (el) {
                    const rect = el.getBoundingClientRect();
                    const offset = 120; // header/nav height buffer
                    const targetY = window.pageYOffset + rect.top - offset;
                    window.scrollTo({ top: targetY, behavior: "smooth" });
                  }
                }}
                className="w-full bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold px-6 py-3"
              >
                Buy Now
              </button>
            </div>
          </div>
          )}


          {/* Checkout Section - Only show if product loaded successfully */}
          {product && (
          <div
            id="checkout-section"
            className="bg-paper-raised border border-hairline p-4 sm:p-8 mt-8 sm:mt-12 mb-8 sm:mb-12"
          >
            <div className="max-w-2xl mx-auto">
              <h2 className="text-2xl font-bold text-ink mb-6">
                Checkout
              </h2>

              <form onSubmit={handleCheckout} className="space-y-6" id="checkout-form">
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={userDetails.firstName}
                    onChange={(e) =>
                      setUserDetails({
                        ...userDetails,
                        firstName: e.target.value,
                      })
                    }
                    className="w-full p-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-2">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={userDetails.lastName}
                    onChange={(e) =>
                      setUserDetails({
                        ...userDetails,
                        lastName: e.target.value,
                      })
                    }
                    className="w-full p-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={userDetails.email}
                    onChange={(e) =>
                      setUserDetails({
                        ...userDetails,
                        email: e.target.value,
                      })
                    }
                    className="w-full p-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    required
                  />
                </div>

                <div className="bg-paper border border-hairline p-4">
                  <h3 className="font-semibold text-ink mb-3">Order Summary</h3>

                  {/* Promo Code Section */}
                  <div className="mb-4 p-3 bg-paper-raised border border-hairline">
                    <div className="flex items-center gap-2 mb-2">
                      <Tag className="w-4 h-4 text-brass" />
                      <span className="text-xs font-semibold text-ink">Have a promo code?</span>
                    </div>
                    {!appliedPromo ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Enter code"
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                          className="flex-1 px-2 py-1.5 border border-hairline bg-paper text-ink text-sm focus:outline-none focus:border-brass transition"
                        />
                        <button
                          type="button"
                          onClick={validatePromoCode}
                          disabled={validatingPromo}
                          className="px-3 py-1.5 bg-brass hover:bg-brass-dark disabled:bg-hairline disabled:text-ink-muted text-ink active:scale-[0.97] font-semibold text-xs transition"
                        >
                          {validatingPromo ? "..." : "Apply"}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between border border-moss bg-moss/5 p-2">
                        <div className="flex items-center gap-2">
                          <span className="text-moss font-semibold text-xs font-mono tabular-nums">{appliedPromo.code}</span>
                          <span className="text-moss text-xs flex items-center gap-1">
                            <Check className="w-3 h-3" /> Applied
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={removePromoCode}
                          className="text-seal hover:text-seal/80 transition"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 mb-3 border-b border-hairline pb-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-muted">Product:</span>
                      <span className="font-medium text-ink">{product?.name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-muted">Quantity:</span>
                      <span className="font-medium text-ink font-mono tabular-nums">{quantity}</span>
                    </div>

                    {/* Show selected variants */}
                    {product?.variants &&
                      Object.entries(product.variants).map(([variantType, options]) => {
                        if (!options || options.length === 0 || !selectedVariants[variantType])
                          return null;
                        return (
                          <div key={variantType} className="flex justify-between text-sm">
                            <span className="text-ink-muted capitalize">
                              {variantType}:
                            </span>
                            <span className="font-medium text-ink">
                              {selectedVariants[variantType]}
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  {appliedPromo && (
                    <div className="mb-3 pb-3 border-b border-hairline">
                      <div className="flex justify-between text-sm text-moss">
                        <span className="flex items-center gap-1">
                          <Tag className="w-4 h-4" />
                          Promo Discount:
                        </span>
                        <span className="font-semibold font-mono tabular-nums">
                          - Rs. {appliedPromo.discountAmount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between text-lg font-semibold text-ink">
                    <span>Total:</span>
                    <span className="font-mono tabular-nums">
                      Rs. {finalPrice.toLocaleString()}
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold text-lg px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                  {submitting ? "Processing..." : "Proceed to Payment"}
                </button>
              </form>
            </div>
          </div>
          )}
        </div>
      </div>
    </>
  );
}

export default BuyProduct;
