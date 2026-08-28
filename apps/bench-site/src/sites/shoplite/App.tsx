import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import OrdersPage from './pages/OrdersPage';
import OrderTrackingPage from './pages/OrderTrackingPage';
import ProductList from './components/ProductList';
import Header from './components/Header';
import Footer from './components/Footer';

function App() {
  const [cart, setCart] = useState<Array<{id: number; name: string; price: number; quantity: number}>>([]);
  const navigate = useNavigate();

  const addToCart = (product: {id: number; name: string; price: number}) => {
    setCart(prev => {
      const existingItem = prev.find(item => item.id === product.id);
      if (existingItem) {
        return prev.map(item =>
          item.id === product.id
            ? {...item, quantity: item.quantity + 1}
            : item
        );
      }
      return [...prev, {...product, quantity: 1}];
    });
  };

  const removeFromCart = (productId: number) => {
    setCart(prev => prev.filter(item => item.id !== productId));
  };

  const updateCartItemQuantity = (productId: number, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart(prev =>
      prev.map(item =>
        item.id === productId
          ? {...item, quantity}
          : item
      )
    );
  };

  return (
    <BrowserRouter>
      <div className="app">
        <Header cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)} />
        <main>
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
                onPlaceOrder={() => navigate('/orders')}
              />}
            />
            <Route
              path="/orders"
              element={<OrdersPage
                onViewTracking={(orderId: string) => navigate(`/tracking/${orderId}`)}
              />}
            />
            <Route
              path="/tracking/:orderId"
              element={<OrderTrackingPage />}
            />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

export default App;