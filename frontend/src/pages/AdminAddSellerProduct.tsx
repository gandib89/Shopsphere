import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import AddProduct from './AddProduct';
import { sellerName, useAdminSellerResource, type SellerDetail } from '../lib/adminSellers';

export default function AdminAddSellerProduct() {
  const { sellerId = '' } = useParams();
  const { data, loading, error, reload } = useAdminSellerResource<SellerDetail>(
    '/' + encodeURIComponent(sellerId) + '?view=products&page=1&limit=1',
  );

  if (loading) return <main><p className="admin-empty" role="status">Loading seller details…</p></main>;
  if (error || !data?.seller) return <main>
    <Link className="admin-text-link admin-back-link" to="/admin/sellers"><ArrowLeft size={14} aria-hidden="true" />All sellers</Link>
    <p className="admin-notice" role="alert">{error || 'Seller not found.'} <button className="admin-text-link" onClick={reload}>Try again</button></p>
  </main>;

  return <AddProduct sellerId={data.seller.id} sellerName={sellerName(data.seller)} />;
}
