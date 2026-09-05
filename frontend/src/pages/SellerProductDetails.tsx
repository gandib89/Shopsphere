import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { getImageUrl } from "../lib/utils";
import { toast } from "sonner";
import NavBar from "../components/NavBar";
import { AdminHeading } from "../components/admin/AdminUi";
import { ArrowLeft, Save, Trash2, Image as ImageIcon, Package } from "lucide-react";

interface Product {
  _id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  description: string;
  images: string[];
  sellerId: string;
  discount?: number;
  variants?: {
    storage?: string[];
    color?: string[];
    ram?: string[];
    screenSize?: string[];
    processor?: string[];
  };
  colorVariants?: Array<{ color: string; images?: string[]; stock: number }>;
  storageVariants?: Array<{ storage: string; stock: number }>;
}

function SellerProductDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<Partial<Product>>({});
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [isSettingDiscount, setIsSettingDiscount] = useState(false);
  const token = localStorage.getItem("token");

  useEffect(() => {
    fetchProductDetails();
  }, [id]);

  const mapCategory = (cat: string) =>
    ({ 'Mobile Phones': 'iPhone', 'Laptops': 'MacBook', 'Smartwatches': 'Apple Watch', 'Tablets': 'iPad' } as Record<string, string>)[cat] ?? cat;

  const fetchProductDetails = async () => {
    try {
      setLoading(true);
      // Seller-scoped read: the public /product/get/:id would happily return another shop's
      // listing and render it inside this panel with an edit form.
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/seller/product/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setProduct(response.data);
      setFormData(response.data);
      setDiscountValue(response.data.discount || 0);
    } catch (error) {
      console.error("Error fetching product details:", error);
      // Clear the previous product: without this the page keeps rendering the last listing
      // that loaded while the URL (and every save/delete action) points at a different id.
      setProduct(null);
      setFormData({});
      setDiscountValue(0);
      toast.error("Failed to load product details");
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "price" || name === "quantity" ? Number(value) : value,
    }));
  };

  const handleColorStockChange = (index: number, value: number) => {
    setFormData((prev) => {
      const updated = [...(prev.colorVariants ?? [])];
      updated[index] = { ...updated[index], stock: value };
      const total = updated.reduce((sum, v) => sum + (v.stock || 0), 0);
      return { ...prev, colorVariants: updated, quantity: total };
    });
  };

  const handleUpdate = async () => {
    try {
      setIsSaving(true);
      await axios.put(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/seller/update/${id}`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success("Product updated successfully!");
      setIsEditing(false);
      fetchProductDetails();
    } catch (error) {
      console.error("Error updating product:", error);
      toast.error("Failed to update product");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        "Are you sure you want to delete this product? This action cannot be undone."
      )
    ) {
      return;
    }

    try {
      await axios.delete(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/seller/delete/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success("Product deleted successfully!");
      navigate("/seller-products");
    } catch (error) {
      console.error("Error deleting product:", error);
      toast.error("Failed to delete product");
    }
  };

  const handleSetDiscount = async () => {
    if (discountValue < 0 || discountValue > 100) {
      toast.error("Discount must be between 0 and 100%");
      return;
    }

    try {
      setIsSettingDiscount(true);
      const response = await axios.put(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/seller/discount/${id}`,
        { discount: discountValue },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (discountValue > 0) {
        toast.success(`${discountValue}% discount applied! ${response.data.notifiedUsers || 0} users notified.`);
      } else {
        toast.success("Discount removed successfully!");
      }

      fetchProductDetails();
    } catch (error: any) {
      console.error("Error setting discount:", error);
      toast.error(error.response?.data?.message || "Failed to set discount");
    } finally {
      setIsSettingDiscount(false);
    }
  };

  if (loading) {
    return (
      <>
        <NavBar />
        <div className="flex items-center justify-center min-h-screen bg-paper">
          <div className="text-center">
            <Package className="w-10 h-10 mx-auto mb-4 text-brass animate-pulse" />
            <p className="text-ink-muted">Loading product details...</p>
          </div>
        </div>
      </>
    );
  }

  if (!product) {
    return (
      <>
        <NavBar />
        <div className="flex items-center justify-center min-h-screen bg-paper">
          <div className="text-center">
            <p className="text-xl text-seal mb-4">Product not found</p>
            <button
              onClick={() => navigate("/seller-products")}
              className="bg-brass text-white px-6 py-3 rounded-[var(--radius-control)] hover:bg-brass-dark active:scale-[0.97] transition font-semibold"
            >
              Back to My Products
            </button>
          </div>
        </div>
      </>
    );
  }

  const stockLabel =
    product.quantity > 10 ? "Good Stock" : product.quantity > 0 ? "Low Stock" : "Out of Stock";
  const stockColor =
    product.quantity > 10 ? "text-moss" : product.quantity > 0 ? "text-brass" : "text-seal";

  return (
    <>
      <NavBar />
      <div className="bg-paper min-h-screen py-6 sm:py-8">
        <div className="container mx-auto px-4 sm:px-6">
          <AdminHeading title={product.name || "Edit product"} description="Manage and update your product information">
            <Link className="admin-button" to="/seller-products"><ArrowLeft size={14} aria-hidden="true" />All products</Link>
          </AdminHeading>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-2">
              {/* Images Section */}
              <div className="bg-paper-raised border border-hairline rounded-[var(--radius-surface)] p-4 sm:p-8 mb-6 sm:mb-8">
                <h2 className="text-2xl font-bold text-ink mb-6 flex items-center gap-2">
                  <ImageIcon className="w-6 h-6 text-brass" />
                  Product Images
                </h2>

                {product.images && product.images.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {product.images.map((image, index) => (
                      <div
                        key={index}
                        className="relative bg-paper border border-hairline rounded-[var(--radius-control)] overflow-hidden"
                      >
                        <img
                          src={getImageUrl(image)}
                          alt={`Product ${index + 1}`}
                          className="w-full h-48 object-cover"
                        />
                        <div className="absolute top-2 right-2 bg-ink text-paper px-2 py-1 rounded-[var(--radius-control)] text-xs font-bold font-mono tabular-nums">
                          {index + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border border-dashed border-hairline rounded-[var(--radius-control)] p-8 text-center">
                    <ImageIcon className="w-12 h-12 text-ink-muted/40 mx-auto mb-4" />
                    <p className="text-ink-muted">No images uploaded</p>
                  </div>
                )}
              </div>

              {/* Product Information */}
              <div className="bg-paper-raised border border-hairline rounded-[var(--radius-surface)] p-4 sm:p-8 mb-6 sm:mb-8">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-ink">Product Information</h2>
                  {!isEditing && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="bg-brass text-white px-6 py-2 rounded-[var(--radius-control)] hover:bg-brass-dark active:scale-[0.97] transition font-semibold flex items-center gap-2"
                    >
                      Edit Product
                    </button>
                  )}
                </div>

                <div className="space-y-6">
                  {/* Product Name */}
                  <div>
                    <label className="block text-sm font-semibold text-ink mb-2">
                      Product Name
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="name"
                        value={formData.name || ""}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-hairline rounded-[var(--radius-control)] bg-paper text-ink focus:outline-none focus:border-brass transition"
                      />
                    ) : (
                      <p className="text-lg text-ink">{product.name}</p>
                    )}
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-semibold text-ink mb-2">
                      Description
                    </label>
                    {isEditing ? (
                      <textarea
                        name="description"
                        value={formData.description || ""}
                        onChange={handleInputChange}
                        rows={4}
                        className="w-full px-4 py-3 border border-hairline rounded-[var(--radius-control)] bg-paper text-ink focus:outline-none focus:border-brass transition"
                      />
                    ) : (
                      <p className="text-ink-muted whitespace-pre-wrap">{product.description}</p>
                    )}
                  </div>

                  {/* Category */}
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-ink mb-2">
                        Category
                      </label>
                      {isEditing ? (
                        <select
                          name="category"
                          value={mapCategory(formData.category || "")}
                          onChange={handleInputChange}
                          className="w-full px-4 py-3 border border-hairline rounded-[var(--radius-control)] bg-paper text-ink focus:outline-none focus:border-brass transition"
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
                      ) : (
                        <p className="text-ink font-medium">{mapCategory(product.category)}</p>
                      )}
                    </div>
                  </div>

                  {/* Price and Quantity */}
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-ink mb-2">
                        Price (Rs.)
                      </label>
                      {isEditing ? (
                        <input
                          type="number"
                          name="price"
                          value={formData.price || ""}
                          onChange={handleInputChange}
                          className="w-full px-4 py-3 border border-hairline rounded-[var(--radius-control)] bg-paper text-ink focus:outline-none focus:border-brass transition font-mono tabular-nums"
                        />
                      ) : (
                        <p className="text-2xl font-bold text-brass font-mono tabular-nums">
                          Rs. {product.price.toLocaleString()}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-ink mb-2">
                        Stock Quantity
                      </label>
                      {isEditing ? (
                        formData.colorVariants && formData.colorVariants.length > 0 ? (
                          <div className="space-y-3">
                            <p className="text-xs text-ink-muted mb-1">Edit stock per colour — total updates automatically:</p>
                            {formData.colorVariants.map((cv, idx) => (
                              <div key={idx} className="flex items-center gap-3 border border-hairline rounded-[var(--radius-control)] px-4 py-2">
                                <span className="w-5 h-5 border border-hairline shrink-0" style={{ backgroundColor: cv.color.toLowerCase() }} />
                                <span className="text-sm font-medium text-ink flex-1 capitalize">{cv.color}</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={cv.stock}
                                  onChange={(e) => handleColorStockChange(idx, Number(e.target.value))}
                                  className="w-24 px-3 py-1.5 border border-hairline rounded-[var(--radius-control)] bg-paper text-ink text-center focus:outline-none focus:border-brass transition text-sm font-mono tabular-nums"
                                />
                              </div>
                            ))}
                            <div className="flex justify-between items-center border border-brass/40 bg-brass/5 rounded-[var(--radius-control)] px-4 py-2">
                              <span className="text-sm font-semibold text-brass">Total Stock</span>
                              <span className="text-lg font-bold text-brass font-mono tabular-nums">{formData.quantity}</span>
                            </div>
                          </div>
                        ) : (
                          <input
                            type="number"
                            name="quantity"
                            value={formData.quantity || ""}
                            onChange={handleInputChange}
                            className="w-full px-4 py-3 border border-hairline rounded-[var(--radius-control)] bg-paper text-ink focus:outline-none focus:border-brass transition font-mono tabular-nums"
                          />
                        )
                      ) : (
                        <div>
                          <p className="text-2xl font-bold text-ink font-mono tabular-nums">{product.quantity}</p>
                          {product.colorVariants && product.colorVariants.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {product.colorVariants.map((cv, idx) => (
                                <div key={idx} className="flex items-center gap-2 text-sm">
                                  <span className="w-3 h-3 border border-hairline" style={{ backgroundColor: cv.color.toLowerCase() }} />
                                  <span className="capitalize text-ink-muted">{cv.color}:</span>
                                  <span className="font-semibold text-ink font-mono tabular-nums">{cv.stock}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <p className={`text-sm font-medium ${stockColor}`}>
                            {stockLabel}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Variants */}
                  {product.variants && Object.keys(product.variants).length > 0 && (
                    <div>
                      <label className="block text-sm font-semibold text-ink mb-4">
                        Available Variants
                      </label>
                      <div className="grid grid-cols-2 gap-4">
                        {Object.entries(product.variants).map(([key, values]: [string, any]) => {
                          if (!Array.isArray(values) || values.length === 0) return null;
                          return (
                            <div key={key} className="border border-hairline rounded-[var(--radius-control)] p-4">
                              <h4 className="font-semibold text-ink capitalize mb-2">
                                {key.replace(/([A-Z])/g, " $1")}
                              </h4>
                              <div className="flex flex-wrap gap-2">
                                {values.map((value: string) => (
                                  <span
                                    key={value}
                                    className="border border-hairline rounded-[var(--radius-control)] text-ink-muted px-3 py-1 text-sm font-medium"
                                  >
                                    {value}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                {isEditing && (
                  <div className="flex gap-4 mt-8 pt-8 border-t border-hairline">
                    <button
                      onClick={handleUpdate}
                      disabled={isSaving}
                      className="flex-1 bg-brass text-white font-bold py-3 px-4 rounded-[var(--radius-control)] hover:bg-brass-dark active:scale-[0.97] transition disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <Save className="w-5 h-5" />
                      {isSaving ? "Saving..." : "Save Changes"}
                    </button>
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setFormData(product);
                      }}
                      className="flex-1 border border-ink text-ink font-bold py-3 px-4 rounded-[var(--radius-control)] hover:bg-ink hover:text-paper active:scale-[0.98] transition"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar - Quick Stats */}
            <div className="lg:col-span-1">
              {/* Quick Stats */}
              <div className="bg-paper-raised border border-hairline rounded-[var(--radius-surface)] p-6 mb-8">
                <h3 className="text-xl font-bold text-ink mb-4">Quick Stats</h3>

                <div className="space-y-4">
                  <div className="border border-hairline rounded-[var(--radius-control)] p-4">
                    <p className="text-ink-muted text-sm mb-1">Product Price</p>
                    <p className="text-2xl font-bold text-brass font-mono tabular-nums">
                      Rs. {product.price.toLocaleString()}
                    </p>
                  </div>

                  <div className="border border-hairline rounded-[var(--radius-control)] p-4">
                    <p className="text-ink-muted text-sm mb-1">Stock Status</p>
                    <p className={`text-2xl font-bold font-mono tabular-nums ${stockColor}`}>
                      {product.quantity}
                    </p>
                    <p className={`text-xs mt-1 font-semibold ${stockColor}`}>
                      {stockLabel}
                    </p>
                  </div>

                  <div className="border border-hairline rounded-[var(--radius-control)] p-4">
                    <p className="text-ink-muted text-sm mb-1">Category</p>
                    <p className="font-bold text-ink">{mapCategory(product.category)}</p>
                  </div>
                </div>
              </div>

              {/* Discount Management */}
              <div className="bg-paper-raised border border-hairline rounded-[var(--radius-surface)] p-6 mb-8">
                <h3 className="text-xl font-bold text-ink mb-4">Discount Management</h3>

                {product.discount && product.discount > 0 ? (
                  <div className="border border-moss/40 bg-moss/5 rounded-[var(--radius-control)] p-4 mb-4">
                    <p className="text-moss text-sm mb-1">Active Discount</p>
                    <p className="text-3xl font-bold text-moss font-mono tabular-nums">{product.discount}%</p>
                    <p className="text-sm text-ink-muted mt-2">
                      Discounted Price: <span className="font-bold text-moss font-mono tabular-nums">Rs. {(product.price * (1 - product.discount / 100)).toLocaleString()}</span>
                    </p>
                  </div>
                ) : (
                  <div className="border border-hairline rounded-[var(--radius-control)] p-4 mb-4">
                    <p className="text-ink-muted text-sm">No active discount</p>
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-ink mb-2">
                      Set Discount (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(Number(e.target.value))}
                      className="w-full px-4 py-3 border border-hairline rounded-[var(--radius-control)] bg-paper text-ink focus:outline-none focus:border-brass transition font-mono tabular-nums"
                      placeholder="Enter discount percentage"
                    />
                    <p className="text-xs text-ink-muted mt-1">
                      Enter 0 to remove discount
                    </p>
                  </div>

                  <button
                    onClick={handleSetDiscount}
                    disabled={isSettingDiscount}
                    className="w-full bg-brass text-white font-bold py-3 px-4 rounded-[var(--radius-control)] hover:bg-brass-dark active:scale-[0.97] transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSettingDiscount ? "Applying..." : "Apply Discount"}
                  </button>

                  <div className="border border-brass/40 bg-brass/5 rounded-[var(--radius-control)] p-3">
                    <p className="text-xs text-brass">
                      <strong>Tip:</strong> Users who have this product in their cart will be notified about the discount!
                    </p>
                  </div>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="bg-paper-raised border border-seal/40 rounded-[var(--radius-surface)] p-6">
                <h3 className="text-xl font-bold text-seal mb-4">Danger Zone</h3>
                <button
                  onClick={handleDelete}
                  className="w-full border border-seal text-seal font-bold py-3 px-4 rounded-[var(--radius-control)] hover:bg-seal/5 active:scale-[0.98] transition flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-5 h-5" />
                  Delete Product
                </button>
                <p className="text-xs text-ink-muted mt-3">
                  This action cannot be undone. Your product will be permanently deleted.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default SellerProductDetails;
