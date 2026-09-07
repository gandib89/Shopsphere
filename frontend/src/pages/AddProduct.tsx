import axios from "axios";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { X, Upload, Image as ImageIcon, ArrowLeft, Plus, Check, AlertTriangle } from "lucide-react";
import NavBar from "../components/NavBar";
import { AdminHeading } from "../components/admin/AdminUi";
import { useSellerApproval } from "../components/seller/SellerApprovalContext";

interface ColorVariant {
  color: string;
  images: File[];
  stock: number;
}

interface StorageVariant {
  storage: string;
  stock: number;
}

const colorValues: Record<string, string> = {
  black: '#111827', white: '#F8FAFC', blue: '#2563EB', red: '#DC2626', green: '#16A34A', gold: '#C6A15B', silver: '#C7CBD1', purple: '#7C3AED', pink: '#EC4899', gray: '#6B7280', grey: '#6B7280', yellow: '#EAB308', 'rose gold': '#B76E79', 'space gray': '#6E7175', 'space grey': '#6E7175',
};
const colorValue = (name: string) => colorValues[name.trim().toLowerCase()] || '#CBD5E1';

function FilePreview({ file, alt }: { file: File; alt: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url ? <img src={url} alt={alt} className="h-20 w-20 rounded-[var(--radius-control)] border border-hairline object-cover" /> : null;
}

type AddProductProps = {
  sellerId?: string;
  sellerName?: string;
};

function AddProduct({ sellerId, sellerName }: AddProductProps) {
  const navigate = useNavigate();
  const { loaded: approvalLoaded, pending: pendingApproval } = useSellerApproval();
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);
  const [formError, setFormError] = useState("");
  const [saveProgress, setSaveProgress] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    price: "",
    description: "",
    quantity: "",
  });

  const [variants, setVariants] = useState({
    storage: [] as string[],
    color: [] as string[],
    ram: [] as string[],
    screenSize: [] as string[],
    processor: [] as string[],
    speakerSize: [] as string[],
  });

  const [variantInput, setVariantInput] = useState({
    storage: "",
    color: "",
    ram: "",
    screenSize: "",
    processor: "",
    speakerSize: "",
  });

  // Keyed `${kind}:${value}` — what each option adds to the base price.
  const [optionDeltas, setOptionDeltas] = useState<Record<string, string>>({});
  const [generalImage, setGeneralImage] = useState<File | null>(null);
  const [colorVariants, setColorVariants] = useState<ColorVariant[]>([]);
  const [storageVariants, setStorageVariants] = useState<StorageVariant[]>([]);
  const token = localStorage.getItem("token");
  const isAdminProduct = Boolean(sellerId);
  const uploadPath = isAdminProduct ? "/api/v1/product/admin/uploadImage" : "/api/v1/product/uploadImage";
  const createPath = sellerId
    ? `/api/v1/product/admin/sellers/${encodeURIComponent(sellerId)}`
    : "/api/v1/product/create";
  const productsPath = sellerId ? `/admin/sellers/${encodeURIComponent(sellerId)}?view=products` : "/seller-products";

  // Predefined variant options based on category
  const variantOptions: {
    [key: string]: { [key: string]: string[] };
  } = {
    "iPhone": {
      storage: ["64GB", "128GB", "256GB", "512GB", "1TB"],
      color: ["Black", "White", "Blue", "Red", "Green", "Gold", "Silver", "Purple", "Pink"],
    },
    MacBook: {
      storage: ["256GB SSD", "512GB SSD", "1TB SSD", "2TB SSD", "4TB SSD"],
      color: ["Black", "White", "Silver", "Gray", "Rose Gold", "Space Gray", "Blue"],
    },
    "Mac Mini": {
      storage: ["256GB SSD", "512GB SSD", "1TB SSD", "2TB SSD", "4TB SSD"],
      color: ["Silver", "Space Gray"],
    },
    Accessories: {
      color: ["Black", "White", "Blue", "Red", "Gray", "Green", "Yellow", "Pink"],
    },
    Speakers: {
      // Represent speaker connection type instead of storage sizes
      storage: ["Bluetooth Only", "Wired"],
      color: ["Black", "White", "Gray", "Blue", "Red", "Green"],
    },
    iPad: {
      storage: ["64GB", "128GB", "256GB", "512GB", "1TB"],
      color: ["Black", "White", "Silver", "Gold", "Rose Gold", "Space Gray"],
    },
    "Apple Watch": {
      storage: ["8GB", "16GB", "32GB", "64GB"],
      color: ["Black", "White", "Silver", "Gold", "Rose Gold", "Blue", "Red"],
    },
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!formData.name.trim() || !formData.category || Number(formData.price) <= 0 || !formData.description.trim() || Number(formData.quantity) <= 0) {
      setFormError("Complete the required product details and enter a price and stock above zero.");
      setStep(1);
      window.setTimeout(() => document.querySelector<HTMLElement>(".admin-product-form input:invalid, .admin-product-form select:invalid, .admin-product-form textarea:invalid")?.focus(), 0);
      return;
    }
    if (!generalImage) {
      setFormError("Add a main product image before reviewing the listing.");
      setStep(2);
      return;
    }

    // A colour without a photo is allowed: the storefront shows a placeholder for it and the
    // seller can upload the real photo later from the product page.
    if (colorVariants.length > 0) {
      const missingImages = colorVariants.filter(cv => cv.images.length === 0);
      if (missingImages.length > 0) {
        toast.warning(`No photo yet for ${missingImages.map(cv => cv.color).join(", ")} - a placeholder shows until you add one`);
      }
      
      // Validate color stock matches total quantity
      const totalColorStock = colorVariants.reduce((sum, cv) => sum + cv.stock, 0);
      if (totalColorStock !== parseInt(formData.quantity)) {
        setFormError(`Colour stock totals ${totalColorStock}, but total quantity is ${formData.quantity}. Make these values match.`);
        setStep(2);
        return;
      }
    }

    // Validate storage stock matches total quantity (if storage variants exist)
    if (storageVariants.length > 0) {
      const totalStorageStock = storageVariants.reduce((sum, sv) => sum + sv.stock, 0);
      if (totalStorageStock !== parseInt(formData.quantity)) {
        setFormError(`Storage stock totals ${totalStorageStock}, but total quantity is ${formData.quantity}. Make these values match.`);
        setStep(2);
        return;
      }
    }

    setFormError("");
    setSaving(true);
    setSaveProgress("Uploading main image…");
    try {
      // Upload general image first
      const formDataForGeneralImage = new FormData();
      formDataForGeneralImage.append("images", generalImage);
      
      const generalImageUploadResponse = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}${uploadPath}`,
        formDataForGeneralImage,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data",
          },
        }
      );
      const uploadedGeneralImages = generalImageUploadResponse.data.imageUrls;

      // Upload color-specific images
      const uploadedColorVariants: Array<{ color: string; images: string[]; stock: number }> = [];
      for (const [colorIndex, colorVariant] of colorVariants.entries()) {
        setSaveProgress(`Uploading ${colorVariant.color} images (${colorIndex + 1}/${colorVariants.length})…`);
        // No files chosen: store the colour with no images so the storefront falls back to the
        // placeholder, rather than posting an empty upload.
        if (colorVariant.images.length === 0) {
          uploadedColorVariants.push({ color: colorVariant.color, images: [], stock: colorVariant.stock });
          continue;
        }

        const formDataForColorImages = new FormData();
        colorVariant.images.forEach((file) => {
          formDataForColorImages.append("images", file);
        });

        const colorImageUploadResponse = await axios.post(
          `${import.meta.env.VITE_BACKEND_URL}${uploadPath}`,
          formDataForColorImages,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "multipart/form-data",
            },
          }
        );

        uploadedColorVariants.push({
          color: colorVariant.color,
          images: colorImageUploadResponse.data.imageUrls,
          stock: colorVariant.stock,
        });
      }

      const productData = {
        ...formData,
        images: uploadedGeneralImages,
        variants: variants,
        colorVariants: uploadedColorVariants.length > 0 ? uploadedColorVariants : [],
        storageVariants: storageVariants.length > 0 ? storageVariants : [],
        options: buildOptions(),
      };


      setSaveProgress("Creating listing…");
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}${createPath}`,
        productData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );


      if (response.status === 201) {
        toast.success("Product added");
        setFormData({
          name: "",
          category: "",
          price: "",
          description: "",
          quantity: "",
        });
        setVariants({
          storage: [],
          color: [],
          ram: [],
          screenSize: [],
          processor: [],
          speakerSize: [],
        });
        setColorVariants([]);
        setStorageVariants([]);
        setOptionDeltas({});
        setGeneralImage(null);
        navigate(productsPath);
      }
    } catch (err) {
      console.error("Error adding product:", err);
      toast.error(`Could not add ${isAdminProduct ? "this seller's" : "your"} product. Your details are still here; please try again.`);
    } finally {
      setSaving(false);
      setSaveProgress("");
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFormError("");
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFormError("");
  };

  const handleGeneralImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setGeneralImage(e.target.files[0]);
    }
  };

  // The five option kinds the catalogue prices; the form's speakerSize list has no column and is
  // dropped server-side, so it never becomes a priced option either.
  const PRICED_OPTION_KINDS = ['color', 'storage', 'ram', 'screenSize', 'processor'] as const;

  const selectedOptions = PRICED_OPTION_KINDS.flatMap((kind) =>
    (variants[kind] || []).map((value) => ({ kind, value })));

  const buildOptions = () => selectedOptions.map(({ kind, value }) => ({
    kind,
    value,
    priceDelta: Number(optionDeltas[`${kind}:${value}`]) || 0,
    stock: kind === 'color'
      ? colorVariants.find((cv) => cv.color === value)?.stock ?? null
      : kind === 'storage'
        ? storageVariants.find((sv) => sv.storage === value)?.stock ?? null
        : null,
  }));

  const addVariant = (type: string) => {
    const value = variantInput[type as keyof typeof variantInput]?.trim();
    if (value && !variants[type as keyof typeof variants]?.includes(value)) {
      setVariants((prev) => ({
        ...prev,
        [type]: [...(prev[type as keyof typeof variants] || []), value],
      }));
      setVariantInput((prev) => ({
        ...prev,
        [type]: "",
      }));

      // Auto-create color variant entry
      if (type === 'color') {
        setColorVariants((prev) => [...prev, { color: value, images: [], stock: 0 }]);
      }
      // Auto-create storage variant entry
      if (type === 'storage') {
        setStorageVariants((prev) => [...prev, { storage: value, stock: 0 }]);
      }
    }
  };

  const removeVariant = (type: string, value: string) => {
    setVariants((prev) => ({
      ...prev,
      [type]: prev[type as keyof typeof variants]?.filter((v) => v !== value) || [],
    }));

    // Remove color variant entry
    if (type === 'color') {
      setColorVariants((prev) => prev.filter((cv) => cv.color !== value));
    }
    // Remove storage variant entry
    if (type === 'storage') {
      setStorageVariants((prev) => prev.filter((sv) => sv.storage !== value));
    }
  };

  const selectPredefinedVariant = (type: string, value: string) => {
    const isSelected = variants[type as keyof typeof variants]?.includes(value);
    
    if (isSelected) {
      // Deselect: Remove the variant
      removeVariant(type, value);
    } else {
      // Select: Add the variant
      setVariants((prev) => ({
        ...prev,
        [type]: [...(prev[type as keyof typeof variants] || []), value],
      }));

      // Auto-create color variant entry
      if (type === 'color') {
        setColorVariants((prev) => [...prev, { color: value, images: [], stock: 0 }]);
      }
      // Auto-create storage variant entry
      if (type === 'storage') {
        setStorageVariants((prev) => [...prev, { storage: value, stock: 0 }]);
      }
    }
  };

  const handleColorImageChange = (color: string, files: FileList | null) => {
    if (files) {
      const fileArray = Array.from(files).slice(0, 3);
      setColorVariants((prev) =>
        prev.map((cv) =>
          cv.color === color ? { ...cv, images: fileArray } : cv
        )
      );
    }
  };

  const handleColorStockChange = (color: string, stock: number) => {
    setColorVariants((prev) => {
      const updated = prev.map((cv) =>
        cv.color === color ? { ...cv, stock: Math.max(0, stock) } : cv
      );
      const total = updated.reduce((sum, cv) => sum + cv.stock, 0);
      setFormData((fd) => ({ ...fd, quantity: String(total) }));
      return updated;
    });
  };

  const handleStorageStockChange = (storage: string, stock: number) => {
    setStorageVariants((prev) => {
      const updated = prev.map((sv) =>
        sv.storage === storage ? { ...sv, stock: Math.max(0, stock) } : sv
      );
      const total = updated.reduce((sum, sv) => sum + sv.stock, 0);
      setFormData((fd) => ({ ...fd, quantity: String(total) }));
      return updated;
    });
  };

  const removeColorVariant = (color: string) => {
    setColorVariants((prev) => prev.filter((cv) => cv.color !== color));
    removeVariant('color', color);
  };

  const removeStorageVariant = (storage: string) => {
    setStorageVariants((prev) => prev.filter((sv) => sv.storage !== storage));
    removeVariant('storage', storage);
  };

  const getTotalColorStock = () => {
    return colorVariants.reduce((sum, cv) => sum + cv.stock, 0);
  };

  const getTotalStorageStock = () => {
    return storageVariants.reduce((sum, sv) => sum + sv.stock, 0);
  };

  return (
    <>
      <NavBar />
      <div className="min-h-screen bg-paper pb-10">
        <div className="container mx-auto px-4 sm:px-6 max-w-3xl">
          <AdminHeading
            title={isAdminProduct ? `Add product for ${sellerName || "seller"}` : "Add new product"}
            description={isAdminProduct ? "Create a listing owned and managed by this seller." : "List your product on the store and reach more customers"}
          >
            <Link className="admin-button" to={productsPath}><ArrowLeft size={14} aria-hidden="true" />{isAdminProduct ? "Seller products" : "All products"}</Link>
          </AdminHeading>
        </div>
        <div className="container mx-auto px-4 sm:px-6 max-w-3xl py-6 sm:py-10">

          {!isAdminProduct && approvalLoaded && pendingApproval ? <section className="admin-panel p-6" role="status"><h2 className="text-xl font-semibold text-ink">Product creation unlocks after approval</h2><p className="mt-2 text-sm text-ink-muted">An administrator must approve your seller account before you can create listings.</p><Link className="admin-button mt-5" to="/seller/account">Review account details</Link></section> : <form onSubmit={handleSubmit} noValidate className="admin-product-form space-y-6" aria-busy={saving}>
            <ol className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-control)] border border-hairline bg-paper-raised text-center text-xs font-semibold sm:text-sm" aria-label="Product creation progress">{['Details', 'Inventory & images', 'Review'].map((label, index) => <li key={label} className={`px-2 py-3 ${index < 2 ? 'border-r border-hairline' : ''} ${step === index + 1 ? 'bg-brass/10 text-brass' : 'text-ink-muted'}`} aria-current={step === index + 1 ? 'step' : undefined}>{index + 1}. {label}</li>)}</ol>
            {formError && <p className="admin-notice" role="alert">{formError}</p>}
            <div className={step === 1 ? 'space-y-6' : 'hidden'}>
            {/* Basic Info */}
            <div className="bg-paper-raised border border-hairline p-6">
              <h2 className="font-display text-xl font-bold text-ink mb-4">Basic Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="product-name" className="block text-sm font-semibold text-ink mb-1.5">Product Name</label>
                  <input
                    type="text"
                    id="product-name" name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    placeholder="e.g. iPhone 16 Pro Max"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="product-category" className="block text-sm font-semibold text-ink mb-1.5">Category</label>
                  <select
                    id="product-category" name="category"
                    value={formData.category}
                    onChange={handleSelectChange}
                    className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                    required
                  >
                    <option value="">Select a category</option>
                    <option value="iPhone">iPhone</option>
                    <option value="MacBook">MacBook</option>
                    <option value="Mac Mini">Mac Mini</option>
                    <option value="iPad">iPad</option>
                    <option value="Apple Watch">Apple Watch</option>
                    <option value="Speakers">Speakers</option>
                    <option value="Accessories">Accessories</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="product-price" className="block text-sm font-semibold text-ink mb-1.5">Price (Rs.)</label>
                  <input
                    type="number"
                    id="product-price" name="price"
                    value={formData.price}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono tabular-nums"
                    placeholder="e.g. 199999"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-ink mb-1.5">
                    Total Stock / Quantity
                  </label>
                  {colorVariants.length > 0 || storageVariants.length > 0 ? (
                    <div className="flex items-center gap-3 px-4 py-3 bg-paper border border-hairline">
                      <span className="text-2xl font-bold text-brass font-mono tabular-nums">{formData.quantity || 0}</span>
                      <span className="text-sm text-ink-muted">auto-calculated from variant stocks</span>
                    </div>
                  ) : (
                    <input
                      type="number"
                      name="quantity"
                      value={formData.quantity}
                      onChange={handleInputChange}
                      min="1"
                      className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono tabular-nums"
                      placeholder="e.g. 50"
                      required
                    />
                  )}
                </div>
              </div>
              <div className="mt-5">
                <label htmlFor="product-description" className="block text-sm font-semibold text-ink mb-1.5">Description</label>
                <textarea
                  id="product-description" name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  rows={4}
                  className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                  placeholder="Describe your product's specifications, features, etc."
                  maxLength={1000}
                  required
                />
              </div>
            </div>
            </div>
            <div className={step === 2 ? 'space-y-6' : 'hidden'}>

            {/* General Image */}
            <div className="bg-paper-raised border border-hairline p-6">
              <h2 className="font-display text-xl font-bold text-ink mb-4">Main Product Image</h2>
              <label className="flex flex-col items-center justify-center border border-dashed border-hairline hover:border-brass transition p-8 cursor-pointer">
                <Upload className="w-8 h-8 text-brass mb-2" />
                <span className="text-sm font-semibold text-ink">Click to upload main image</span>
                <span className="text-xs text-ink-muted mt-1">This image appears on the product listing</span>
                <input
                  type="file"
                  name="generalImage"
                  accept="image/*"
                  onChange={handleGeneralImageChange}
                  className="hidden"
                />
              </label>
              {generalImage && <div className="mt-3 flex items-center gap-3"><FilePreview file={generalImage} alt="Selected main product preview" /><div><p className="text-sm font-semibold text-moss">{generalImage.name}</p><p className="mt-1 text-xs text-ink-muted">Square or 4:3 images work best. Maximum 5 MB.</p></div></div>}
            </div>

            {/* Variants */}
            {formData.category && variantOptions[formData.category] && (
              <div className="bg-paper-raised border border-hairline p-6">
                <h2 className="font-display text-xl font-bold text-ink mb-1">
                  Product Variants <span className="text-sm font-normal text-ink-muted">(Optional)</span>
                </h2>
                <p className="text-sm text-ink-muted mb-5">Select colours and storage options — stock per variant will be tracked separately</p>

                {Object.entries(variantOptions[formData.category]).map(([variantType, options]) => {
                  if (variantType !== 'color' && variantType !== 'storage') return null;
                  return (
                    <div key={variantType} className="mb-6 last:mb-0">
                      <label className="block text-sm font-semibold text-ink mb-2 capitalize">{variantType}</label>
                      {/* Quick select */}
                      <div className="flex flex-wrap gap-2 mb-3">
                        {(options as string[]).map((option) => {
                          const selected = variants[variantType as keyof typeof variants]?.includes(option);
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => selectPredefinedVariant(variantType, option)}
                              className={`px-3 py-1.5 border text-xs font-semibold transition active:scale-[0.97] flex items-center gap-1 ${
                                selected
                                  ? 'bg-brass text-white border-brass'
                                  : 'bg-paper text-ink-muted border-hairline hover:border-brass'
                              }`}
                            >
                              {selected && <Check className="w-3 h-3" />}
                              {option}
                            </button>
                          );
                        })}
                      </div>
                      {/* Custom input */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder={`Add custom ${variantType}…`}
                          value={variantInput[variantType as keyof typeof variantInput] || ""}
                          onChange={(e) => setVariantInput((prev) => ({ ...prev, [variantType]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVariant(variantType); } }}
                          className="flex-1 px-3 py-2 border border-hairline bg-paper text-ink text-sm focus:outline-none focus:border-brass transition"
                        />
                        <button
                          type="button"
                          onClick={() => addVariant(variantType)}
                          className="px-4 py-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition text-sm font-semibold flex items-center gap-1"
                        >
                          <Plus className="w-4 h-4" /> Add
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Price difference per option */}
            {selectedOptions.length > 0 && (
              <div className="bg-paper-raised border border-hairline p-6">
                <h2 className="font-display text-xl font-bold text-ink mb-1">Price per option</h2>
                <p className="text-sm text-ink-muted mb-5">
                  What each choice adds to the base price. Leave at 0 for options that cost the same.
                </p>
                <div className="border border-hairline divide-y divide-hairline">
                  {selectedOptions.map(({ kind, value }) => {
                    const key = `${kind}:${value}`;
                    const delta = Number(optionDeltas[key]) || 0;
                    return (
                      <div key={key} className="flex flex-wrap items-center gap-3 p-4">
                        <span className="text-xs uppercase tracking-widest text-ink-muted w-24">{kind}</span>
                        <span className="font-semibold text-ink">{value}</span>
                        <div className="ml-auto flex items-center gap-2">
                          <span className="text-sm text-ink-muted">base +</span>
                          <input
                            type="number"
                            step="1"
                            aria-label={`Price difference for ${value}`}
                            value={optionDeltas[key] ?? ''}
                            onChange={(e) => setOptionDeltas((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="w-32 px-3 py-2 border border-hairline bg-paper text-ink text-right font-mono tabular-nums focus:outline-none focus:border-brass transition"
                            placeholder="0"
                          />
                          <span className="text-sm text-ink-muted font-mono tabular-nums w-32 text-right">
                            = रु {((Number(formData.price) || 0) + delta).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Per-color stock + images */}
            {colorVariants.length > 0 && (
              <div className="bg-paper-raised border border-hairline p-6">
                <h2 className="font-display text-xl font-bold text-ink mb-1">Stock &amp; Images per Colour</h2>
                <p className="text-sm text-ink-muted mb-5">Set stock for each colour — total quantity updates automatically</p>
                <div className="border border-hairline divide-y divide-hairline">
                  {colorVariants.map((cv, index) => (
                    <div key={cv.color} className="p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 border border-hairline shrink-0" style={{ backgroundColor: colorValue(cv.color) }} />
                          <span className="font-bold text-ink text-base capitalize">{cv.color}</span>
                          <span className="text-xs px-2 py-0.5 border border-hairline text-ink-muted font-mono tabular-nums">{index + 1}/{colorVariants.length}</span>
                        </div>
                        <button type="button" aria-label={`Remove ${cv.color} variant`} onClick={() => removeColorVariant(cv.color)} className="p-1.5 border border-seal text-seal hover:bg-seal/5 active:scale-[0.98] transition">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-semibold text-ink mb-1.5 flex items-center gap-1.5">
                            <ImageIcon className="w-4 h-4" />Images (max 3)
                          </label>
                          <label className="flex items-center gap-2 border border-dashed border-hairline hover:border-brass transition p-3 cursor-pointer">
                            <Upload className="w-4 h-4 text-brass" />
                            <span className="text-sm text-ink font-medium">Choose files</span>
                            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleColorImageChange(cv.color, e.target.files)} />
                          </label>
                          {cv.images.length > 0
                            ? <div className="mt-2"><div className="flex flex-wrap gap-2">{cv.images.map((file, imageIndex) => <FilePreview key={`${file.name}-${imageIndex}`} file={file} alt={`${cv.color} preview ${imageIndex + 1}`} />)}</div><p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-moss"><Check className="w-3 h-3" />{cv.images.length} of 3 images selected</p></div>
                            : <p className="text-xs text-ink-muted mt-1.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Optional - a placeholder shows until you add one</p>}
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-ink mb-1.5">Stock for {cv.color}</label>
                          <input
                            type="number"
                            min="0"
                            value={cv.stock}
                            onChange={(e) => handleColorStockChange(cv.color, parseInt(e.target.value) || 0)}
                            className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-lg font-semibold font-mono tabular-nums"
                            placeholder="0"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Total */}
                <div className="flex justify-between items-center border border-hairline px-5 py-3 mt-4">
                  <span className="font-semibold text-ink">Total Stock</span>
                  <span className="text-2xl font-bold text-brass font-mono tabular-nums">{getTotalColorStock()}</span>
                </div>
              </div>
            )}

            {/* Per-storage stock */}
            {storageVariants.length > 0 && (
              <div className="bg-paper-raised border border-hairline p-6">
                <h2 className="font-display text-xl font-bold text-ink mb-1">Stock per Storage Option</h2>
                <p className="text-sm text-ink-muted mb-5">Set stock for each storage — total quantity updates automatically</p>
                <div className="border border-hairline divide-y divide-hairline">
                  {storageVariants.map((sv) => (
                    <div key={sv.storage} className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-bold text-ink">{sv.storage}</span>
                        <button type="button" aria-label={`Remove ${sv.storage} variant`} onClick={() => removeStorageVariant(sv.storage)} className="p-1.5 border border-seal text-seal hover:bg-seal/5 active:scale-[0.98] transition">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <input
                        type="number"
                        min="0"
                        value={sv.stock}
                        onChange={(e) => handleStorageStockChange(sv.storage, parseInt(e.target.value) || 0)}
                        className="w-full px-4 py-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition text-lg font-semibold font-mono tabular-nums"
                        placeholder="0"
                        required
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center border border-hairline px-5 py-3 mt-4">
                  <span className="font-semibold text-ink">Total Stock</span>
                  <span className="text-2xl font-bold text-brass font-mono tabular-nums">{getTotalStorageStock()}</span>
                </div>
              </div>
            )}

            </div>
            {step === 3 && <section className="rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-6"><h2 className="text-xl font-semibold text-ink">Review listing</h2><dl className="mt-5 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-ink-muted">Product</dt><dd className="font-semibold text-ink">{formData.name || 'Not entered'}</dd></div><div><dt className="text-xs text-ink-muted">Price</dt><dd className="font-mono font-semibold text-ink">Rs. {(Number(formData.price) || 0).toLocaleString()}</dd></div><div><dt className="text-xs text-ink-muted">Stock</dt><dd className="font-semibold text-ink">{formData.quantity || 0}</dd></div><div><dt className="text-xs text-ink-muted">Main image</dt><dd className="font-semibold text-ink">{generalImage?.name || 'Missing'}</dd></div></dl></section>}
            <div className="sticky bottom-3 z-10 flex gap-3 rounded-[var(--radius-surface)] border border-hairline bg-paper-raised p-3 shadow-float">
              {step > 1 && <button type="button" className="admin-button" disabled={saving} onClick={() => { setFormError(''); setStep(value => value - 1); }}>Back</button>}
              {step < 3 ? <button type="button" className="admin-button admin-button--primary ml-auto" onClick={() => { if (step === 1 && (!formData.name.trim() || !formData.category || Number(formData.price) <= 0 || !formData.description.trim() || Number(formData.quantity) <= 0)) { setFormError('Complete all required product details before continuing.'); return; } if (step === 2 && !generalImage) { setFormError('Add a main product image before continuing.'); return; } setFormError(''); setStep(value => value + 1); }}>Save and continue</button> : <button type="submit" disabled={saving} className="admin-button admin-button--primary ml-auto"><Plus className="w-5 h-5" aria-hidden="true" />{saving ? saveProgress || 'Saving listing…' : 'Add product'}</button>}
            </div>
          </form>}

        </div>
      </div>
    </>
  );
}

export default AddProduct;
