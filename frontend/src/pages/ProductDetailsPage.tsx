import React, { useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { getBackendOrigin, getImageUrl } from "../lib/utils";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { ShoppingCart, Star, ArrowLeft, Plus, Minus, Truck, Shield, Store, Tag, X, Loader, Scale,
  Camera, Cpu, BatteryFull, Monitor, MemoryStick, HardDrive, Usb, Watch, Droplets, Bluetooth, Zap, Smartphone } from "lucide-react";
import NavBar from "../components/NavBar";
import CompareBar from "../components/CompareBar";
import { useCompare, MAX_COMPARE, type CompareItem } from "../lib/compareStore";
import { storefrontCategory } from "../lib/storefrontCatalog";
import { productSpecs, productHighlights, isDemoSpec, WARRANTY } from "../lib/productSpecs";

interface Product {
  _id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  images: string[];
  quantity?: number;
  seller?: {
    _id: string;
    shopName: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
  };
  variants?: {
    storage?: string[];
    color?: string[];
    ram?: string[];
    screenSize?: string[];
    processor?: string[];
  };
  colorVariants?: Array<{
    color: string;
    stock: number;
    images: string[];
  }>;
  storageVariants?: Array<{
    storage: string;
    stock: number;
  }>;
  options?: Array<{
    kind: string;
    value: string;
    priceDelta: number | string;
    stock?: number | null;
  }>;
  variantStorage?: string[];
  variantColor?: string[];
  variantRam?: string[];
  variantScreenSize?: string[];
  variantProcessor?: string[];
}

interface RecommendedProduct {
  _id: string;
  name: string;
  category: string;
  price: number;
  quantity?: number;
  images: string[];
  metrics?: {
    support: number;
    confidence: number;
    lift: number;
  };
}

type GalleryFrame = { src: string; color: string | null; placeholder: boolean };

const PLACEHOLDER_IMAGE = "/images/product-placeholder.svg";

interface UserDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

// Marketing colour names ("Sky Blue", "Midnight") are not CSS colours, so the swatch rendered
// blank. Map the ones we ship, fall back to the CSS colour when the name happens to be one.
const SWATCH_COLORS: Record<string, string> = {
  midnight: "#1d1d1f",
  starlight: "#f6f1e7",
  skyblue: "#a7c2dd",
  spacegray: "#4b4f54",
  spacegrey: "#4b4f54",
  spaceblack: "#2c2c2e",
  graphite: "#3b3b3d",
  naturaltitanium: "#c6c2bb",
  desertitanium: "#c0a892",
};

const swatchColor = (name: string) => {
  const key = name.trim().toLowerCase().replace(/\s+/g, "");
  if (SWATCH_COLORS[key]) return SWATCH_COLORS[key];
  return CSS.supports("color", key) ? key : "rgb(var(--color-line))";
};

// One chip look for every option group: white surface (the page texture made the old bg-paper
// chips look grainy), hairline border, selection carried by a doubled brass edge instead of a tint.
const optionChipClass = (isSelected: boolean, outOfStock = false) =>
  `flex min-h-11 items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-medium transition ${
    isSelected
      ? "border-brass bg-brass/5 text-brass shadow-[inset_0_0_0_1px_rgb(var(--color-brand))]"
      : "border-hairline bg-paper-raised text-ink hover:border-ink-muted"
  } ${outOfStock ? "cursor-not-allowed text-ink-muted line-through decoration-hairline" : "cursor-pointer"}`;

const HIGHLIGHT_ICONS: Record<string, typeof Cpu> = {
  Chip: Cpu, Display: Monitor, Memory: MemoryStick, Storage: HardDrive, Battery: BatteryFull,
  Ports: Usb, 'Rear cameras': Camera, Camera: Camera, 'Case sizes': Watch,
  'Water resistance': Droplets, Connectivity: Bluetooth, Charging: Zap, Compatibility: Smartphone,
};

function ProductDetailsPage() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const productId = searchParams.get("productId") || "";
  const navigate = useNavigate();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [selectedColor, setSelectedColor] = useState<string>("");
  const [selectedStorage, setSelectedStorage] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [selectedVariants, setSelectedVariants] = useState<{
    [key: string]: string;
  }>({});
  const [showCheckout, setShowCheckout] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [userDetails, setUserDetails] = useState<UserDetails>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    street: "",
    city: "",
    state: "",
    zipCode: "",
    country: "",
  });
  const [reviews, setReviews] = useState<any[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [averageRating, setAverageRating] = useState(0);
  const [recommendedProducts, setRecommendedProducts] = useState<RecommendedProduct[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [recommendationStrategy, setRecommendationStrategy] = useState<string>("");

  // Promo code state
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discountAmount: number;
    discountPercent: number;
  } | null>(null);
  const [validatingPromo, setValidatingPromo] = useState(false);

  const compare = useCompare();
  const checkoutFormRef = useRef<HTMLDivElement>(null);
  const token = localStorage.getItem("token");
  const isSeller = localStorage.getItem("isSeller") === "true";
  const isAdmin = localStorage.getItem("isAdmin") === "true";

  // Client-side routing preserves the catalogue's document position. Reset before paint so
  // this page—and another product opened from recommendations—always starts at its header.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [productId]);

  // Options can arrive two ways: colorVariants/storageVariants rows that carry their own stock,
  // or the plain variant lists on the product itself. The page only ever rendered the first, so
  // a product described with the lists (every seeded one) offered no way to pick a configuration
  // even while the catalogue card promised "Choose your configuration".
  const optionGroups = useMemo(() => {
    if (!product) return [] as Array<{ key: string; label: string; values: Array<{ value: string; priceDelta: number }> }>;
    const labels: Record<string, string> = { color: 'Color', storage: 'Storage', ram: 'Memory', screenSize: 'Size', processor: 'Processor' };
    // Priced option rows are the source of truth; the plain lists remain the fallback for
    // products that predate them, priced flat.
    const priced = product.options ?? [];
    const listFor = (kind: string) => ({
      color: product.colorVariants?.length ? [] : product.variantColor ?? product.variants?.color ?? [],
      storage: product.storageVariants?.length ? [] : product.variantStorage ?? product.variants?.storage ?? [],
      ram: product.variantRam ?? product.variants?.ram ?? [],
      screenSize: product.variantScreenSize ?? product.variants?.screenSize ?? [],
      processor: product.variantProcessor ?? product.variants?.processor ?? [],
    }[kind] ?? []);
    return Object.keys(labels).map(kind => {
      const rows = priced.filter(option => option.kind === kind);
      const values = rows.length
        ? rows.map(option => ({ value: option.value, priceDelta: Number(option.priceDelta) || 0 }))
        : listFor(kind).map(value => ({ value, priceDelta: 0 }));
      return { key: kind, label: labels[kind], values };
    }).filter(group => group.values.length > 0);
  }, [product]);

  // Color and storage with stock-aware variant rows have dedicated controls below. Keep their
  // option groups for price calculation and validation, but do not render the same choices twice.
  const additionalOptionGroups = optionGroups.filter(group =>
    !(group.key === 'color' && product?.colorVariants?.length) &&
    !(group.key === 'storage' && product?.storageVariants?.length)
  );

  // What the chosen configuration costs: base price plus every selected option's delta.
  const optionPriceDelta = useMemo(() => optionGroups.reduce((total, group) => {
    const chosen = group.values.find(option => option.value === selectedVariants[group.key]);
    return total + (chosen?.priceDelta ?? 0);
  }, 0), [optionGroups, selectedVariants]);

  // The gallery is one strip of frames laid out left to right, grouped by colour, so choosing a
  // colour slides to that colour's first frame instead of swapping the image source. A colour the
  // seller has not photographed yet still gets a frame - a placeholder they can replace later.
  const frames = useMemo<GalleryFrame[]>(() => {
    if (!product) return [];
    if (product.colorVariants?.length) {
      return product.colorVariants.flatMap(cv => (
        cv.images?.length
          ? cv.images.map(src => ({ src, color: cv.color, placeholder: false }))
          : [{ src: PLACEHOLDER_IMAGE, color: cv.color, placeholder: true }]
      ));
    }
    const images = product.images?.length ? product.images : [PLACEHOLDER_IMAGE];
    return images.map(src => ({ src, color: null, placeholder: src === PLACEHOLDER_IMAGE }));
  }, [product]);


  const configuredPrice = (product?.price || 0) + optionPriceDelta;

  const subtotal = quantity * configuredPrice;
  const discount = appliedPromo?.discountAmount || 0;
  const totalPrice = subtotal - discount;

  const selectVariant = (key: string, value: string) => {
    setSelectedVariants(current => ({ ...current, [key]: value }));
    if (key === 'color') setSelectedColor(value);
    if (key === 'storage') setSelectedStorage(value);
    setQuantity(1);
  };

  // Shared by Add to cart and Buy now so neither can slip an unconfigured item through.
  const missingOptions = () => optionGroups.filter(group => !selectedVariants[group.key]).map(group => group.label);

  // Get available stock based on selected color or total stock
  const getAvailableStock = () => {
    if (selectedColor && selectedStorage && product?.colorVariants && product?.storageVariants) {
      // If both color and storage are selected, return the MINIMUM of both stocks
      const colorVariant = product.colorVariants.find(cv => cv.color === selectedColor);
      const storageVariant = product.storageVariants.find(sv => sv.storage === selectedStorage);
      const colorStock = colorVariant ? colorVariant.stock : 0;
      const storageStock = storageVariant ? storageVariant.stock : 0;
      return Math.min(colorStock, storageStock);
    } else if (selectedColor && product?.colorVariants) {
      const colorVariant = product.colorVariants.find(cv => cv.color === selectedColor);
      return colorVariant ? colorVariant.stock : product?.quantity || 0;
    } else if (selectedStorage && product?.storageVariants) {
      const storageVariant = product.storageVariants.find(sv => sv.storage === selectedStorage);
      return storageVariant ? storageVariant.stock : product?.quantity || 0;
    }
    return product?.quantity || 0;
  };

  useEffect(() => {
    if (!productId) {
      toast.error("Product ID is required");
      navigate("/");
      return;
    }
    fetchProduct();
  }, [productId]);

  // Refresh reviews when the tab regains focus so new submissions show up without manual reload
  useEffect(() => {
    const refreshReviewsOnFocus = () => {
      if (productId) {
        fetchProductReviews(productId);
      }
    };

    window.addEventListener("focus", refreshReviewsOnFocus);
    return () => {
      window.removeEventListener("focus", refreshReviewsOnFocus);
    };
  }, [productId]);

  useEffect(() => {
    if (token) {
      fetchUserDetails();
    }
  }, [token]);

  // Update images when product loads or color changes
  useEffect(() => {
    if (product) {
      // Only jump when the frame on screen belongs to another colour, so a thumbnail pick within
      // the selected colour is not dragged back to that colour's first photo.
      if (selectedColor && frames[frameIndex]?.color !== selectedColor) {
        const first = frames.findIndex(frame => frame.color === selectedColor);
        if (first >= 0) setFrameIndex(first);
      }
    }
  }, [product, selectedColor, frames]);

  const fetchProduct = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/get/${productId}`
      );
      setProduct(response.data);
      setFrameIndex(0);
      // Fetch reviews for this product
      fetchProductReviews(productId);
      // Fetch recommendations for this product
      fetchProductRecommendations(productId);
    } catch (error) {
      console.error("Error fetching product:", error);
      toast.error("Failed to load product details");
      navigate("/");
    } finally {
      setLoading(false);
    }
  };

  const fetchProductReviews = async (pId: string) => {
    try {
      setLoadingReviews(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/${pId}/reviews`
      );
      setReviews(response.data.reviews || []);
      setAverageRating(parseFloat(response.data.averageRating) || 0);
    } catch (error) {
      console.error("Error fetching reviews:", error);
      // Don't show error toast for reviews, it's optional
    } finally {
      setLoadingReviews(false);
    }
  };

  const fetchProductRecommendations = async (pId: string) => {
    try {
      setLoadingRecommendations(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/${pId}/recommendations?limit=6`
      );

      setRecommendedProducts(response.data?.recommendations || []);
      setRecommendationStrategy(response.data?.strategy || "");
    } catch (error) {
      console.error("Error fetching recommendations:", error);
      setRecommendedProducts([]);
      setRecommendationStrategy("");
    } finally {
      setLoadingRecommendations(false);
    }
  };

  const fetchUserDetails = async () => {
    try {
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/user/details`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const user = response.data.user;
      setUserDetails({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phone: user.phone || "",
        street: user.street || "",
        city: user.city || "",
        state: user.state || "",
        zipCode: user.zipCode || "",
        country: user.country || "",
      });
    } catch (error) {
      console.error("Error fetching user details:", error);
    }
  };

  const handleAddRecommendedToCart = async (e: React.MouseEvent, recProductId: string, recProductName: string, recProductQty: number) => {
    e.stopPropagation();
    if (!token) {
      toast.error("Please login to add items to cart");
      navigate("/auth");
      return;
    }
    if (isSeller || isAdmin) {
      toast.error(isSeller ? "Sellers cannot add items to cart" : "Admins cannot add items to cart");
      return;
    }
    if (recProductQty === 0) {
      toast.error(`${recProductName} is out of stock`);
      return;
    }
    try {
      await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/cart/add`,
        { productId: recProductId, quantity: 1 },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success(`🛒 ${recProductName} added to cart!`, { duration: 2500 });
    } catch (error: any) {
      const errorMsg = error?.response?.data?.message || "Failed to add to cart";
      toast.error(errorMsg);
    }
  };

  const handleAddToCart = async () => {
    if (!token) {
      toast.error("Please login to add items to cart");
      navigate("/auth");
      return;
    }
    if (quantity > (product?.quantity || 0)) {
      toast.error(`Only ${product?.quantity || 0} items available in stock`);
      return;
    }

    const missing = missingOptions();
    if (missing.length > 0) {
      toast.error(`Please select: ${missing.join(", ")}`);
      return;
    }

    const formattedData = {
      productId: product?._id,
      quantity,
      variants: selectedVariants,
    };

    try {
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/cart/add`,
        formattedData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.status === 200 || response.status === 201) {
        toast.success(`🎉 ${product?.name || 'Item'} added to cart!`, {
          description: `Quantity: ${quantity} - Added to your shopping cart`,
          duration: 3000,
        });
        // Reset quantity to 1 after successful add
        setQuantity(1);
      }
    } catch (error: any) {
      console.error("Error adding to cart:", error);
      const status = error?.response?.status;
      const errorMsg = error?.response?.data?.message || "Failed to add to cart";

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

      toast.error(errorMsg, {
        description: "Please try again",
        duration: 3000,
      });
    }
  };

  // Promo code validation functions
  const validatePromoCode = async () => {
    if (!promoCode.trim()) {
      toast.error("Please enter a promo code");
      return;
    }

    if (isSeller || isAdmin) {
      toast.error(isSeller ? "Sellers cannot use promo codes" : "Admins cannot use promo codes");
      return;
    }


    try {
      setValidatingPromo(true);
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/promo/validate`,
        {
          code: promoCode,
          purchaseAmount: subtotal
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const { success, discountAmount, promoCode: promoDetails } = response.data;
      if (success) {
        setAppliedPromo({
          code: promoCode,
          discountAmount: discountAmount,
          discountPercent: promoDetails.discountValue,
        });
        toast.success(`Promo code applied! रु ${discountAmount} off`, {
          duration: 3000,
        });
      }
    } catch (error: any) {
      console.error("Error validating promo code:", error);
      console.error("Error response:", error.response?.data);
      const errorMessage = error.response?.data?.message || "Invalid promo code";
      toast.error(errorMessage);
    } finally {
      setValidatingPromo(false);
    }
  };

  const removePromoCode = () => {
    setAppliedPromo(null);
    setPromoCode("");
    setValidatingPromo(false); // Reset validation state
    toast.info("Promo code removed");
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

    if (!userDetails.street || !userDetails.city || !userDetails.state || !userDetails.zipCode || !userDetails.country) {
      toast.error("Please fill in complete delivery address");
      return;
    }

    if (!deliveryDate) {
      toast.error("Please select a preferred delivery date");
      return;
    }

    // Validate that required variants are selected
    const missingForOrder = missingOptions();
    if (missingForOrder.length > 0) {
      toast.error(`Please select: ${missingForOrder.join(", ")}`);
      return;
    }

    // Validate quantity doesn't exceed available stock for selected options
    const available = getAvailableStock();
    if (quantity > available) {
      toast.error(`Only ${available} items available for selected options`);
      return;
    }

    const formattedData = {
      firstName: userDetails.firstName,
      lastName: userDetails.lastName,
      email: userDetails.email,
      phone: userDetails.phone,
      product: product?._id,
      quantity,
      deliveryDate: new Date(deliveryDate).toISOString(),
      // Send variants and also color top-level for compatibility
      variants: selectedVariants,
      color: selectedVariants.color,
      deliveryAddress: {
        street: userDetails.street,
        city: userDetails.city,
        state: userDetails.state,
        zipCode: userDetails.zipCode,
        country: userDetails.country,
      },
      // Include promo code if applied
      ...(appliedPromo && { promoCode: { code: appliedPromo.code, discountAmount: appliedPromo.discountAmount } }),
    };

    try {
      setSubmitting(true);

      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/order/createOrder`,
        formattedData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.status === 201) {
        const newOrderId = response.data.order._id;

        toast.success("Order created! Redirecting to payment...");

        // Warning for localhost usage
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
          console.warn("⚠️ WARNING: Using localhost for ESewa payment. ESewa may not be able to redirect back properly. Consider using ngrok or a public URL for testing.");
        }

        setTimeout(async () => {
          try {
            // Ask the backend to sign the eSewa checkout fields — it recomputes the amount
            // from the order in the DB and signs with a secret that never reaches the browser
            // (never compute this signature client-side — see CartCheckout.tsx for the same pattern).
            const backendBase = getBackendOrigin();
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
              input.value = value;
              form.appendChild(input);
            });

            document.body.appendChild(form);
            form.submit();
            document.body.removeChild(form);
          } catch (checkoutError: any) {
            console.error("Checkout error:", checkoutError);
            toast.error(checkoutError.response?.data?.message || "Failed to start payment");
            setSubmitting(false);
          }
        }, 500);
      }
    } catch (error: any) {
      console.error("Error creating order:", error);
      const errorMessage =
        error.response?.data?.message || error.message || "Failed to create order";
      toast.error(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleColorSelect = (color: string) => {
    setSelectedColor(color);
    setSelectedVariants({
      ...selectedVariants,
      color: color,
    });

    // Reset quantity to 1 when color changes to prevent exceeding new stock limit
    setQuantity(1);

    // Slide the strip to where this colour starts.
    const first = frames.findIndex(frame => frame.color === color);
    if (first >= 0) setFrameIndex(first);
  };

  const handleStorageSelect = (storage: string) => {
    setSelectedStorage(storage);
    setSelectedVariants({
      ...selectedVariants,
      storage: storage,
    });

    // Reset quantity to 1 when storage changes to prevent exceeding new stock limit
    setQuantity(1);
  };

  const handleBuyNowClick = () => {
    setShowCheckout(true);
    setTimeout(() => {
      if (checkoutFormRef.current) {
        const rect = checkoutFormRef.current.getBoundingClientRect();
        const offset = 120; // account for nav/header height
        const targetY = window.pageYOffset + rect.top - offset;
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      }
    }, 100);
  };

  if (loading) {
    return (
      <>
        <NavBar />
        <div className="min-h-screen flex flex-col items-center justify-center bg-paper">
          <Loader className="w-8 h-8 text-brass animate-spin mb-4" />
          <p className="text-ink-muted text-sm font-medium">Loading product details…</p>
        </div>
      </>
    );
  }

  if (!product) {
    return (
      <>
        <NavBar />
        <div className="min-h-screen flex items-center justify-center bg-paper">
          <div className="max-w-md rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-10 text-center shadow-sm">
            <ShoppingCart className="w-14 h-14 mx-auto mb-5 text-ink-muted/60" />
            <h2 className="text-2xl font-bold mb-2 text-ink">Product Not Found</h2>
            <p className="text-sm leading-relaxed mb-8 text-ink-muted">
              The product you're looking for doesn't exist or has been removed.
            </p>
            <button
              onClick={() => navigate("/")}
              className="rounded-[var(--radius-control)] bg-brass px-8 py-3 text-sm font-semibold text-white transition hover:bg-brass-dark"
            >
              Back to Home
            </button>
          </div>
        </div>
      </>
    );
  }

  // Compare entries carry the storefront's category label, so a product added here joins the
  // same list as one added from the catalogue.
  const toCompareItem = (item: {
    _id: string; name: string; category: string; price: number; images?: string[]; quantity?: number; description?: string;
  }): CompareItem => ({
    id: item._id,
    name: item.name,
    category: storefrontCategory(item.category),
    price: item.price,
    image: getImageUrl(item.images?.[0]),
    inStock: (item.quantity ?? 0) > 0,
    description: item.description,
  });

  const compareEntry: CompareItem = {
    ...toCompareItem(product),
    rating: averageRating,
    reviews: reviews.length,
  };
  const inCompare = compare.has(product._id);
  const compareBlocked = compare.locked(compareEntry);

  const specs = productSpecs(product.name, product.category);
  const highlights = productHighlights(product.name, product.category);
  // scrollIntoView lands on an ancestor that clips overflow, so scroll the window like the
  // checkout jump does, leaving room for the sticky navigation.
  const showSpecs = () => {
    const section = document.getElementById('specifications');
    if (!section) return;
    window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
  };

  return (
    <>
      <NavBar />
      <div className="bg-paper min-h-screen">
        <div className="container-store py-6 sm:py-9">

          {/* Back Button */}
          <button
            onClick={() => navigate("/")}
            className="mb-7 flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-sm font-medium text-ink-muted transition hover:bg-paper-raised hover:text-brass"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Products
          </button>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">

            {/* ── Left: Image Gallery ─────────────────── */}
            <div className="md:col-span-2">
              <div className="overflow-hidden rounded-[var(--radius-surface)] border border-hairline bg-paper-raised shadow-sm">
                {/* Main Image */}
                <div className="aspect-square max-h-[55vh] bg-paper overflow-hidden relative">
                  {frames.length > 0 ? (
                    <div
                      className="flex h-full w-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                      style={{ transform: `translateX(-${frameIndex * 100}%)` }}
                    >
                      {frames.map((frame, index) => (
                        <div key={`${frame.color ?? 'default'}-${index}`} className="relative h-full w-full shrink-0 bg-paper">
                          <img
                            src={frame.placeholder ? frame.src : getImageUrl(frame.src)}
                            alt={frame.color ? `${product.name} in ${frame.color}` : product.name}
                            loading={index === 0 ? undefined : 'lazy'}
                            className={`h-full w-full ${frame.placeholder ? 'object-contain p-10 opacity-60' : 'object-cover'} ${!product.quantity ? 'grayscale' : ''}`}
                          />
                          {frame.placeholder && (
                            <span className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full border border-hairline bg-paper-raised/95 px-3 py-1 text-xs font-medium text-ink-muted">
                              Photo coming soon
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ShoppingCart className="w-16 h-16 text-hairline" />
                    </div>
                  )}
                  {!product.quantity && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span
                        className="rounded-full border border-seal bg-paper-raised/95 px-4 py-1.5 text-sm font-semibold text-seal"
                      >
                        Sold Out
                      </span>
                    </div>
                  )}
                </div>
                {/* Thumbnail Strip - every frame, so it never empties when a colour is picked */}
                {frames.length > 1 && (
                  <div className="p-3 flex gap-2 overflow-x-auto border-t border-hairline">
                    {frames.map((frame, index) => (
                      <button
                        key={index}
                        type="button"
                        aria-label={frame.color ? `View ${frame.color}` : `View image ${index + 1}`}
                        aria-current={frameIndex === index}
                        onClick={() => {
                          // A thumbnail from another colour switches the configuration too, so
                          // the swatches and the picture never disagree.
                          if (frame.color && frame.color !== selectedColor) handleColorSelect(frame.color);
                          setFrameIndex(index);
                        }}
                        className={`h-14 w-14 shrink-0 overflow-hidden rounded-[var(--radius-control)] border-2 transition ${
                          frameIndex === index ? 'border-brass' : 'border-transparent hover:border-hairline'
                        }`}
                      >
                        <img
                          src={frame.placeholder ? frame.src : getImageUrl(frame.src)}
                          alt=""
                          className={`w-full h-full ${frame.placeholder ? 'object-contain p-1.5 opacity-60' : 'object-cover'}`}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Right: Product Info ──────────────────── */}
            <div className="md:col-span-3 space-y-4">

              {/* Main Info Card */}
              <div className="rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-4 shadow-sm sm:p-7">

                {/* Rating row */}
                {reviews.length > 0 && (
                  <div className="flex items-center gap-1.5 mb-3">
                    <div className="flex gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <Star
                          key={i}
                          className="w-4 h-4"
                          fill={i < Math.round(averageRating) ? '#0F766E' : 'none'}
                          color={i < Math.round(averageRating) ? '#0F766E' : '#E2E8F0'}
                        />
                      ))}
                    </div>
                    <span className="text-sm font-semibold text-ink font-mono tabular-nums">{averageRating}</span>
                    <span className="text-xs text-ink-muted">({reviews.length})</span>
                  </div>
                )}

                {/* Name */}
                <h1 className="text-2xl lg:text-3xl font-bold tracking-tight mb-2 text-ink">
                  {product.name}
                </h1>

                {/* Seller */}
                {product.seller && (
                  <div className="flex items-center gap-2 mb-4 text-ink-muted">
                    <Store className="w-4 h-4 shrink-0 text-brass" />
                    <span className="text-sm">{product.seller.shopName || `${product.seller.firstName} ${product.seller.lastName}`}</span>
                    {product.seller.phone && <span className="text-xs">· {product.seller.phone}</span>}
                  </div>
                )}

                {/* Price */}
                <div className="mb-1">
                  <span className="text-3xl sm:text-4xl font-bold tracking-tight text-ink font-mono tabular-nums">
                    रु {configuredPrice.toLocaleString()}
                  </span>
                </div>

                {/* Manifest line: category + stock, in one instrument readout */}
                <div className="mb-5 font-mono text-xs tabular-nums uppercase tracking-wide">
                  {!product.quantity ? (
                    <span className="text-seal">
                      {product.category ? `${product.category} — ` : ''}
                      <span className="struck">OUT OF STOCK</span>
                    </span>
                  ) : product.quantity < 5 ? (
                    <span className="text-ink-muted">
                      {product.category ? `${product.category} — ` : ''}ONLY {product.quantity} LEFT
                    </span>
                  ) : (
                    <span className="text-ink-muted">
                      {product.category ? `${product.category} — ` : ''}IN STOCK
                    </span>
                  )}
                </div>

                {/* Color Variants */}
                {product.colorVariants && product.colorVariants.length > 0 && (
                  <div className="mb-6 pb-6 border-b border-hairline">
                    <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-ink-muted">
                      Color{selectedColor && ` — ${selectedColor}`}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {product.colorVariants.map((cv, idx) => {
                        const isSelected = selectedColor === cv.color;
                        const outOfStock = cv.stock === 0;
                        return (
                          <button
                            key={idx}
                            onClick={() => !outOfStock && handleColorSelect(cv.color)}
                            disabled={outOfStock}
                            title={outOfStock ? `${cv.color} — Out of stock` : cv.color}
                            type="button"
                            aria-pressed={isSelected}
                            className={optionChipClass(isSelected, outOfStock)}
                          >
                            <span
                              aria-hidden="true"
                              className="h-4 w-4 shrink-0 rounded-full ring-1 ring-inset ring-ink/15"
                              style={{ background: swatchColor(cv.color) }}
                            />
                            <span>{cv.color}</span>
                            {outOfStock && <span className="text-xs no-underline text-seal">sold out</span>}
                          </button>
                        );
                      })}
                    </div>
                    {selectedColor && (
                      <p className="text-xs mt-2 text-ink-muted">
                        {(() => { const cv = product.colorVariants!.find(c => c.color === selectedColor); return cv ? `${cv.stock} available in this color` : ''; })()}
                      </p>
                    )}
                  </div>
                )}

                {/* Storage Variants */}
                {product.storageVariants && product.storageVariants.length > 0 && (
                  <div className="mb-6 pb-6 border-b border-hairline">
                    <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-ink-muted">
                      Storage{selectedStorage && ` — ${selectedStorage}`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {product.storageVariants.map((sv, idx) => {
                        const isSelected = selectedStorage === sv.storage;
                        const outOfStock = sv.stock === 0;
                        return (
                          <button
                            key={idx}
                            onClick={() => !outOfStock && handleStorageSelect(sv.storage)}
                            disabled={outOfStock}
                            type="button"
                            aria-pressed={isSelected}
                            className={`${optionChipClass(isSelected, outOfStock)} tabular-nums`}
                          >
                            {sv.storage}{outOfStock && <span className="ml-1.5 text-xs no-underline text-seal">sold out</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Options described as plain lists on the product (no per-option stock) */}
                {additionalOptionGroups.map(group => (
                  <div key={group.key} className="mb-6 pb-6 border-b border-hairline">
                    <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-ink-muted">
                      {group.label}{selectedVariants[group.key] && ` — ${selectedVariants[group.key]}`}
                    </p>
                    <div className="flex flex-wrap gap-2" role="group" aria-label={group.label}>
                      {group.values.map(option => {
                        const isSelected = selectedVariants[group.key] === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => selectVariant(group.key, option.value)}
                            className={optionChipClass(isSelected)}
                          >
                            {group.key === 'color' && (
                              <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full ring-1 ring-inset ring-ink/15" style={{ background: swatchColor(option.value) }} />
                            )}
                            {option.value}
                            {option.priceDelta > 0 && (
                              <span className="text-xs font-normal tabular-nums text-ink-muted">+रु {option.priceDelta.toLocaleString()}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Quantity */}
                <div className="mb-6 pb-6 border-b border-hairline">
                  <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-ink-muted">Quantity</p>
                  {(selectedColor || selectedStorage) && (
                    <p className="text-xs mb-2 text-ink-muted font-mono tabular-nums">
                      {getAvailableStock()} available
                      {selectedColor && ` · ${selectedColor}`}{selectedStorage && ` · ${selectedStorage}`}
                    </p>
                  )}
                  <div className="flex w-fit items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline p-1.5">
                    <button
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="p-1.5 hover:bg-ink hover:text-paper active:scale-[0.97] transition"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-10 text-center font-bold text-base text-ink font-mono tabular-nums">{quantity}</span>
                    <button
                      onClick={() => setQuantity(Math.min(quantity + 1, getAvailableStock()))}
                      disabled={quantity >= getAvailableStock()}
                      className="p-1.5 hover:bg-ink hover:text-paper active:scale-[0.97] transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={!product?.quantity || submitting}
                    className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-ink py-3.5 text-sm font-semibold text-ink transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:border-hairline disabled:text-ink-muted/50 disabled:hover:bg-transparent disabled:hover:text-ink-muted/50"
                  >
                    <ShoppingCart className="w-5 h-5" />
                    Add to Cart
                  </button>
                  <button
                    type="button"
                    onClick={handleBuyNowClick}
                    disabled={!product?.quantity || submitting}
                    className="flex-1 rounded-[var(--radius-control)] bg-brass py-3.5 text-sm font-semibold text-white transition hover:bg-brass-dark disabled:cursor-not-allowed disabled:bg-hairline disabled:text-ink-muted/50"
                  >
                    Buy Now
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => compare.toggle(compareEntry)}
                  disabled={compareBlocked}
                  aria-pressed={inCompare}
                  title={compareBlocked
                    ? compare.items.length >= MAX_COMPARE
                      ? `Comparing ${MAX_COMPARE} products already`
                      : `Only ${compare.category} products can join this comparison`
                    : undefined}
                  className={`mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:border-hairline disabled:text-ink-muted/50 ${inCompare ? 'border-brass bg-brass/5 text-brass' : 'border-hairline text-ink hover:border-brass hover:text-brass'}`}
                >
                  <Scale className="h-4 w-4" aria-hidden="true" />
                  {inCompare ? 'Added to compare' : 'Compare'}
                </button>

                {/* Trust row */}
                <div className="grid grid-cols-3 gap-3 mt-6">
                  {[
                    { icon: <Shield className="w-5 h-5 text-brass" />, label: 'Secure Payment' },
                    { icon: <Truck className="w-5 h-5 text-brass" />, label: 'Fast Delivery' },
                    { icon: <Star className="w-5 h-5 text-brass" />, label: 'Top Quality' },
                  ].map(({ icon, label }) => (
                    <div key={label} className="flex flex-col items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline bg-paper py-3">
                      {icon}
                      <span className="text-xs font-medium text-center text-ink-muted">{label}</span>
                    </div>
                  ))}
                </div>

                {/* Description */}
                <p className="text-sm leading-relaxed mt-6 pt-6 border-t border-hairline text-ink-muted">
                  {product.description}
                </p>

                {/* Highlights — the four rows worth reading before the full table */}
                {highlights.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-hairline">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-base font-bold text-ink">Highlights</h3>
                      <button
                        type="button"
                        onClick={showSpecs}
                        className="shrink-0 text-sm font-medium text-brass transition hover:underline"
                      >
                        Read full specs →
                      </button>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
                      {highlights.map(row => {
                        const Icon = HIGHLIGHT_ICONS[row.label] || Cpu;
                        return (
                          <div key={row.label} className="flex min-w-0 items-start gap-3">
                            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="text-xs tracking-wide text-ink-muted">{row.label}</p>
                              <p className="text-sm font-medium text-ink">{row.value}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Specifications & warranty ────────── */}
              {specs.length > 0 && (
                <section id="specifications" className="scroll-mt-24 rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-4 shadow-sm sm:p-7">
                  <h2 className="text-lg font-bold text-ink">Specifications</h2>
                  <p className="mt-1 text-xs text-ink-muted">
                    {isDemoSpec(product.name)
                      ? 'Illustrative specifications — this is a demo-only product.'
                      : "Published by Apple. Every product in this category lists the same rows, so two can be compared line by line."}
                  </p>
                  <dl className="mt-4 divide-y divide-hairline border-t border-hairline">
                    {specs.map(row => (
                      <div key={row.label} className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-6">
                        <dt className="text-xs font-semibold uppercase tracking-widest text-ink-muted">{row.label}</dt>
                        <dd className="text-sm text-ink">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              <section className="rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-4 shadow-sm sm:p-7">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-brass" />
                  <h2 className="text-lg font-bold text-ink">{WARRANTY.headline}</h2>
                </div>
                <ul className="mt-4 space-y-2.5">
                  {WARRANTY.points.map(point => (
                    <li key={point} className="flex gap-2.5 text-sm leading-relaxed text-ink-muted">
                      <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brass" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* ── Recommended ──────────────────────── */}
              <div className="rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-4 shadow-sm sm:p-7">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold text-ink">You might also like</h2>
                  {recommendationStrategy && (
                    <span className="font-mono text-xs uppercase tracking-wide border border-hairline text-ink-muted px-2 py-0.5">
                      {recommendationStrategy === 'apriori' ? 'Recommended' : 'Category Match'}
                    </span>
                  )}
                </div>

                {loadingRecommendations ? (
                  <div className="flex items-center justify-center py-10 gap-3">
                    <Loader className="w-5 h-5 text-brass animate-spin" />
                    <span className="text-sm text-ink-muted">Loading…</span>
                  </div>
                ) : recommendedProducts.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {recommendedProducts.map((item, index) => {
                      const isOOS = (item.quantity ?? 0) === 0;
                      return (
                        <div
                          key={item._id}
                          className={`relative flex flex-col overflow-hidden rounded-[var(--radius-surface)] border ${index === 0 ? 'border-brass' : 'border-hairline'}`}
                        >
                          {index === 0 && (
                            <div
                              className="absolute left-2 top-2 z-10 rounded-full border border-brass bg-paper-raised/95 px-2 py-0.5 text-xs font-semibold text-brass"
                            >
                              Top Pick
                            </div>
                          )}
                          <button onClick={() => navigate(`/product-details-page?productId=${item._id}`)} className="text-left flex-1">
                            <div className="h-36 overflow-hidden bg-paper">
                              <img
                                src={getImageUrl(item.images?.[0])}
                                alt={item.name}
                                className={`w-full h-full object-cover ${isOOS ? 'grayscale' : ''}`}
                              />
                            </div>
                            <div className="p-3">
                              <h3 className="text-sm font-semibold leading-snug line-clamp-2 mb-1 text-ink">{item.name}</h3>
                              <p className="text-sm font-bold text-ink font-mono tabular-nums">रु {item.price.toLocaleString()}</p>
                              <div className="mt-1 font-mono text-[11px] tabular-nums uppercase tracking-wide">
                                {isOOS ? (
                                  <span className="text-seal struck">Out of Stock</span>
                                ) : (
                                  <span className="text-ink-muted">{item.category}</span>
                                )}
                              </div>
                            </div>
                          </button>
                          <div className="px-3 pb-2">
                            <button
                              type="button"
                              aria-pressed={compare.has(item._id)}
                              aria-label={`Compare ${item.name}`}
                              disabled={compare.locked(toCompareItem(item))}
                              onClick={() => compare.toggle(toCompareItem(item))}
                              className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-hairline py-1.5 text-[13px] font-medium text-ink-muted transition hover:border-brass hover:text-brass disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Scale className="h-3.5 w-3.5" aria-hidden="true" />
                              {compare.has(item._id) ? 'Selected' : 'Compare'}
                            </button>
                          </div>
                          {!isSeller && !isAdmin && (
                            <div className="px-3 pb-3">
                              <button
                                onClick={(e) => handleAddRecommendedToCart(e, item._id, item.name, item.quantity ?? 0)}
                                disabled={isOOS}
                                className={`w-full py-1.5 flex items-center justify-center gap-1.5 text-[13px] font-semibold transition ${
                                  isOOS
                                    ? 'border border-hairline text-ink-muted/50 cursor-not-allowed'
                                    : index === 0
                                    ? 'bg-brass text-white hover:bg-brass-dark active:scale-[0.97]'
                                    : 'border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98]'
                                }`}
                              >
                                <ShoppingCart className="w-3.5 h-3.5" />
                                {isOOS ? 'Out of Stock' : 'Add to Cart'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-center py-8 text-ink-muted">No recommendations available yet.</p>
                )}
              </div>

              {/* ── Checkout Form ────────────────────── */}
              {showCheckout && (
                <div ref={checkoutFormRef} className="scroll-mt-6 rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-4 shadow-sm sm:p-7">
                  <h2 className="text-xl font-bold mb-6 text-ink">Checkout</h2>
                  <form onSubmit={handleCheckout} className="space-y-5">

                    {/* Personal Info */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-ink-muted">Personal Information</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {[
                          { label: 'First Name *', field: 'firstName', type: 'text', required: true },
                          { label: 'Last Name *', field: 'lastName', type: 'text', required: true },
                          { label: 'Email *', field: 'email', type: 'email', required: true },
                          { label: 'Phone', field: 'phone', type: 'tel', required: false },
                        ].map(({ label, field, type, required }) => (
                          <div key={field}>
                            <label className="block text-xs font-semibold mb-1.5 text-ink">{label}</label>
                            <input
                              type={type}
                              value={(userDetails as any)[field]}
                              onChange={(e) => setUserDetails({ ...userDetails, [field]: e.target.value })}
                              required={required}
                              className="w-full px-4 py-2.5 text-sm border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Delivery Address */}
                    <div className="border-t border-hairline pt-5">
                      <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-ink-muted">Delivery Address</p>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold mb-1.5 text-ink">Street Address *</label>
                          <input type="text" placeholder="123 Main St" value={userDetails.street} onChange={e => setUserDetails({ ...userDetails, street: e.target.value })} required className="w-full px-4 py-2.5 text-sm border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold mb-1.5 text-ink">City *</label>
                            <input type="text" placeholder="Pokhara" value={userDetails.city} onChange={e => setUserDetails({ ...userDetails, city: e.target.value })} required className="w-full px-4 py-2.5 text-sm border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold mb-1.5 text-ink">State *</label>
                            <input type="text" placeholder="Gandaki" value={userDetails.state} onChange={e => setUserDetails({ ...userDetails, state: e.target.value })} required className="w-full px-4 py-2.5 text-sm border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold mb-1.5 text-ink">ZIP Code *</label>
                            <input type="text" placeholder="33700" value={userDetails.zipCode} onChange={e => setUserDetails({ ...userDetails, zipCode: e.target.value })} required className="w-full px-4 py-2.5 text-sm border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold mb-1.5 text-ink">Country *</label>
                            <input type="text" placeholder="Nepal" value={userDetails.country} onChange={e => setUserDetails({ ...userDetails, country: e.target.value })} required className="w-full px-4 py-2.5 text-sm border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Delivery Date */}
                    <div className="border-t border-hairline pt-5">
                      <label className="block text-xs font-semibold mb-1.5 text-ink">Preferred Delivery Date *</label>
                      <input
                        type="date"
                        value={deliveryDate}
                        onChange={e => setDeliveryDate(e.target.value)}
                        min={new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                        required
                        className="w-full px-4 py-2.5 text-sm border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                      />
                      <p className="text-xs mt-1 text-ink-muted">Earliest available: 2 days from today</p>
                    </div>

                    {/* Order Summary */}
                    <div className="p-4 bg-paper border border-hairline">
                      <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-ink-muted">Order Summary</p>

                      {/* Promo Code Section - Only show for regular users */}
                      {!isSeller && !isAdmin && (
                        <div className="mb-4 p-3 bg-paper-raised border border-hairline">
                          <div className="flex items-center gap-2 mb-2">
                            <Tag className="w-4 h-4 text-brass" />
                            <span className="text-xs font-semibold text-ink">Promo Code</span>
                          </div>
                          {!appliedPromo ? (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="Enter code"
                                value={promoCode}
                                onChange={e => setPromoCode(e.target.value.toUpperCase())}
                                disabled={validatingPromo}
                                className="flex-1 text-sm px-3 py-2 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                                onKeyPress={e => e.key === 'Enter' && !validatingPromo && validatePromoCode()}
                              />
                              <button
                                type="button"
                                onClick={validatePromoCode}
                                disabled={validatingPromo}
                                className="px-4 py-2 text-sm font-semibold bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition disabled:bg-hairline disabled:text-ink-muted/50 disabled:cursor-not-allowed"
                              >
                                {validatingPromo ? "..." : "Apply"}
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between p-2 border border-moss bg-moss/10">
                              <div>
                                <p className="text-sm font-bold text-moss font-mono tabular-nums">{appliedPromo.code}</p>
                                <p className="text-xs text-moss">{appliedPromo.discountPercent}% discount applied</p>
                              </div>
                              <button
                                type="button"
                                onClick={removePromoCode}
                                className="p-1.5 text-seal hover:bg-seal/10 transition"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="flex justify-between text-sm text-ink">
                          <span>Subtotal ({quantity} item{quantity > 1 ? 's' : ''})</span>
                          <span className="font-mono tabular-nums">रु {subtotal.toLocaleString()}</span>
                        </div>
                        {appliedPromo && (
                          <div className="flex justify-between text-sm text-moss">
                            <span>Discount ({appliedPromo.discountPercent}%)</span>
                            <span className="font-mono tabular-nums">- रु {appliedPromo.discountAmount.toLocaleString()}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm text-ink">
                          <span>Shipping</span>
                          <span className="text-moss font-semibold">Free</span>
                        </div>
                        <div className="flex justify-between font-bold text-base pt-2 border-t border-hairline text-ink">
                          <span>Total</span>
                          <span className="font-mono tabular-nums">रु {totalPrice.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-4 font-bold text-base bg-brass text-white hover:bg-brass-dark active:scale-[0.98] transition disabled:bg-hairline disabled:text-ink-muted/50 disabled:cursor-not-allowed"
                    >
                      {submitting ? 'Processing…' : 'Proceed to Payment'}
                    </button>
                  </form>
                </div>
              )}

              {/* ── Reviews ──────────────────────────── */}
              <div className="rounded-[var(--radius-surface)] bg-paper-raised border border-hairline p-4 sm:p-7">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold text-ink">Customer Reviews</h2>
                  <button
                    onClick={() => fetchProductReviews(productId)}
                    className="text-sm font-semibold text-brass hover:text-brass-dark transition"
                  >
                    Refresh
                  </button>
                </div>

                {/* Average rating banner */}
                {reviews.length > 0 && (
                  <div className="flex items-center gap-5 p-4 mb-6 bg-paper border border-hairline">
                    <div className="text-center">
                      <div className="text-4xl font-bold text-ink font-mono tabular-nums">{averageRating}</div>
                      <div className="flex gap-0.5 mt-1 justify-center">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            className="w-4 h-4"
                            fill={i < Math.round(averageRating) ? '#0F766E' : 'none'}
                            color={i < Math.round(averageRating) ? '#0F766E' : '#E2E8F0'}
                          />
                        ))}
                      </div>
                      <p className="text-xs mt-1 text-ink-muted">{reviews.length} reviews</p>
                    </div>
                  </div>
                )}

                {loadingReviews ? (
                  <div className="flex items-center justify-center py-8 gap-3">
                    <Loader className="w-5 h-5 text-brass animate-spin" />
                    <span className="text-sm text-ink-muted">Loading reviews…</span>
                  </div>
                ) : reviews.length > 0 ? (
                  <div className="divide-y divide-hairline border-t border-hairline">
                    {reviews.map((review: any, index: number) => (
                      <div key={index} className="py-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="text-sm font-semibold text-ink">{review.userName}</p>
                            <p className="text-xs text-ink-muted">
                              {new Date(review.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                            </p>
                          </div>
                          <div className="flex gap-0.5">
                            {[...Array(5)].map((_, i) => (
                              <Star
                                key={i}
                                className="w-4 h-4"
                                fill={i < review.rating ? '#0F766E' : 'none'}
                                color={i < review.rating ? '#0F766E' : '#E2E8F0'}
                              />
                            ))}
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-ink-muted">{review.comment}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 border border-dashed border-hairline">
                    <Star className="w-10 h-10 mx-auto mb-3 text-hairline" />
                    <p className="text-sm text-ink-muted">No reviews yet. Be the first to review this product!</p>
                  </div>
                )}
              </div>

            </div>{/* end right col */}
          </div>
        </div>
      </div>
      <CompareBar />
    </>
  );
}

export default ProductDetailsPage;
