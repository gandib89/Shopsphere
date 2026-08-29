import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import NavBar from "../components/NavBar";
import { ArrowLeft, Eye, Search } from "lucide-react";

interface Product {
  _id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  description: string;
  images: string[];
  seller?: {
    _id: string;
    shopName?: string;
    firstName?: string;
    lastName?: string;
  };
}

function AllProducts() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const token = localStorage.getItem("token");

  const mapCategory = (cat: string) =>
    ({ 'Mobile Phones': 'iPhone', 'Laptops': 'MacBook', 'Smartwatches': 'Apple Watch', 'Tablets': 'iPad' } as Record<string, string>)[cat] ?? cat;

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/get`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setProducts(response.data);
    } catch (error) {
      console.error("Error fetching products:", error);
      toast.error("Failed to load products");
    } finally {
      setLoading(false);
    }
  };

  const categories = ["all", ...Array.from(new Set(products.map(p => p.category))).sort()];

  const filteredProducts = products.filter(
    (product) =>
      (categoryFilter === "all" || product.category === categoryFilter) &&
      (
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.category.toLowerCase().includes(searchTerm.toLowerCase())
      )
  );

  return (
    <>
      <NavBar />
      <div className="min-h-screen bg-paper py-6 sm:py-8">
        <div className="container mx-auto px-4 sm:px-6 max-w-7xl">
          {/* Back Button */}
          <button
            onClick={() => navigate("/admin")}
            className="flex items-center gap-2 mb-5 text-ink-muted hover:text-brass font-medium text-sm transition"
          >
            <ArrowLeft size={18} />
            Back to Admin Panel
          </button>

          <div className="bg-paper-raised border border-hairline p-4 sm:p-8">
            <h1 className="font-display text-3xl font-bold text-ink mb-6">
              All Products
            </h1>

            {/* Search + Category Filter */}
            <div className="mb-6 flex flex-col gap-3">
              <div className="flex items-center border border-hairline bg-paper-raised overflow-hidden transition-colors duration-150 focus-within:border-brass">
                <div className="px-3.5 flex items-center border-r border-hairline">
                  <Search size={16} className="text-brass" />
                </div>
                <input
                  type="text"
                  placeholder="Search by product name or category..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1 px-3.5 py-2.5 text-sm text-ink bg-transparent outline-none"
                />
                {searchTerm && (
                  <button onClick={() => setSearchTerm('')} className="px-3.5 text-ink-muted hover:text-ink text-lg leading-none">×</button>
                )}
              </div>
              {/* Category filter row */}
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-3.5 py-1.5 text-[13px] font-medium border transition-colors duration-150 ${
                      categoryFilter === cat
                        ? 'bg-ink text-paper border-ink'
                        : 'bg-transparent text-ink-muted border-hairline hover:border-brass hover:text-brass'
                    }`}
                  >
                    {cat === 'all' ? 'All' : mapCategory(cat)}
                  </button>
                ))}
              </div>
            </div>

            {/* Products Table */}
            {loading ? (
              <div className="text-center py-12">
                <p className="text-ink-muted text-lg">Loading products...</p>
              </div>
            ) : filteredProducts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-ink">
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">
                        Product Name
                      </th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">
                        Category
                      </th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">
                        Seller
                      </th>
                      <th className="p-4 text-center font-semibold text-ink text-xs uppercase tracking-wide">
                        Stock
                      </th>
                      <th className="p-4 text-right font-semibold text-ink text-xs uppercase tracking-wide">
                        Price
                      </th>
                      <th className="p-4 text-center font-semibold text-ink text-xs uppercase tracking-wide">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => (
                      <tr
                        key={product._id}
                        className="border-b border-hairline hover:bg-paper transition-colors"
                      >
                        <td className="p-4 font-semibold text-ink">
                          {product.name}
                        </td>
                        <td className="p-4">
                          <span className="text-ink-muted text-xs font-semibold uppercase tracking-wide">
                            {mapCategory(product.category)}
                          </span>
                        </td>
                        <td className="p-4">
                          {product.seller?.shopName ? (
                            <p className="font-semibold text-ink text-sm">{product.seller.shopName}</p>
                          ) : (
                            <span className="text-ink-muted text-sm">—</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          <span
                            className={`font-mono text-xs tabular-nums ${
                              product.quantity > 0 ? "text-ink-muted" : "text-seal struck"
                            }`}
                          >
                            {product.quantity > 0 ? `${product.quantity} UNITS` : 'SOLD OUT'}
                          </span>
                        </td>
                        <td className="p-4 text-right font-semibold text-ink font-mono tabular-nums">
                          Rs. {product.price.toLocaleString()}
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() =>
                              navigate(`/product-details-admin/${product._id}`)
                            }
                            className="inline-flex items-center gap-2 border border-ink hover:bg-ink hover:text-paper active:scale-[0.98] text-ink px-4 py-2 transition font-semibold text-sm"
                          >
                            <Eye size={16} />
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-ink-muted text-lg">
                  {searchTerm ? "No products found matching your search." : "No products available."}
                </p>
              </div>
            )}

            {/* Results Count */}
            {!loading && filteredProducts.length > 0 && (
              <div className="mt-6 text-sm text-ink-muted tabular-nums">
                Showing {filteredProducts.length} of {products.length} products
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default AllProducts;
