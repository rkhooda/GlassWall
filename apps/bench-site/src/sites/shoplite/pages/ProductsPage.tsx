import { useSearchParams } from 'react-router-dom';
import { PRODUCTS, type ShopLiteStore } from '../store';

export default function ProductsPage({ store }: { store: ShopLiteStore }) {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').toLowerCase();
  const products = q ? PRODUCTS.filter(p => p.name.toLowerCase().includes(q) || p.blurb.toLowerCase().includes(q)) : PRODUCTS;

  return (
    <section>
      <h1>{q ? `Results for "${q}"` : 'Products'}</h1>
      {products.length === 0 && <p>No products match.</p>}
      <ul className="grid" aria-label="Products">
        {products.map(p => (
          <li key={p.id} className="card product" data-sku={p.sku}>
            <h2>{p.name}</h2>
            <p className="muted">{p.blurb}</p>
            <p className="price">₹{p.price.toLocaleString('en-IN')}</p>
            <button type="button" onClick={() => store.addToCart(p)} aria-label={`Add ${p.name} to cart`}>
              Add to cart
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
