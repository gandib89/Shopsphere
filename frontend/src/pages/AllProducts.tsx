import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { getImageUrl } from '../lib/utils';
import { adminMoney, getAdminCollection } from '../lib/adminData';
import { AdminHeading, AdminPagination } from '../components/admin/AdminUi';

interface Product {
  _id: string; name: string; category: string; price: number; quantity: number; images: string[]; createdAt?: string;
  seller?: {shopName?: string};
}
export default function AllProducts() {
  const [products,setProducts] = useState<Product[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [search,setSearch] = useState('');
  const [category,setCategory] = useState('all');
  const [stock,setStock] = useState('all');
  const [sort,setSort] = useState('name');
  const [direction,setDirection] = useState('asc');
  const [page,setPage] = useState(1);
  const load = useCallback(async (signal?:AbortSignal) => {
    setLoading(true); setError('');
    try { const data = await getAdminCollection<Product>('/api/v1/product/get',signal); if(!signal?.aborted) setProducts(data); }
    catch(err){if(!signal?.aborted)setError(err instanceof Error?err.message:'Could not load products.');}
    finally {if(!signal?.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  useEffect(()=>setPage(1),[search,category,stock,sort,direction]);
  const dir=direction==='desc'?-1:1;
  const filtered=products.filter(product=>(category==='all'||product.category===category)&&(stock==='all'||(stock==='in'?product.quantity>0:product.quantity<=0))&&[product.name,product.category,product.seller?.shopName].join(' ').toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>dir*(sort==='price'?a.price-b.price:sort==='stock'?a.quantity-b.quantity:sort==='date'?new Date(a.createdAt||0).getTime()-new Date(b.createdAt||0).getTime():a.name.localeCompare(b.name)));
  const pages=Math.max(1,Math.ceil(filtered.length/20));
  const current=Math.min(page,pages);
  return <main>
    <AdminHeading title="Products" description="Review seller listings, availability, and pricing across your marketplace."><button className="admin-button" disabled={loading} onClick={()=>void load()}><RefreshCw size={14} aria-hidden="true" />Refresh</button></AdminHeading>
    {error&&<p className="admin-notice" role="alert">{error}</p>}
    <section className="admin-panel" aria-label="Product catalogue">
      <div className="admin-toolbar">
        <label className="admin-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search products" placeholder="Search product, category, seller…" value={search} onChange={event=>setSearch(event.target.value)} /></label>
        <div className="admin-filters">
          <label>Category<select aria-label="Filter product category" value={category} onChange={event=>setCategory(event.target.value)}><option value="all">All categories</option>{[...new Set(products.map(product=>product.category))].sort().map(value=><option key={value}>{value}</option>)}</select></label>
          <label>Stock<select aria-label="Filter product stock" value={stock} onChange={event=>setStock(event.target.value)}><option value="all">All stock</option><option value="in">In stock</option><option value="out">Out of stock</option></select></label>
          <label>Sort<select aria-label="Sort products" value={sort} onChange={event=>setSort(event.target.value)}><option value="name">Name</option><option value="date">Date added</option><option value="price">Price</option><option value="stock">Stock</option></select></label>
          <label>Order<select aria-label="Sort order" value={direction} onChange={event=>setDirection(event.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
          {(search||category!=='all'||stock!=='all'||sort!=='name'||direction!=='asc')&&<button className="admin-button" onClick={()=>{setSearch('');setCategory('all');setStock('all');setSort('name');setDirection('asc');}}>Clear filters</button>}
        </div>
      </div>
      {loading?<p className="admin-empty" role="status">Loading products…</p>:error?<p className="admin-empty">Refresh to load the catalogue.</p>:!filtered.length?<p className="admin-empty">{products.length?'No products match these filters.':'Seller products will appear here.'}</p>:
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Product</th><th scope="col">Category</th><th scope="col">Stock</th><th scope="col">Price</th><th scope="col">Seller</th><th scope="col">Actions</th></tr></thead><tbody>{filtered.slice((current-1)*20,current*20).map(product=><tr key={product._id}><td><div className="admin-product-cell"><img src={product.images?.[0]?getImageUrl(product.images[0]):'/images/product-placeholder.svg'} alt="" onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src='/images/product-placeholder.svg';}} /><Link className="admin-text-link" to={'/product-details-admin/'+product._id}>{product.name}</Link></div></td><td>{product.category}</td><td><span className={'admin-status admin-status--'+(product.quantity>0?'success':'attention')}>{product.quantity>0?'In stock':'Out of stock'}</span><small>{product.quantity>0?product.quantity+' units available':''}</small></td><td className="admin-numeric">{adminMoney(product.price)}</td><td>{product.seller?.shopName||'—'}</td><td><Link className="admin-button" to={'/product-details-admin/'+product._id}>View / edit</Link></td></tr>)}</tbody></table></div>}
      {!loading&&!error&&filtered.length>0&&<AdminPagination page={current} pages={pages} onPage={setPage}/>}
    </section>
  </main>;
}
