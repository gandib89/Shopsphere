import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, Trash2, Package, Search } from 'lucide-react';
import { getImageUrl } from '../lib/utils';
import axios from 'axios';
import { toast } from 'sonner';
import NavBar from '../components/NavBar';

interface Product {
  _id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  images: string[];
}

function SellerProducts() {
  const token = localStorage.getItem('token');
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const mapCategory = (cat: string) =>
    ({ 'Mobile Phones': 'iPhone', 'Laptops': 'MacBook', 'Smartwatches': 'Apple Watch', 'Tablets': 'iPad' } as Record<string, string>)[cat] ?? cat;

  const categories = ['all', ...Array.from(new Set(products.map(p => p.category))).sort()];

  const filteredProducts = products.filter(p =>
    (categoryFilter === 'all' || p.category === categoryFilter) &&
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    if (!token || localStorage.getItem('isSeller') !== 'true') {
      window.location.hash = '/auth';
      return;
    }

    fetchSellerProducts();
  }, [token]);

  const fetchSellerProducts = async () => {
    try {
      const res = await axios.get(
        `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/seller/my-products`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      setProducts(res.data.products);
    } catch (err) {
      console.error('Error fetching products:', err);
      toast.error('Failed to fetch products');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (productId: string) => {
    if (window.confirm('Are you sure you want to delete this product?')) {
      try {
        await axios.delete(
          `${import.meta.env.VITE_BACKEND_URL}/api/v1/product/seller/delete/${productId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        toast.success('Product deleted successfully');
        setProducts(products.filter(p => p._id !== productId));
      } catch (err) {
        console.error('Error deleting product:', err);
        toast.error('Failed to delete product');
      }
    }
  };

  if (loading) {
    return (
      <>
        <NavBar />
        <div className="min-h-screen flex items-center justify-center bg-paper">
          <div className="text-center">
            <Package className="w-10 h-10 mx-auto mb-4 text-brass animate-pulse" />
            <p className="text-ink-muted">Loading products...</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <NavBar />
      <div className="min-h-screen bg-paper">
        <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/seller-panel')}
                className="p-2 hover:text-brass transition-colors shrink-0"
                title="Back"
              >
                <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
              <div>
                <h1 className="text-2xl sm:text-4xl font-bold text-ink">My Products</h1>
                <p className="text-ink-muted mt-0.5 text-sm font-mono tabular-nums">{filteredProducts.length} of {products.length} products</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/add-product')}
              className="self-start sm:self-auto bg-brass text-white px-4 sm:px-6 py-2.5 sm:py-3 hover:bg-brass-dark active:scale-[0.97] transition font-semibold text-sm sm:text-base"
            >
              + Add Product
            </button>
          </div>

          {/* Search + Category Filter */}
          <div className="mb-6 flex flex-col gap-3">
            <div className="flex items-center border border-hairline bg-paper-raised overflow-hidden transition-colors duration-150 focus-within:border-brass">
              <div className="px-3.5 flex items-center border-r border-hairline">
                <Search size={16} className="text-brass" />
              </div>
              <input
                type="text"
                placeholder="Search products..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="flex-1 px-3.5 py-2.5 text-sm text-ink bg-transparent outline-none"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="px-3.5 text-ink-muted hover:text-ink text-lg leading-none">×</button>
              )}
            </div>
            {categories.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {categories.map(cat => (
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
            )}
          </div>

          {/* Products Table */}
          {filteredProducts.length > 0 ? (
            <div className="bg-paper-raised border border-hairline overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-ink">
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Product</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Category</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Price</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Stock</th>
                      <th className="p-4 text-left font-semibold text-ink text-xs uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => (
                      <tr key={product._id} className="border-b border-hairline hover:bg-paper transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={getImageUrl(product.images?.[0])}
                              alt={product.name}
                              className="w-12 h-12 object-cover border border-hairline"
                            />
                            <span className="font-semibold text-ink">{product.name}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="text-ink-muted text-xs font-semibold uppercase tracking-wide">
                            {mapCategory(product.category || 'Uncategorized')}
                          </span>
                        </td>
                        <td className="p-4 font-semibold text-ink font-mono tabular-nums">
                          Rs. {product.price.toLocaleString()}
                        </td>
                        <td className="p-4">
                          <span className={`font-semibold font-mono tabular-nums text-sm ${product.quantity > 0 ? 'text-moss' : 'text-seal'}`}>
                            {product.quantity > 0 ? `${product.quantity} in stock` : 'Out of stock'}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => navigate(`/seller-products/${product._id}`)}
                              className="p-2 border border-ink text-ink hover:bg-ink hover:text-paper active:scale-[0.98] transition"
                              title="View/Edit"
                            >
                              <Eye className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => handleDelete(product._id)}
                              className="p-2 border border-seal text-seal hover:bg-seal/5 active:scale-[0.98] transition"
                              title="Delete"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="border border-dashed border-hairline p-12 text-center">
              <Package className="w-16 h-16 text-ink-muted/40 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-ink mb-2">No products yet</h3>
              <p className="text-ink-muted mb-6">Start adding products to your store</p>
              <button
                onClick={() => navigate('/add-product')}
                className="bg-brass text-white px-6 py-3 hover:bg-brass-dark active:scale-[0.97] transition font-semibold"
              >
                Add Your First Product
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default SellerProducts;
