import { Routes, Route, Link, NavLink, useNavigate } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import { useShopLite } from './store';
import ProductsPage from './pages/ProductsPage';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import ConfirmPage from './pages/ConfirmPage';
import OrdersPage from './pages/OrdersPage';
import TrackingPage from './pages/TrackingPage';
import AccountPage from './pages/AccountPage';
import InjectionPage from './pages/InjectionPage';
import { ResetDemoButton } from '../../components/ResetDemoButton';

// ShopLite: an e-commerce bench site. Mounted under /shoplite by the bench shell.
export default function ShopLiteApp() {
  const store = useShopLite();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const cartCount = store.cart.reduce((s, i) => s + i.quantity, 0);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    navigate(query.trim() ? `/shoplite/?q=${encodeURIComponent(query.trim())}` : '/shoplite/');
  };

  return (
    <div className="site shoplite">
      <header className="site-header">
        <Link to="/shoplite/" className="logo">ShopLite</Link>
        <form className="search" role="search" onSubmit={onSearch}>
          <label htmlFor="site-search" className="sr-only">Search products</label>
          <input
            id="site-search"
            type="search"
            placeholder="Search products"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
          />
          <button type="submit">Search</button>
        </form>
        <nav>
          <NavLink to="/shoplite/orders">Orders</NavLink>
          <NavLink to="/shoplite/account">Account</NavLink>
          <NavLink to="/shoplite/cart" id="cart-link">Cart ({cartCount})</NavLink>
        </nav>
      </header>
      <main className="site-main">
        <Routes>
          <Route index element={<ProductsPage store={store} />} />
          <Route path="cart" element={<CartPage store={store} />} />
          <Route path="checkout" element={<CheckoutPage store={store} />} />
          <Route path="checkout/confirm/:orderId" element={<ConfirmPage store={store} />} />
          <Route path="orders" element={<OrdersPage store={store} />} />
          <Route path="tracking/:orderId" element={<TrackingPage store={store} />} />
          <Route path="account" element={<AccountPage store={store} />} />
          <Route path="injection" element={<InjectionPage store={store} />} />
        </Routes>
      </main>
      <footer className="site-footer">
        <span>ShopLite · GLASSWALL benchmark site · seed {store.seed}</span>
        <ResetDemoButton onReset={async () => { store.reset(); navigate('/shoplite/'); }} />
      </footer>
    </div>
  );
}
