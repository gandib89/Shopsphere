import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { getImageUrl } from "../lib/utils";
import { toast } from "sonner";
import NavBar from "../components/NavBar";
import { ArrowLeft, Save, Trash2, Edit2 } from "lucide-react";

interface Product {
  _id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  description: string;
  images: string[];
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

function ProductDetailsAdmin() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<Partial<Product>>({});
  const token = localStorage.getItem("token");

  const mapCategory = (cat: string) =>
    ({ 'Mobile Phones': 'iPhone', 'Laptops': 'MacBook', 'Smartwatches': 'Apple Watch', 'Tablets': 'iPad' } as Record<string, string>)[cat] ?? cat;

  useEffect(() => {
    fetchProductDetails();
  }, [id]);

  const fetchProductDetails = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/get/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setProduct(response.data);
      setFormData(response.data);
    } catch (error) {
      console.error("Error fetching product details:", error);
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
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/update/${id}`,
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
    if (!window.confirm("Are you sure you want to delete this product? This action cannot be undone.")) {
      return;
    }

    try {
      setIsSaving(true);
      await axios.delete(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/delete/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success("Product deleted successfully!");
      navigate("/admin");
    } catch (error) {
      console.error("Error deleting product:", error);
      toast.error("Failed to delete product");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="text-lg text-ink-muted">Loading product details...</div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="text-center">
          <p className="text-lg text-ink-muted mb-4">Product not found</p>
          <button
            onClick={() => navigate("/admin")}
            className="inline-flex items-center gap-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold px-6 py-3"
          >
            <ArrowLeft size={18} />
            Back to Admin Panel
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <NavBar />
      <div className="min-h-screen bg-paper py-8">
        <div className="container mx-auto px-4 max-w-6xl">
          {/* Back Button */}
          <button
            onClick={() => navigate("/admin")}
            className="flex items-center gap-2 mb-6 text-ink-muted hover:text-brass font-medium text-sm transition"
          >
            <ArrowLeft size={18} />
            Back to Admin Panel
          </button>

          <div className="bg-paper-raised border border-hairline">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8 p-4 sm:p-8">
              {/* Product Images */}
              <div>
                <h3 className="text-lg font-bold text-ink mb-4">Product Images</h3>
                {product.images && product.images.length > 0 ? (
                  <div className="space-y-4">
                    {product.images.map((image, index) => (
                      <img
                        key={index}
                        src={getImageUrl(image)}
                        alt={`Product ${index + 1}`}
                        className="w-full h-80 object-cover border border-hairline"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="w-full h-80 border border-dashed border-hairline flex items-center justify-center">
                    <p className="text-ink-muted">No images available</p>
                  </div>
                )}
              </div>

              {/* Product Details Form */}
              <div>
                <div className="flex justify-between items-center mb-8 gap-4">
                  <h2 className="text-3xl font-bold text-ink">{product.name}</h2>
                  {!isEditing && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="inline-flex items-center gap-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold px-4 py-2 shrink-0"
                    >
                      <Edit2 size={18} />
                      Edit
                    </button>
                  )}
                </div>

                <div className="space-y-5">
                  {/* Product Name */}
                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Product Name
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="name"
                        value={formData.name || ""}
                        onChange={handleInputChange}
                        className="w-full p-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                      />
                    ) : (
                      <p className="text-ink text-lg font-medium">{product.name}</p>
                    )}
                  </div>

                  {/* Category */}
                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Category
                    </label>
                    {isEditing ? (
                      <select
                        name="category"
                        value={formData.category || ""}
                        onChange={handleInputChange}
                        className="w-full p-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
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
                      <div className="inline-block border border-hairline text-ink-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                        {mapCategory(product.category) || "Not set"}
                      </div>
                    )}
                  </div>

                  {/* Price */}
                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Price (Rs.)
                    </label>
                    {isEditing ? (
                      <input
                        type="number"
                        name="price"
                        value={formData.price || ""}
                        onChange={handleInputChange}
                        className="w-full p-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                      />
                    ) : (
                      <p className="text-brass font-bold text-lg font-mono tabular-nums">
                        Rs. {product.price.toLocaleString()}
                      </p>
                    )}
                  </div>

                  {/* Total Stock */}
                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Total Stock
                    </label>
                    {isEditing ? (
                      formData.colorVariants && formData.colorVariants.length > 0 ? (
                        <div className="space-y-3">
                          <p className="text-xs text-ink-muted mb-1">Edit stock per colour — total updates automatically:</p>
                          {formData.colorVariants.map((cv, idx) => (
                            <div key={idx} className="flex items-center gap-3 border border-hairline bg-paper px-4 py-2">
                              <span className="w-4 h-4 border border-hairline shrink-0" style={{ backgroundColor: cv.color.toLowerCase() }} />
                              <span className="text-sm font-medium text-ink flex-1 capitalize">{cv.color}</span>
                              <input
                                type="number"
                                min={0}
                                value={cv.stock}
                                onChange={(e) => handleColorStockChange(idx, Number(e.target.value))}
                                className="w-24 px-3 py-1.5 border border-hairline bg-paper text-ink text-center focus:outline-none focus:border-brass transition text-sm font-mono tabular-nums"
                              />
                            </div>
                          ))}
                          <div className="flex justify-between items-center border-l-2 border-brass bg-paper px-4 py-2">
                            <span className="text-sm font-semibold text-ink">Total Stock</span>
                            <span className="text-lg font-bold text-brass font-mono tabular-nums">{formData.quantity}</span>
                          </div>
                        </div>
                      ) : (
                        <input
                          type="number"
                          name="quantity"
                          value={formData.quantity || ""}
                          onChange={handleInputChange}
                          min="1"
                          className="w-full p-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition font-mono"
                        />
                      )
                    ) : (
                      <div>
                        <p className="text-ink font-medium font-mono tabular-nums">{product.quantity} units</p>
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
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                      Description
                    </label>
                    {isEditing ? (
                      <textarea
                        name="description"
                        value={formData.description || ""}
                        onChange={handleInputChange}
                        rows={4}
                        className="w-full p-3 border border-hairline bg-paper text-ink focus:outline-none focus:border-brass transition"
                      />
                    ) : (
                      <p className="text-ink whitespace-pre-wrap">{product.description}</p>
                    )}
                  </div>

                  {/* Variants Display */}
                  {product.variants && Object.keys(product.variants).length > 0 && (
                    <div className="border border-hairline bg-paper p-4">
                      <h4 className="font-semibold text-ink mb-3">Product Variants</h4>
                      <div className="space-y-2">
                        {Object.entries(product.variants).map(([key, values]) => {
                          if (!values || values.length === 0) return null;
                          if (key === 'storage' && product.category === 'Accessories') return null;
                          return (
                            <div key={key}>
                              <p className="text-sm font-medium text-ink-muted capitalize">
                                {key}:
                              </p>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {values.map((value, idx) => (
                                  <span
                                    key={idx}
                                    className="text-xs bg-paper-raised border border-hairline text-ink px-2 py-1"
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
                <div className="flex gap-4 mt-8 pt-6 border-t border-hairline">
                  {isEditing && (
                    <>
                      <button
                        onClick={handleUpdate}
                        disabled={isSaving}
                        className="flex-1 inline-flex items-center justify-center gap-2 bg-brass text-white hover:bg-brass-dark active:scale-[0.97] transition font-semibold px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Save size={20} />
                        {isSaving ? "Saving..." : "Save Changes"}
                      </button>
                      <button
                        onClick={() => {
                          setIsEditing(false);
                          setFormData(product);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition font-semibold px-6 py-3"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <button
                    onClick={handleDelete}
                    disabled={isSaving}
                    className="flex-1 inline-flex items-center justify-center gap-2 border border-seal text-seal hover:bg-seal/5 active:scale-[0.98] transition font-semibold px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={20} />
                    {isSaving ? "Deleting..." : "Delete Product"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default ProductDetailsAdmin;
