import { Star } from 'lucide-react';
import { getImageUrl } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Money } from './Money';

export type CatalogProduct = {
  _id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  description: string;
  images: string[] | [string];
  reviews?: { rating: number }[];
  discount?: number;
};

const categoryNames: Record<string, string> = {
  'Mobile Phones': 'iPhone',
  Laptops: 'MacBook',
  Smartwatches: 'Apple Watch',
  Tablets: 'iPad',
};

const averageRating = (product: CatalogProduct) => {
  if (!product.reviews?.length) return 0;
  return product.reviews.reduce((sum, review) => sum + review.rating, 0) / product.reviews.length;
};

export const ProductCard = ({
  product,
  canPurchase = false,
  onOpen,
  onAddToCart,
}: {
  product: CatalogProduct;
  canPurchase?: boolean;
  onOpen: (product: CatalogProduct) => void;
  onAddToCart?: (product: CatalogProduct) => void;
}) => {
  const soldOut = product.quantity === 0;
  const salePrice = product.discount ? product.price * (1 - product.discount / 100) : product.price;
  const rating = averageRating(product);
  const image = product.images?.[0];

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-surface)] border border-hairline bg-paper-raised transition-colors hover:border-ink-muted/45">
      <button type="button" onClick={() => onOpen(product)} className="relative block aspect-[4/3] w-full overflow-hidden bg-paper text-left">
        <img
          src={getImageUrl(image)}
          alt={product.name}
          loading="lazy"
          className={`h-full w-full object-cover transition-transform duration-200 ease-out-strong group-hover:scale-[1.025] ${soldOut ? 'grayscale' : ''}`}
        />
        {product.discount ? (
          <span className="absolute left-3 top-3 rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-white">
            {product.discount}% off
          </span>
        ) : null}
        {soldOut ? (
          <span className="absolute inset-x-3 bottom-3 rounded-[var(--radius-control)] bg-paper-raised/95 px-3 py-2 text-center text-sm font-semibold text-seal">
            Sold out
          </span>
        ) : null}
      </button>

      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs font-medium text-ink-muted">{categoryNames[product.category] || product.category}</p>
        <button type="button" onClick={() => onOpen(product)} className="mt-1 text-left">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight text-ink group-hover:text-brass-dark">{product.name}</h3>
        </button>

        <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted" aria-label={rating ? `${rating.toFixed(1)} out of 5 from ${product.reviews?.length} reviews` : 'No reviews yet'}>
          <Star aria-hidden="true" className="h-3.5 w-3.5 text-brass" fill={rating ? 'currentColor' : 'none'} />
          <span>{rating ? rating.toFixed(1) : 'New'}</span>
          {product.reviews?.length ? <span>({product.reviews.length})</span> : null}
        </div>

        <Money className="mt-3" amount={salePrice} previousAmount={product.discount ? product.price : undefined} />

        <p className={`mt-2 text-xs font-medium ${soldOut ? 'text-seal' : product.quantity <= 5 ? 'text-accent-dark' : 'text-ink-muted'}`}>
          {soldOut ? 'Currently unavailable' : product.quantity <= 5 ? `Only ${product.quantity} left` : 'In stock'}
        </p>

        <div className="mt-auto pt-4">
          {canPurchase && onAddToCart ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={soldOut} onClick={() => onAddToCart(product)}>Add to cart</Button>
              <Button disabled={soldOut} onClick={() => onOpen(product)}>Buy now</Button>
            </div>
          ) : (
            <Button className="w-full" variant="secondary" onClick={() => onOpen(product)}>
              View {product.name}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
};
