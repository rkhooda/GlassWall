import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import OrdersPage from './pages/OrdersPage';
import OrderTrackingPage from './pages/OrderTrackingPage';
import ProductList from './components/ProductList';
import Header from './components/Header';
import Footer from './components/Footer';
import { ResetDemoButton } from '../../components/ResetDemoButton';

const STORAGE_KEYS = [
  'shoplite_cart',
  'shoplite_orders',
  'shoplite_form_data',
];

function resetShopLiteData() {
  STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
  sessionStorage.clear();
}

function App() {
  const [cart, setCart] = useState<Array<{id: number; name: string; price: number; quantity: number}>>([]);
  const [orders, setOrders] = useState<Array<any>>([]);
  const navigate = useNavigate();

  // Load persisted data on mount
  useEffect(() => {
    const savedCart = localStorage.getItem('shoplite_cart');
    const savedOrders = localStorage.getItem('shoplite_orders');
    if (savedCart) setCart(JSON.parse(savedCart));
    if (savedOrders) setOrders(JSON.parse(savedOrders));
  }, []);

  const persistCart = (newCart: typeof cart) => {
    setCart(newCart);
    localStorage.setItem('shoplite_cart', JSON.stringify(newCart));
  };

  const persistOrders = (newOrders: typeof orders) => {
    setOrders(newOrders);
    localStorage.setItem('shoplite_orders', JSON.stringify(newOrders));
  };

  const addToCart = (product: {id: number; name: string; price: number}) => {
    persistCart((prev: Array<{id: number; name: string; price: number; quantity: number}>) => {
      const existingItem = prev.find((item) => item.id === product.id);
      if (existingItem) {
        return prev.map((item) =>
          item.id === product.id
            ? {...item, quantity: item.quantity + 1}
            : item
        );
      }
      return [...prev, {...product, quantity: 1}];
    });
  };

  const removeFromCart = (productId: number) => {
    persistCart((prev: Array<{id: number; name: string; price: number; quantity: number}>) => prev.filter((item) => item.id !== productId));
  };

  const updateCartItemQuantity = (productId: number, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    persistCart((prev: Array<{id: number; name: string; price: number; quantity: number}>) =>
      prev.map((item) =>
        item.id === productId
          ? {...item, quantity}
          : item
      )
    );
  };

  const placeOrder = () => {
    if (cart.length === 0) return;
    const orderId = 'ORD-' + Date.now().toString(36).toUpperCase();
    const newOrder = {
      id: orderId,
      items: [...cart],
      total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
      status: 'confirmed',
      timestamp: Date.now(),
      shippingAddress: '',
    };
    persistOrders(prev => [newOrder, ...prev]);
    persistCart([]);
    navigate('/orders');
  };

  const handleResetDemo = async () => {
    resetShopLiteData();
    setCart([]);
    setOrders([]);
    navigate('/');
  };

  return (
    <BrowserRouter>
      <div className="app min-h-screen flex flex-col">
        <Header cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)} />
        <main className="flex-1">
          <Routes>
            <Route
              path="/"
              element={<ProductList onAddToCart={addToCart} />}
            />
            <Route
              path="/cart"
              element={<CartPage
                cart={cart}
                onRemoveFromCart={removeFromCart}
                onUpdateQuantity={updateCartItemQuantity}
                onCheckout={() => navigate('/checkout')}
              />}
            />
            <Route
              path="/checkout"
              element={<CheckoutPage
                cart={cart}
                onPlaceOrder={placeOrder}
              />}
            />
            <Route
              path="/orders"
              element={<OrdersPage
                orders={orders}
                onViewTracking={(orderId: string) => navigate(`/tracking/${orderId}`)}
              />}
            />
            <Route
              path="/tracking/:orderId"
              element={<OrderTrackingPage orders={orders} />}
            />
          </Routes>
        </main>
        <Footer />
        <ResetDemoButton onReset={handleResetDemo} />
      </div>
    </BrowserRouter>
  );
}

export default App;